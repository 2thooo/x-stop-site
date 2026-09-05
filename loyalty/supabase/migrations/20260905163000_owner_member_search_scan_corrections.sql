begin;

create table public.scan_count_corrections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  action text not null default 'scan_count_corrected' check (action = 'scan_count_corrected'),
  recorded_scan_count bigint not null check (recorded_scan_count >= 0),
  before_count bigint not null check (before_count >= 0),
  after_count bigint not null check (after_count >= 0),
  delta bigint generated always as (after_count - before_count) stored,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_display_name text not null,
  branch_name text not null,
  occurred_at timestamptz not null default now()
);

create index scan_count_corrections_customer_time_idx
  on public.scan_count_corrections(customer_id, occurred_at desc);
create index scan_count_corrections_time_idx
  on public.scan_count_corrections(occurred_at desc);

alter table public.scan_count_corrections enable row level security;
revoke all on table public.scan_count_corrections from public, anon, authenticated, service_role;

-- Audit rows are append-only even for privileged application roles. A database
-- administrator can still perform an explicit migration if repair is required.
create or replace function public.reject_scan_count_correction_mutation()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'SCAN_CORRECTION_IMMUTABLE';
end; $$;

create trigger scan_count_corrections_append_only
before update or delete or truncate on public.scan_count_corrections
for each statement execute function public.reject_scan_count_correction_mutation();

create or replace function public.owner_search_members(p_actor uuid, p_phone_query text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operator public.operator_profiles;
  v_digits text;
  v_normalized text;
  v_members jsonb;
begin
  v_operator := public.require_owner(p_actor);
  v_digits := regexp_replace(coalesce(p_phone_query, ''), '[^0-9]', '', 'g');
  if left(v_digits, 2) = '00' then v_digits := substring(v_digits from 3); end if;
  if char_length(v_digits) not between 4 and 15 then raise exception 'INVALID_INPUT'; end if;

  -- Search both the literal digit fragment and its likely UAE E.164 prefix.
  -- This supports full numbers, local 05..., 5..., +971..., and last-four searches.
  v_normalized := v_digits;
  if v_digits like '9710%' then
    v_normalized := '971' || substring(v_digits from 5);
  elsif v_digits like '05%' then
    v_normalized := '971' || substring(v_digits from 2);
  elsif v_digits like '5%' then
    v_normalized := '971' || v_digits;
  end if;

  select coalesce(jsonb_agg(q.member order by q.match_rank, q.created_at desc), '[]'::jsonb)
  into v_members
  from (
    select
      c.created_at,
      case
        when replace(c.phone_e164, '+', '') = v_normalized then 0
        when replace(c.phone_e164, '+', '') like v_normalized || '%' then 1
        else 2
      end as match_rank,
      jsonb_build_object(
        'customerId', c.id,
        'displayName', c.display_name,
        'memberCode', c.member_code,
        'phone', c.phone_e164,
        'status', c.status,
        'createdAt', c.created_at,
        'recordedScanCount', counts.recorded_scan_count,
        'scanCount', counts.recorded_scan_count + counts.correction_delta,
        'lastScannedAt', counts.last_scanned_at,
        'activityBalances', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'slug', a.slug,
            'name', a.display_name,
            'points', l.point_balance,
            'rewardsAvailable', l.rewards_available,
            'lastScannedAt', l.last_scanned_at,
            'pointsPerVisit', a.points_per_visit,
            'rewardThreshold', a.reward_threshold,
            'rewardText', a.reward_text,
            'rewardTextAr', a.reward_text_ar,
            'settingsVersion', a.settings_version
          ) order by a.sort_order), '[]'::jsonb)
          from public.loyalty_accounts l
          join public.loyalty_activities a on a.id=l.activity_id
          where l.customer_id=c.id and a.is_active
        ),
        'scanCorrections', (
          select coalesce(jsonb_agg(recent.row_data order by recent.occurred_at desc), '[]'::jsonb)
          from (
            select jsonb_build_object(
              'correctionId', sc.id,
              'action', sc.action,
              'recordedScanCount', sc.recorded_scan_count,
              'beforeCount', sc.before_count,
              'afterCount', sc.after_count,
              'delta', sc.delta,
              'reason', sc.reason,
              'actorUserId', sc.actor_user_id,
              'actorDisplayName', sc.actor_display_name,
              'branchName', sc.branch_name,
              'occurredAt', sc.occurred_at
            ) as row_data, sc.occurred_at
            from public.scan_count_corrections sc
            where sc.customer_id=c.id
            order by sc.occurred_at desc
            limit 20
          ) recent
        )
      ) as member
    from public.customers c
    cross join lateral (
      select
        (select count(*) from public.scan_events e
          where e.customer_id=c.id and e.action='scan_detected' and e.result='accepted')::bigint as recorded_scan_count,
        (select coalesce(sum(sc.delta), 0)::bigint from public.scan_count_corrections sc
          where sc.customer_id=c.id) as correction_delta,
        (select max(e.occurred_at) from public.scan_events e
          where e.customer_id=c.id and e.action='scan_detected' and e.result='accepted') as last_scanned_at
    ) counts
    where replace(c.phone_e164, '+', '') like '%' || v_digits || '%'
       or replace(c.phone_e164, '+', '') like v_normalized || '%'
    order by match_rank, c.created_at desc
    limit 20
  ) q;

  return jsonb_build_object('members', v_members);
end; $$;

create or replace function public.owner_set_scan_count(
  p_actor uuid, p_customer_id uuid, p_target_count bigint, p_reason text
)
returns table(
  correction_id uuid, action text, customer_id uuid, display_name text, member_code text,
  recorded_scan_count bigint, before_count bigint, after_count bigint, delta bigint,
  reason text, actor_user_id uuid, actor_display_name text, branch_name text,
  occurred_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operator public.operator_profiles;
  v_customer public.customers;
  v_recorded_scan_count bigint;
  v_correction_delta bigint;
  v_before_count bigint;
  v_correction public.scan_count_corrections;
begin
  v_operator := public.require_owner(p_actor);
  if p_customer_id is null or p_target_count is null or p_target_count < 0
     or p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'INVALID_INPUT';
  end if;

  -- SHARE ROW EXCLUSIVE conflicts with scan-event writers and with another
  -- correction transaction. It gives this short count-and-insert operation a
  -- stable base without changing or deleting any historical scan event.
  lock table public.scan_events in share row exclusive mode;

  select * into v_customer from public.customers c
  where c.id=p_customer_id
  for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  select count(*)::bigint into v_recorded_scan_count
  from public.scan_events e
  where e.customer_id=p_customer_id and e.action='scan_detected' and e.result='accepted';

  select coalesce(sum(sc.delta), 0)::bigint into v_correction_delta
  from public.scan_count_corrections sc
  where sc.customer_id=p_customer_id;

  v_before_count := v_recorded_scan_count + v_correction_delta;
  if v_before_count < 0 then raise exception 'SCAN_COUNT_INTEGRITY'; end if;

  insert into public.scan_count_corrections(
    customer_id, recorded_scan_count, before_count, after_count, reason,
    actor_user_id, actor_display_name, branch_name
  ) values (
    p_customer_id, v_recorded_scan_count, v_before_count, p_target_count, btrim(p_reason),
    p_actor, v_operator.display_name, v_operator.branch_name
  ) returning * into v_correction;

  return query select
    v_correction.id, v_correction.action, v_customer.id, v_customer.display_name,
    v_customer.member_code, v_correction.recorded_scan_count,
    v_correction.before_count, v_correction.after_count, v_correction.delta,
    v_correction.reason, v_correction.actor_user_id, v_correction.actor_display_name,
    v_correction.branch_name, v_correction.occurred_at;
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
  select
    (select count(*) from public.scan_events e
      where e.customer_id=v_customer.id and e.action='scan_detected' and e.result='accepted')
    + (select coalesce(sum(sc.delta),0)::bigint from public.scan_count_corrections sc
      where sc.customer_id=v_customer.id)
  into v_count;
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
      'recordedScans', (select count(*) from public.scan_events where action='scan_detected' and result='accepted'),
      'scans',
        (select count(*) from public.scan_events where action='scan_detected' and result='accepted')
        + (select coalesce(sum(delta),0)::bigint from public.scan_count_corrections),
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
        'recordedScanCount',(select count(*) from public.scan_events e where e.customer_id=c.id and e.action='scan_detected' and e.result='accepted'),
        'scanCount',
          (select count(*) from public.scan_events e where e.customer_id=c.id and e.action='scan_detected' and e.result='accepted')
          + (select coalesce(sum(sc.delta),0)::bigint from public.scan_count_corrections sc where sc.customer_id=c.id),
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
    ) history), '[]'::jsonb),
    'scanCorrections', coalesce((select jsonb_agg(row_data order by occurred_at desc) from (
      select jsonb_build_object(
        'correctionId',sc.id,'action',sc.action,
        'customerId',c.id,'displayName',c.display_name,'memberCode',c.member_code,
        'recordedScanCount',sc.recorded_scan_count,
        'beforeCount',sc.before_count,'afterCount',sc.after_count,'delta',sc.delta,
        'reason',sc.reason,'actorUserId',sc.actor_user_id,
        'actorDisplayName',sc.actor_display_name,'branchName',sc.branch_name,
        'occurredAt',sc.occurred_at
      ) row_data, sc.occurred_at
      from public.scan_count_corrections sc
      join public.customers c on c.id=sc.customer_id
      order by sc.occurred_at desc limit 1000
    ) corrections), '[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

revoke all on function public.reject_scan_count_correction_mutation() from public, anon, authenticated, service_role;
revoke all on function public.owner_search_members(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.owner_set_scan_count(uuid,uuid,bigint,text) from public, anon, authenticated, service_role;
revoke all on function public.owner_scan_v2(uuid,text) from public, anon, authenticated;
revoke all on function public.owner_dashboard(uuid,integer,integer) from public, anon, authenticated;

grant execute on function public.owner_search_members(uuid,text) to service_role;
grant execute on function public.owner_set_scan_count(uuid,uuid,bigint,text) to service_role;
grant execute on function public.owner_scan_v2(uuid,text) to service_role;
grant execute on function public.owner_dashboard(uuid,integer,integer) to service_role;

notify pgrst, 'reload schema';

commit;
