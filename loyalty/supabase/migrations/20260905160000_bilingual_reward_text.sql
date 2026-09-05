begin;

alter table public.loyalty_activities
  add column reward_text_ar text;

update public.loyalty_activities
set reward_text_ar = case slug
  when 'laser-tag' then '10 زيارات في الليزر تاغ تمنحك مكافأة'
  when 'bowling' then '10 زيارات في البولينغ تمنحك مكافأة'
  when 'escape-room' then '10 زيارات في غرفة الهروب تمنحك مكافأة'
  when 'billiard' then '10 زيارات في البلياردو تمنحك مكافأة'
  when 'gaming' then '10 زيارات في ألعاب الكمبيوتر والبلايستيشن تمنحك مكافأة'
  when 'others' then '10 زيارات تمنحك مكافأة'
end;

do $$
begin
  if exists(
    select 1 from public.loyalty_activities
    where reward_text_ar is null or char_length(btrim(reward_text_ar)) not between 1 and 200
  ) then
    raise exception 'Every loyalty activity needs a reviewed Arabic reward message before this migration can continue';
  end if;
end; $$;

alter table public.loyalty_activities
  alter column reward_text_ar set not null,
  add constraint loyalty_activities_reward_text_ar_length
    check (
      char_length(btrim(reward_text_ar)) between 1 and 200
      and reward_text_ar ~ '[ء-ي]'
    );

-- Versioned RPCs keep the existing production API callable while the Edge
-- Function is rolled forward. PostgreSQL cannot replace a RETURNS TABLE
-- function when the output row shape changes.
create or replace function public.member_summary_v2(
  p_session_hash text, p_qr_hash text, p_activity_slug text,
  p_scan_token_hash text, p_scan_token_expiry timestamptz
)
returns table(
  display_name text, member_code text, activity_slug text, activity_name text, activity_settings_version integer,
  points integer, rewards_available integer, last_scanned_at timestamptz,
  points_per_visit integer, reward_threshold integer, reward_text text, reward_text_ar text,
  activity_balances jsonb, scan_token_expires_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_customer_id uuid; v_qr_id uuid; v_activity public.loyalty_activities; v_balances jsonb;
begin
  select s.customer_id into v_customer_id from public.customer_sessions s
  join public.customers c on c.id=s.customer_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and c.status='active';
  if not found then raise exception 'SESSION_INVALID'; end if;
  select q.id into v_qr_id from public.qr_credentials q
  where q.customer_id=v_customer_id and q.token_hash=p_qr_hash and q.status='active';
  if not found then raise exception 'QR_INVALID'; end if;
  select * into v_activity from public.loyalty_activities a
  where a.slug=lower(trim(p_activity_slug)) and a.is_active;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;
  if length(p_scan_token_hash) <> 64
     or p_scan_token_expiry <= now()
     or p_scan_token_expiry > now() + interval '10 minutes' then
    raise exception 'INVALID_INPUT';
  end if;
  perform 1 from public.loyalty_accounts l
  where l.customer_id=v_customer_id and l.activity_id=v_activity.id
  for update;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;
  update public.customer_sessions set last_used_at=now() where token_hash=p_session_hash;
  update public.scan_tokens t set revoked_at=now()
  where t.customer_id=v_customer_id and t.activity_id=v_activity.id
    and t.consumed_at is null and t.revoked_at is null;
  insert into public.scan_tokens(customer_id, activity_id, qr_credential_id, token_hash, expires_at)
  values (v_customer_id, v_activity.id, v_qr_id, p_scan_token_hash, p_scan_token_expiry);
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', a.slug, 'name', a.display_name, 'points', l.point_balance,
    'rewardsAvailable', l.rewards_available, 'lastScannedAt', l.last_scanned_at,
    'pointsPerVisit', a.points_per_visit, 'rewardThreshold', a.reward_threshold,
    'rewardText', a.reward_text, 'rewardTextAr', a.reward_text_ar,
    'settingsVersion', a.settings_version
  ) order by a.sort_order), '[]'::jsonb)
  into v_balances
  from public.loyalty_accounts l
  join public.loyalty_activities a on a.id=l.activity_id
  where l.customer_id=v_customer_id and a.is_active;
  return query
  select c.display_name, c.member_code, v_activity.slug, v_activity.display_name, v_activity.settings_version,
    l.point_balance, l.rewards_available, l.last_scanned_at,
    v_activity.points_per_visit, v_activity.reward_threshold, v_activity.reward_text,
    v_activity.reward_text_ar, v_balances, p_scan_token_expiry
  from public.customers c
  join public.loyalty_accounts l on l.customer_id=c.id and l.activity_id=v_activity.id
  where c.id=v_customer_id limit 1;
end; $$;

create or replace function public.owner_update_activity_settings_v2(
  p_actor uuid, p_activity_slug text, p_points_per_visit integer,
  p_reward_threshold integer, p_reward_text text, p_reward_text_ar text
)
returns table(
  activity_slug text, activity_name text, points_per_visit integer,
  reward_threshold integer, reward_text text, reward_text_ar text,
  settings_version integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_activity public.loyalty_activities;
begin
  v_operator := public.require_owner(p_actor);
  if p_points_per_visit is null or p_reward_threshold is null
     or p_reward_text is null or p_reward_text_ar is null
     or p_points_per_visit not between 1 and 20
     or p_reward_threshold not between 2 and 1000
     or length(trim(p_reward_text)) not between 1 and 200
     or length(trim(p_reward_text_ar)) not between 1 and 200 then
    raise exception 'INVALID_INPUT';
  end if;

  select * into v_activity from public.loyalty_activities a
  where a.slug=lower(trim(p_activity_slug)) and a.is_active
  for update;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;
  if exists(
    select 1 from public.loyalty_accounts l
    where l.activity_id=v_activity.id and l.point_balance>=p_reward_threshold
  ) then
    raise exception 'ACTIVITY_THRESHOLD_CONFLICT';
  end if;

  update public.loyalty_activities a
  set points_per_visit=p_points_per_visit, reward_threshold=p_reward_threshold,
    reward_text=trim(p_reward_text), reward_text_ar=trim(p_reward_text_ar),
    settings_version=a.settings_version+1, updated_at=now()
  where a.id=v_activity.id
  returning a.* into v_activity;
  return query select v_activity.slug, v_activity.display_name, v_activity.points_per_visit,
    v_activity.reward_threshold, v_activity.reward_text, v_activity.reward_text_ar,
    v_activity.settings_version;
end; $$;

create or replace function public.owner_scan_v2(p_actor uuid, p_scan_token_hash text)
returns table(
  scan_event_id uuid, customer_id uuid, display_name text,
  activity_slug text, activity_name text, points integer, rewards_available integer,
  scan_count bigint, previous_scan_at timestamptz, points_per_visit integer,
  reward_threshold integer, reward_text text, reward_text_ar text,
  activity_settings_version integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_customer public.customers; v_qr public.qr_credentials;
declare v_scan_token public.scan_tokens; v_activity public.loyalty_activities; v_loyalty public.loyalty_accounts;
declare v_settings public.business_settings; v_scan_id uuid; v_previous timestamptz; v_count bigint;
begin
  v_operator := public.require_owner(p_actor);
  select * into v_scan_token from public.scan_tokens where token_hash=p_scan_token_hash;
  if not found then raise exception 'SCAN_TOKEN_INVALID'; end if;
  select * into v_activity from public.loyalty_activities
  where id=v_scan_token.activity_id and is_active;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;
  select * into v_loyalty from public.loyalty_accounts l
  where l.customer_id=v_scan_token.customer_id and l.activity_id=v_activity.id for update;
  if not found then raise exception 'ACTIVITY_INVALID'; end if;
  select * into v_scan_token from public.scan_tokens
  where id=v_scan_token.id and token_hash=p_scan_token_hash for update;
  if not found then raise exception 'SCAN_TOKEN_INVALID'; end if;
  if v_scan_token.revoked_at is not null then raise exception 'SCAN_TOKEN_REPLACED'; end if;
  if v_scan_token.consumed_at is not null then raise exception 'SCAN_TOKEN_USED'; end if;
  if v_scan_token.expires_at <= now() then raise exception 'SCAN_TOKEN_EXPIRED'; end if;
  select * into v_qr from public.qr_credentials q
  where q.id=v_scan_token.qr_credential_id and q.customer_id=v_scan_token.customer_id and q.status='active'
  for update;
  if not found then raise exception 'QR_INVALID'; end if;
  select * into v_customer from public.customers where id=v_qr.customer_id and status='active';
  if not found then raise exception 'CUSTOMER_INACTIVE'; end if;
  if v_customer.id<>v_loyalty.customer_id then raise exception 'SCAN_TOKEN_INVALID'; end if;
  select * into v_settings from public.business_settings limit 1;
  v_previous := v_loyalty.last_scanned_at;
  if v_previous is not null and extract(epoch from (now()-v_previous)) < v_settings.scan_cooldown_seconds then
    raise exception 'SCAN_COOLDOWN';
  end if;
  insert into public.scan_events(customer_id, activity_id, qr_credential_id, scan_token_id, owner_user_id, branch_name, action, balance_before, balance_after, rewards_before, rewards_after, activity_settings_version)
  values(v_customer.id, v_activity.id, v_qr.id, v_scan_token.id, p_actor, v_operator.branch_name, 'scan_detected', v_loyalty.point_balance, v_loyalty.point_balance, v_loyalty.rewards_available, v_loyalty.rewards_available, v_activity.settings_version)
  returning id into v_scan_id;
  update public.scan_tokens set consumed_at=now(), consumed_by=p_actor where id=v_scan_token.id;
  update public.loyalty_accounts l set last_scanned_at=now(), updated_at=now(), version=l.version+1
  where l.customer_id=v_customer.id and l.activity_id=v_activity.id;
  select count(*) into v_count from public.scan_events e
  where e.customer_id=v_customer.id and e.activity_id=v_activity.id and e.action='scan_detected' and e.result='accepted';
  return query select v_scan_id, v_customer.id, v_customer.display_name,
    v_activity.slug, v_activity.display_name, v_loyalty.point_balance, v_loyalty.rewards_available,
    v_count, v_previous, v_activity.points_per_visit, v_activity.reward_threshold,
    v_activity.reward_text, v_activity.reward_text_ar, v_activity.settings_version;
end; $$;

create or replace function public.owner_dashboard(
  p_actor uuid, p_customer_limit integer default 250, p_customer_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_result jsonb; v_customer_count bigint;
begin
  v_operator := public.require_owner(p_actor);
  if p_customer_limit not between 1 and 500 or p_customer_offset<0 then raise exception 'INVALID_INPUT'; end if;
  select count(*) into v_customer_count from public.customers where status='active';
  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'customers', (select count(*) from public.customers where status='active'),
      'scans', (select count(*) from public.scan_events where action='scan_detected' and result='accepted'),
      'pointsAwarded', (select coalesce(sum(point_delta),0) from public.scan_events where action='visit_point' and result='accepted'),
      'scansToday', (select count(*) from public.scan_events where action='scan_detected' and occurred_at >= date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'),
      'activityBreakdown', coalesce((select jsonb_agg(jsonb_build_object(
        'slug',a.slug,'name',a.display_name,
        'pointsPerVisit',a.points_per_visit,'rewardThreshold',a.reward_threshold,
        'rewardText',a.reward_text,'rewardTextAr',a.reward_text_ar,'settingsVersion',a.settings_version,
        'scans',(select count(*) from public.scan_events e where e.activity_id=a.id and e.action='scan_detected' and e.result='accepted'),
        'pointsAwarded',(select coalesce(sum(e.point_delta),0) from public.scan_events e where e.activity_id=a.id and e.action='visit_point' and e.result='accepted')
      ) order by a.sort_order) from public.loyalty_activities a where a.is_active), '[]'::jsonb)
    ),
    'customers', coalesce((select jsonb_agg(row_data order by (row_data->>'lastScannedAt') desc nulls last) from (
      select jsonb_build_object('customerId',c.id,'displayName',c.display_name,'memberCode',c.member_code,
        'maskedPhone',left(c.phone_e164,4)||'••••'||right(c.phone_e164,3),
        'scanCount',(select count(*) from public.scan_events e where e.customer_id=c.id and e.action='scan_detected' and e.result='accepted'),
        'lastScannedAt',(select max(l.last_scanned_at) from public.loyalty_accounts l where l.customer_id=c.id),
        'activityBalances',(select coalesce(jsonb_agg(jsonb_build_object(
          'slug',a.slug,'name',a.display_name,'points',l.point_balance,
          'rewardsAvailable',l.rewards_available,'lastScannedAt',l.last_scanned_at,
          'pointsPerVisit',a.points_per_visit,'rewardThreshold',a.reward_threshold,
          'rewardText',a.reward_text,'rewardTextAr',a.reward_text_ar,'settingsVersion',a.settings_version
        ) order by a.sort_order), '[]'::jsonb)
          from public.loyalty_accounts l join public.loyalty_activities a on a.id=l.activity_id
          where l.customer_id=c.id and a.is_active)) row_data
      from public.customers c where c.status='active'
      order by (select max(l.last_scanned_at) from public.loyalty_accounts l where l.customer_id=c.id) desc nulls last, c.created_at desc
      limit p_customer_limit offset p_customer_offset
    ) q), '[]'::jsonb),
    'customerPage', jsonb_build_object(
      'total',v_customer_count,'limit',p_customer_limit,'offset',p_customer_offset,
      'hasMore',p_customer_offset+p_customer_limit<v_customer_count
    ),
    'recentEvents', coalesce((select jsonb_agg(row_data order by (row_data->>'occurredAt') desc) from (
      select jsonb_build_object('id',e.id,'displayName',c.display_name,'memberCode',c.member_code,
        'activitySlug',a.slug,'activityName',a.display_name,
        'action',e.action,'pointDelta',e.point_delta,'rewardDelta',e.reward_delta,'balanceBefore',e.balance_before,
        'balanceAfter',e.balance_after,'rewardsBefore',e.rewards_before,'rewardsAfter',e.rewards_after,
        'settingsVersion',e.activity_settings_version,'occurredAt',e.occurred_at,'branchName',e.branch_name) row_data
      from public.scan_events e join public.customers c on c.id=e.customer_id
      join public.loyalty_activities a on a.id=e.activity_id
      where e.result='accepted' order by e.occurred_at desc limit 1000
    ) history), '[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

-- New functions receive PUBLIC execute by default, so close that window in the
-- same transaction and grant access only to the server-side service role.
-- Also retire the English-only settings writer immediately: leaving it callable
-- would allow a stale server deployment to desynchronise the two messages.
revoke execute on function public.owner_update_activity_settings(uuid,text,integer,integer,text) from service_role;
revoke all on function public.member_summary_v2(text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.owner_update_activity_settings_v2(uuid,text,integer,integer,text,text) from public, anon, authenticated;
revoke all on function public.owner_scan_v2(uuid,text) from public, anon, authenticated;
revoke all on function public.owner_dashboard(uuid,integer,integer) from public, anon, authenticated;

grant execute on function public.member_summary_v2(text,text,text,text,timestamptz) to service_role;
grant execute on function public.owner_update_activity_settings_v2(uuid,text,integer,integer,text,text) to service_role;
grant execute on function public.owner_scan_v2(uuid,text) to service_role;
grant execute on function public.owner_dashboard(uuid,integer,integer) to service_role;

notify pgrst, 'reload schema';

commit;
