begin;

-- Existing customer sessions are capped to the new 24-hour absolute lifetime.
update public.customer_sessions
set expires_at=least(expires_at, now()+interval '24 hours')
where revoked_at is null and expires_at>now()+interval '24 hours';

create or replace function public.member_summary_v3(
  p_session_hash text, p_qr_hash text, p_activity_slug text,
  p_scan_token_hash text, p_scan_token_expiry timestamptz
)
returns table(
  display_name text, member_code text, activity_slug text, activity_name text, activity_settings_version integer,
  points integer, rewards_available integer, last_scanned_at timestamptz,
  points_per_visit integer, reward_threshold integer, reward_text text, reward_text_ar text,
  activity_balances jsonb, scan_token_expires_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid;
  v_qr_id uuid;
  v_activity public.loyalty_activities;
  v_balances jsonb;
  v_open_token_id uuid;
begin
  select s.customer_id into v_customer_id
  from public.customer_sessions s
  join public.customers c on c.id=s.customer_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and s.last_used_at>now()-interval '30 minutes'
    and c.status='active';
  if not found then raise exception 'SESSION_INVALID'; end if;

  select q.id into v_qr_id
  from public.qr_credentials q
  where q.customer_id=v_customer_id and q.token_hash=p_qr_hash and q.status='active';
  if not found then raise exception 'QR_INVALID'; end if;

  select * into v_activity
  from public.loyalty_activities a
  where a.slug=lower(btrim(p_activity_slug)) and a.is_active;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;
  if length(p_scan_token_hash)<>64
     or p_scan_token_expiry<=now()
     or p_scan_token_expiry>now()+interval '10 minutes' then
    raise exception 'INVALID_INPUT';
  end if;

  -- The activity ledger is the serialization point for concurrent refresh/scan
  -- operations for this customer and activity.
  perform 1 from public.loyalty_accounts l
  where l.customer_id=v_customer_id and l.activity_id=v_activity.id
  for update;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;

  update public.customer_sessions s
  set last_used_at=now()
  where s.token_hash=p_session_hash and s.revoked_at is null;

  -- Re-key an existing unconsumed token instead of creating an unbounded trail
  -- of replaced rows. The old visible QR becomes invalid immediately.
  select t.id into v_open_token_id
  from public.scan_tokens t
  where t.customer_id=v_customer_id and t.activity_id=v_activity.id
    and t.consumed_at is null and t.revoked_at is null
  for update;
  if found then
    update public.scan_tokens t
    set token_hash=p_scan_token_hash,
        qr_credential_id=v_qr_id,
        expires_at=p_scan_token_expiry,
        created_at=now()
    where t.id=v_open_token_id;
  else
    insert into public.scan_tokens(customer_id,activity_id,qr_credential_id,token_hash,expires_at)
    values(v_customer_id,v_activity.id,v_qr_id,p_scan_token_hash,p_scan_token_expiry);
  end if;

  -- Delete a bounded batch of old tokens only when audit history does not
  -- reference them. Consumed tokens linked to scan_events remain immutable.
  delete from public.scan_tokens t
  where t.id in (
    select old.id
    from public.scan_tokens old
    where old.expires_at<now()-interval '1 day'
      and not exists(select 1 from public.scan_events e where e.scan_token_id=old.id)
    order by old.expires_at
    limit 250
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug',a.slug,'name',a.display_name,'points',l.point_balance,
    'rewardsAvailable',l.rewards_available,'lastScannedAt',l.last_scanned_at,
    'pointsPerVisit',a.points_per_visit,'rewardThreshold',a.reward_threshold,
    'rewardText',a.reward_text,'rewardTextAr',a.reward_text_ar,
    'settingsVersion',a.settings_version
  ) order by a.sort_order),'[]'::jsonb)
  into v_balances
  from public.loyalty_accounts l
  join public.loyalty_activities a on a.id=l.activity_id
  where l.customer_id=v_customer_id and a.is_active;

  return query
  select c.display_name,c.member_code,v_activity.slug,v_activity.display_name,v_activity.settings_version,
    l.point_balance,l.rewards_available,l.last_scanned_at,
    v_activity.points_per_visit,v_activity.reward_threshold,v_activity.reward_text,
    v_activity.reward_text_ar,v_balances,p_scan_token_expiry
  from public.customers c
  join public.loyalty_accounts l on l.customer_id=c.id and l.activity_id=v_activity.id
  where c.id=v_customer_id
  limit 1;
end;
$$;

create or replace function public.logout_customer(p_session_hash text, p_qr_hash text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_customer_id uuid;
begin
  if length(p_session_hash)<>64 or length(p_qr_hash)<>64 then
    raise exception 'INVALID_INPUT';
  end if;

  select s.customer_id into v_customer_id
  from public.customer_sessions s
  join public.qr_credentials q on q.customer_id=s.customer_id
  where s.token_hash=p_session_hash and s.revoked_at is null
    and q.token_hash=p_qr_hash and q.status='active'
  for update of s,q;
  if not found then return false; end if;

  update public.customer_sessions s set revoked_at=now()
  where s.customer_id=v_customer_id and s.revoked_at is null;
  update public.qr_credentials q set status='revoked',revoked_at=now()
  where q.customer_id=v_customer_id and q.status='active';
  update public.scan_tokens t set revoked_at=now()
  where t.customer_id=v_customer_id and t.consumed_at is null and t.revoked_at is null;
  return true;
end;
$$;

revoke all on function public.member_summary_v3(text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.logout_customer(text,text) from public,anon,authenticated;
grant execute on function public.member_summary_v3(text,text,text,text,timestamptz) to service_role;
grant execute on function public.logout_customer(text,text) to service_role;

commit;
