create extension if not exists pgcrypto;

create table public.business_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text not null default 'X Entertainment RAK Mall',
  program_name text not null default 'X Rewards',
  scan_cooldown_seconds integer not null default 60 check (scan_cooldown_seconds between 0 and 86400),
  timezone text not null default 'Asia/Dubai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index business_settings_singleton on public.business_settings ((true));
insert into public.business_settings default values;

create table public.operator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'viewer')),
  branch_name text not null default 'Main',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  member_code text not null unique check (length(member_code) between 8 and 32),
  display_name text not null check (length(display_name) between 1 and 60),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  pin_salt text not null,
  pin_hash text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  consented_at timestamptz not null,
  privacy_policy_version text not null default '1.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.loyalty_activities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(display_name) between 1 and 60),
  sort_order integer not null unique check (sort_order > 0),
  points_per_visit integer not null default 1 check (points_per_visit between 1 and 20),
  reward_threshold integer not null default 10 check (reward_threshold between 2 and 1000),
  reward_text text not null,
  settings_version integer not null default 1 check (settings_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.loyalty_activities(slug, display_name, sort_order, points_per_visit, reward_threshold, reward_text) values
  ('laser-tag', 'Laser Tag', 1, 1, 10, '10 Laser Tag visits unlock a reward'),
  ('bowling', 'Bowling', 2, 1, 10, '10 Bowling visits unlock a reward'),
  ('escape-room', 'Escape Room', 3, 1, 10, '10 Escape Room visits unlock a reward'),
  ('billiard', 'Billiard', 4, 1, 10, '10 Billiard visits unlock a reward'),
  ('gaming', 'PC & PlayStation', 5, 1, 10, '10 PC & PlayStation visits unlock a reward'),
  ('others', 'Others', 6, 1, 10, '10 visits unlock a reward');

create table public.loyalty_accounts (
  customer_id uuid not null references public.customers(id) on delete restrict,
  activity_id uuid not null references public.loyalty_activities(id) on delete restrict,
  point_balance integer not null default 0 check (point_balance >= 0),
  lifetime_visit_points integer not null default 0 check (lifetime_visit_points >= 0),
  rewards_available integer not null default 0 check (rewards_available >= 0),
  lifetime_rewards_redeemed integer not null default 0 check (lifetime_rewards_redeemed >= 0),
  last_scanned_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (customer_id, activity_id)
);
create index loyalty_accounts_activity_idx on public.loyalty_accounts(activity_id, customer_id);

create table public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_sessions_customer_idx on public.customer_sessions(customer_id);
create index customer_sessions_expiry_idx on public.customer_sessions(expires_at);
create unique index one_unrevoked_session_per_customer on public.customer_sessions(customer_id)
  where revoked_at is null;

create table public.qr_credentials (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index qr_credentials_customer_idx on public.qr_credentials(customer_id);
create unique index one_active_qr_per_customer on public.qr_credentials(customer_id)
  where status='active';

-- Enrollment remains public at the HTTP edge, but every account creation must
-- atomically redeem a short-lived invitation created by an authenticated owner.
-- Only the SHA-256 digest is persisted; the raw invitation is returned once by
-- the Edge Function and cannot be recovered from the database.
create table public.enrollment_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (length(code_hash) = 64),
  created_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_customer_id uuid references public.customers(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (redeemed_customer_id is null or redeemed_at is not null)
);
create index enrollment_invites_expiry_idx on public.enrollment_invites(expires_at);

-- An owner may create this one-time code only after verifying the customer in
-- person. The customer, not the owner, chooses the replacement PIN.
create table public.pin_reset_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  code_hash text not null unique check (length(code_hash) = 64),
  created_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (redeemed_at is not null and revoked_at is not null))
);
create index pin_reset_codes_customer_idx on public.pin_reset_codes(customer_id, created_at desc);
create index pin_reset_codes_expiry_idx on public.pin_reset_codes(expires_at);

-- qr_credentials authenticate a member device. scan_tokens are deliberately
-- separate, short-lived bearer capabilities displayed in the rendered QR and
-- consumed once by owner_scan.
create table public.scan_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  activity_id uuid not null references public.loyalty_activities(id) on delete restrict,
  qr_credential_id uuid not null references public.qr_credentials(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_by is null or consumed_at is not null),
  check (not (consumed_at is not null and revoked_at is not null))
);
create index scan_tokens_customer_idx on public.scan_tokens(customer_id, created_at desc);
create index scan_tokens_expiry_idx on public.scan_tokens(expires_at);
create unique index one_open_scan_token_per_activity
  on public.scan_tokens(customer_id, activity_id)
  where consumed_at is null and revoked_at is null;

create table public.scan_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  activity_id uuid not null references public.loyalty_activities(id) on delete restrict,
  qr_credential_id uuid references public.qr_credentials(id) on delete restrict,
  scan_token_id uuid references public.scan_tokens(id) on delete restrict,
  owner_user_id uuid references auth.users(id) on delete restrict,
  source_scan_event_id uuid references public.scan_events(id) on delete restrict,
  branch_name text not null default 'Main',
  action text not null check (action in ('scan_detected','scan_cancelled','visit_point','redeem','correction_add','correction_remove','token_revoked')),
  point_delta integer not null default 0,
  reward_delta integer not null default 0,
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  rewards_before integer not null default 0 check (rewards_before >= 0),
  rewards_after integer not null default 0 check (rewards_after >= 0),
  activity_settings_version integer not null default 1 check (activity_settings_version > 0),
  idempotency_key uuid unique,
  result text not null default 'accepted' check (result in ('accepted','rejected')),
  reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index scan_events_customer_time_idx on public.scan_events(customer_id, occurred_at desc);
create index scan_events_owner_time_idx on public.scan_events(owner_user_id, occurred_at desc);
create index scan_events_recent_idx on public.scan_events(occurred_at desc) where result='accepted';
create index scan_events_activity_action_idx on public.scan_events(activity_id, action, occurred_at desc) where result='accepted';
create unique index one_resolution_per_scan on public.scan_events(source_scan_event_id)
  where action in ('visit_point','redeem','scan_cancelled') and result = 'accepted';
create unique index one_scan_per_token on public.scan_events(scan_token_id)
  where scan_token_id is not null and action = 'scan_detected' and result = 'accepted';

create table public.auth_attempts (
  identifier_hash text primary key check (length(identifier_hash) = 64),
  failures integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index auth_attempts_updated_idx on public.auth_attempts(updated_at);

alter table public.business_settings enable row level security;
alter table public.operator_profiles enable row level security;
alter table public.customers enable row level security;
alter table public.loyalty_activities enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.qr_credentials enable row level security;
alter table public.enrollment_invites enable row level security;
alter table public.pin_reset_codes enable row level security;
alter table public.scan_tokens enable row level security;
alter table public.scan_events enable row level security;
alter table public.auth_attempts enable row level security;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

create or replace function public.require_owner(p_actor uuid)
returns public.operator_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles;
begin
  select * into v_operator from public.operator_profiles where user_id = p_actor and role = 'owner' and is_active;
  if not found then raise exception 'OWNER_REQUIRED'; end if;
  return v_operator;
end; $$;

create or replace function public.owner_create_enrollment_invite(
  p_actor uuid, p_code_hash text, p_expires_at timestamptz
) returns table(invite_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_invite_id uuid;
begin
  v_operator := public.require_owner(p_actor);
  if length(p_code_hash) <> 64
     or p_expires_at <= now() + interval '1 minute'
     or p_expires_at > now() + interval '7 days' then
    raise exception 'INVALID_INPUT';
  end if;
  insert into public.enrollment_invites(code_hash, created_by, expires_at)
  values (p_code_hash, p_actor, p_expires_at)
  returning id into v_invite_id;
  return query select v_invite_id, p_expires_at;
end; $$;

create or replace function public.enroll_customer(
  p_phone text, p_display_name text, p_pin_salt text, p_pin_hash text,
  p_member_code text, p_qr_hash text, p_session_hash text, p_session_expiry timestamptz,
  p_invite_hash text
) returns table(customer_id uuid, member_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_customer_id uuid; v_invite_id uuid;
begin
  -- FOR UPDATE serializes two concurrent redemptions of the same invitation.
  select i.id into v_invite_id
  from public.enrollment_invites i
  where i.code_hash = p_invite_hash and i.redeemed_at is null and i.expires_at > now()
  for update;
  if not found then raise exception 'INVITE_INVALID'; end if;

  insert into public.customers(member_code, display_name, phone_e164, pin_salt, pin_hash, consented_at)
  values (p_member_code, trim(p_display_name), p_phone, p_pin_salt, p_pin_hash, now()) returning id into v_customer_id;
  insert into public.loyalty_accounts(customer_id, activity_id)
  select v_customer_id, a.id from public.loyalty_activities a where a.is_active;
  insert into public.qr_credentials(customer_id, token_hash) values (v_customer_id, p_qr_hash);
  insert into public.customer_sessions(customer_id, token_hash, expires_at) values (v_customer_id, p_session_hash, p_session_expiry);
  update public.enrollment_invites
  set redeemed_at = now(), redeemed_customer_id = v_customer_id
  where id = v_invite_id;
  return query select v_customer_id, p_member_code;
exception when unique_violation then raise exception 'ACCOUNT_EXISTS';
end; $$;

create or replace function public.get_customer_auth_record(p_phone text)
returns table(customer_id uuid, display_name text, pin_salt text, pin_hash text, status text)
language sql security definer set search_path = public, pg_temp as $$
  select id, display_name, pin_salt, pin_hash, status from public.customers where phone_e164 = p_phone limit 1;
$$;

create or replace function public.rotate_customer_access(
  p_customer_id uuid, p_qr_hash text, p_session_hash text, p_session_expiry timestamptz
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.customers c where c.id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  update public.qr_credentials set status='revoked', revoked_at=now() where customer_id=p_customer_id and status='active';
  update public.customer_sessions set revoked_at=now() where customer_id=p_customer_id and revoked_at is null;
  insert into public.qr_credentials(customer_id, token_hash) values (p_customer_id, p_qr_hash);
  insert into public.customer_sessions(customer_id, token_hash, expires_at) values (p_customer_id, p_session_hash, p_session_expiry);
end; $$;

create or replace function public.rotate_customer_access_for_login(
  p_customer_id uuid, p_expected_pin_hash text, p_qr_hash text,
  p_session_hash text, p_session_expiry timestamptz, p_identifier_hash text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.customers c
  where c.id=p_customer_id and c.pin_hash=p_expected_pin_hash and c.status='active'
  for update;
  if not found then raise exception 'LOGIN_FAILED'; end if;
  perform public.rotate_customer_access(p_customer_id, p_qr_hash, p_session_hash, p_session_expiry);
  delete from public.auth_attempts a where a.identifier_hash=p_identifier_hash;
end; $$;

create or replace function public.member_summary(
  p_session_hash text, p_qr_hash text, p_activity_slug text,
  p_scan_token_hash text, p_scan_token_expiry timestamptz
)
returns table(
  display_name text, member_code text, activity_slug text, activity_name text, activity_settings_version integer,
  points integer, rewards_available integer, last_scanned_at timestamptz,
  points_per_visit integer, reward_threshold integer, reward_text text, activity_balances jsonb,
  scan_token_expires_at timestamptz
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
    'rewardText', a.reward_text, 'settingsVersion', a.settings_version
  ) order by a.sort_order), '[]'::jsonb)
  into v_balances
  from public.loyalty_accounts l
  join public.loyalty_activities a on a.id=l.activity_id
  where l.customer_id=v_customer_id and a.is_active;
  return query
  select c.display_name, c.member_code, v_activity.slug, v_activity.display_name, v_activity.settings_version,
    l.point_balance, l.rewards_available, l.last_scanned_at,
    v_activity.points_per_visit, v_activity.reward_threshold, v_activity.reward_text,
    v_balances, p_scan_token_expiry
  from public.customers c
  join public.loyalty_accounts l on l.customer_id=c.id and l.activity_id=v_activity.id
  where c.id=v_customer_id limit 1;
end; $$;

create or replace function public.owner_check(p_actor uuid)
returns table(display_name text, branch_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles;
begin
  v_operator := public.require_owner(p_actor);
  return query select v_operator.display_name, v_operator.branch_name;
end; $$;

create or replace function public.owner_update_activity_settings(
  p_actor uuid, p_activity_slug text, p_points_per_visit integer,
  p_reward_threshold integer, p_reward_text text
)
returns table(activity_slug text, activity_name text, points_per_visit integer, reward_threshold integer, reward_text text, settings_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_activity public.loyalty_activities;
begin
  v_operator := public.require_owner(p_actor);
  if p_points_per_visit is null or p_reward_threshold is null or p_reward_text is null
     or p_points_per_visit not between 1 and 20
     or p_reward_threshold not between 2 and 1000
     or length(trim(p_reward_text)) not between 1 and 200 then
    raise exception 'INVALID_INPUT';
  end if;

  -- Lock the activity before inspecting balances. Award transactions take a
  -- shared lock on this same row, so the compatibility check cannot race an
  -- in-flight visit award.
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
    reward_text=trim(p_reward_text), settings_version=a.settings_version+1, updated_at=now()
  where a.id=v_activity.id
  returning a.* into v_activity;
  return query select v_activity.slug, v_activity.display_name, v_activity.points_per_visit,
    v_activity.reward_threshold, v_activity.reward_text, v_activity.settings_version;
end; $$;

create or replace function public.owner_create_pin_reset(
  p_actor uuid, p_customer_id uuid, p_phone text, p_code_hash text, p_expires_at timestamptz
)
returns table(customer_id uuid, member_code text, display_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_customer public.customers;
begin
  v_operator := public.require_owner(p_actor);
  if (p_customer_id is null and p_phone is null)
     or length(p_code_hash) <> 64
     or p_expires_at <= now() + interval '1 minute'
     or p_expires_at > now() + interval '1 hour' then
    raise exception 'INVALID_INPUT';
  end if;
  select * into v_customer from public.customers c
  where (p_customer_id is null or c.id=p_customer_id)
    and (p_phone is null or c.phone_e164=p_phone)
    and c.status='active'
  limit 1 for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  update public.pin_reset_codes r
  set revoked_at=now()
  where r.customer_id=v_customer.id and r.redeemed_at is null and r.revoked_at is null;
  insert into public.pin_reset_codes(customer_id, code_hash, created_by, expires_at)
  values (v_customer.id, p_code_hash, p_actor, p_expires_at);
  return query select v_customer.id, v_customer.member_code, v_customer.display_name, p_expires_at;
end; $$;

create or replace function public.recover_customer_pin(
  p_phone text, p_code_hash text, p_pin_salt text, p_pin_hash text,
  p_qr_hash text, p_session_hash text, p_session_expiry timestamptz,
  p_recovery_identifier_hash text, p_login_identifier_hash text
)
returns table(customer_id uuid, member_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reset_id uuid; v_target_customer_id uuid; v_customer public.customers;
begin
  select r.customer_id into v_target_customer_id
  from public.pin_reset_codes r
  join public.customers c on c.id=r.customer_id
  where r.code_hash=p_code_hash and c.phone_e164=p_phone and c.status='active'
    and r.redeemed_at is null and r.revoked_at is null and r.expires_at>now()
  limit 1;
  if not found then raise exception 'RESET_INVALID'; end if;
  select * into v_customer from public.customers c
  where c.id=v_target_customer_id and c.phone_e164=p_phone and c.status='active'
  for update;
  if not found then raise exception 'RESET_INVALID'; end if;
  select r.id into v_reset_id from public.pin_reset_codes r
  where r.customer_id=v_customer.id and r.code_hash=p_code_hash
    and r.redeemed_at is null and r.revoked_at is null and r.expires_at>now()
  for update;
  if not found then raise exception 'RESET_INVALID'; end if;

  update public.customers
  set pin_salt=p_pin_salt, pin_hash=p_pin_hash, updated_at=now()
  where id=v_customer.id;
  perform public.rotate_customer_access(v_customer.id, p_qr_hash, p_session_hash, p_session_expiry);
  update public.pin_reset_codes r set redeemed_at=now() where r.id=v_reset_id;
  update public.pin_reset_codes r set revoked_at=now()
  where r.customer_id=v_customer.id and r.id<>v_reset_id and r.redeemed_at is null and r.revoked_at is null;
  delete from public.auth_attempts a
  where a.identifier_hash in (p_recovery_identifier_hash, p_login_identifier_hash);
  return query select v_customer.id, v_customer.member_code;
end; $$;

create or replace function public.owner_scan(p_actor uuid, p_scan_token_hash text)
returns table(
  scan_event_id uuid, customer_id uuid, display_name text,
  activity_slug text, activity_name text, points integer, rewards_available integer,
  scan_count bigint, previous_scan_at timestamptz, points_per_visit integer,
  reward_threshold integer, reward_text text, activity_settings_version integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_customer public.customers; v_qr public.qr_credentials;
declare v_scan_token public.scan_tokens; v_activity public.loyalty_activities; v_loyalty public.loyalty_accounts;
declare v_settings public.business_settings; v_scan_id uuid; v_previous timestamptz; v_count bigint;
begin
  v_operator := public.require_owner(p_actor);
  -- Read the binding, lock its activity ledger (the shared serialization point
  -- used by member_summary), then lock and re-check the token itself.
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
    v_count, v_previous, v_activity.points_per_visit, v_activity.reward_threshold, v_activity.reward_text,
    v_activity.settings_version;
end; $$;

create or replace function public.owner_add_visit_point(p_actor uuid, p_scan_event_id uuid, p_idempotency_key uuid)
returns table(transaction_id uuid, activity_slug text, activity_name text, points integer, rewards_available integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_scan public.scan_events; v_loyalty public.loyalty_accounts;
declare v_activity public.loyalty_activities;
declare v_tx uuid; v_existing_source uuid; v_existing_action text; v_existing_owner uuid;
declare v_existing_slug text; v_existing_name text; v_new_points integer; v_rewards integer;
begin
  v_operator := public.require_owner(p_actor);
  if p_idempotency_key is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select e.id, e.source_scan_event_id, e.action, e.owner_user_id,
    a.slug, a.display_name, e.balance_after, e.rewards_after
  into v_tx, v_existing_source, v_existing_action, v_existing_owner,
    v_existing_slug, v_existing_name, v_new_points, v_rewards
  from public.scan_events e
  join public.loyalty_activities a on a.id=e.activity_id
  where e.idempotency_key=p_idempotency_key;
  if found then
    if v_existing_source is distinct from p_scan_event_id or v_existing_action<>'visit_point'
       or v_existing_owner is distinct from p_actor then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return query select v_tx, v_existing_slug, v_existing_name, v_new_points, v_rewards; return;
  end if;
  select * into v_scan from public.scan_events
  where id=p_scan_event_id and action='scan_detected' and owner_user_id=p_actor
  for update;
  if not found then raise exception 'SCAN_INVALID'; end if;
  if exists(select 1 from public.scan_events where source_scan_event_id=p_scan_event_id and action in ('visit_point','redeem','scan_cancelled')) then
    raise exception 'SCAN_ALREADY_RESOLVED';
  end if;
  select * into v_activity from public.loyalty_activities where id=v_scan.activity_id for share;
  if not found or v_activity.settings_version<>v_scan.activity_settings_version then
    raise exception 'ACTIVITY_SETTINGS_CHANGED';
  end if;
  select * into v_loyalty from public.loyalty_accounts
  where customer_id=v_scan.customer_id and activity_id=v_scan.activity_id for update;
  v_new_points := v_loyalty.point_balance + v_activity.points_per_visit;
  v_rewards := v_loyalty.rewards_available;
  while v_new_points >= v_activity.reward_threshold loop
    v_new_points := v_new_points - v_activity.reward_threshold; v_rewards := v_rewards + 1;
  end loop;
  insert into public.scan_events(customer_id, activity_id, qr_credential_id, owner_user_id, source_scan_event_id, branch_name, action, point_delta, reward_delta, balance_before, balance_after, rewards_before, rewards_after, activity_settings_version, idempotency_key)
  values(v_scan.customer_id, v_scan.activity_id, v_scan.qr_credential_id, p_actor, p_scan_event_id, v_operator.branch_name, 'visit_point', v_activity.points_per_visit, v_rewards-v_loyalty.rewards_available, v_loyalty.point_balance, v_new_points, v_loyalty.rewards_available, v_rewards, v_activity.settings_version, p_idempotency_key)
  returning id into v_tx;
  update public.loyalty_accounts set point_balance=v_new_points, lifetime_visit_points=lifetime_visit_points+v_activity.points_per_visit,
    rewards_available=v_rewards, updated_at=now(), version=version+1
  where customer_id=v_scan.customer_id and activity_id=v_scan.activity_id;
  return query select v_tx, v_activity.slug, v_activity.display_name, v_new_points, v_rewards;
end; $$;

create or replace function public.owner_redeem_reward(p_actor uuid, p_scan_event_id uuid, p_idempotency_key uuid)
returns table(transaction_id uuid, activity_slug text, activity_name text, points integer, rewards_available integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_scan public.scan_events; v_loyalty public.loyalty_accounts;
declare v_activity public.loyalty_activities; v_tx uuid; v_existing_source uuid;
declare v_existing_action text; v_existing_owner uuid;
declare v_existing_slug text; v_existing_name text; v_points integer; v_rewards integer;
begin
  v_operator := public.require_owner(p_actor);
  if p_idempotency_key is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select e.id, e.source_scan_event_id, e.action, e.owner_user_id,
    a.slug, a.display_name, e.balance_after, e.rewards_after
  into v_tx, v_existing_source, v_existing_action, v_existing_owner,
    v_existing_slug, v_existing_name, v_points, v_rewards
  from public.scan_events e
  join public.loyalty_activities a on a.id=e.activity_id
  where e.idempotency_key=p_idempotency_key;
  if found then
    if v_existing_source is distinct from p_scan_event_id or v_existing_action<>'redeem'
       or v_existing_owner is distinct from p_actor then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return query select v_tx, v_existing_slug, v_existing_name, v_points, v_rewards; return;
  end if;

  select * into v_scan from public.scan_events
  where id=p_scan_event_id and action='scan_detected' and owner_user_id=p_actor
  for update;
  if not found then raise exception 'SCAN_INVALID'; end if;
  if exists(select 1 from public.scan_events e where e.source_scan_event_id=p_scan_event_id and e.action in ('visit_point','redeem','scan_cancelled')) then
    raise exception 'SCAN_ALREADY_RESOLVED';
  end if;
  select * into v_activity from public.loyalty_activities a where a.id=v_scan.activity_id;
  select * into v_loyalty from public.loyalty_accounts l
  where l.customer_id=v_scan.customer_id and l.activity_id=v_scan.activity_id for update;
  if not found or v_loyalty.rewards_available<1 then raise exception 'NO_REWARD_AVAILABLE'; end if;
  v_points := v_loyalty.point_balance; v_rewards := v_loyalty.rewards_available-1;
  insert into public.scan_events(customer_id, activity_id, qr_credential_id, owner_user_id, source_scan_event_id, branch_name, action, reward_delta, balance_before, balance_after, rewards_before, rewards_after, activity_settings_version, idempotency_key)
  values(v_scan.customer_id, v_scan.activity_id, v_scan.qr_credential_id, p_actor, p_scan_event_id, v_operator.branch_name, 'redeem', -1, v_points, v_points, v_loyalty.rewards_available, v_rewards, v_scan.activity_settings_version, p_idempotency_key)
  returning id into v_tx;
  update public.loyalty_accounts l
  set rewards_available=v_rewards, lifetime_rewards_redeemed=l.lifetime_rewards_redeemed+1,
    updated_at=now(), version=l.version+1
  where l.customer_id=v_scan.customer_id and l.activity_id=v_scan.activity_id;
  return query select v_tx, v_activity.slug, v_activity.display_name, v_points, v_rewards;
end; $$;

create or replace function public.owner_cancel_scan(p_actor uuid, p_scan_event_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operator public.operator_profiles; v_scan public.scan_events;
begin
  v_operator := public.require_owner(p_actor);
  select * into v_scan from public.scan_events where id=p_scan_event_id and action='scan_detected' and owner_user_id=p_actor for update;
  if not found then raise exception 'SCAN_INVALID'; end if;
  if exists(select 1 from public.scan_events where source_scan_event_id=p_scan_event_id and action in ('visit_point','scan_cancelled','redeem')) then raise exception 'SCAN_ALREADY_RESOLVED'; end if;
  insert into public.scan_events(customer_id, activity_id, qr_credential_id, owner_user_id, source_scan_event_id, branch_name, action, balance_before, balance_after, rewards_before, rewards_after, activity_settings_version)
  values(v_scan.customer_id, v_scan.activity_id, v_scan.qr_credential_id, p_actor, p_scan_event_id, v_operator.branch_name, 'scan_cancelled', v_scan.balance_after, v_scan.balance_after, v_scan.rewards_after, v_scan.rewards_after, v_scan.activity_settings_version);
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
        'pointsPerVisit',a.points_per_visit,'rewardThreshold',a.reward_threshold,'rewardText',a.reward_text,'settingsVersion',a.settings_version,
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
          'pointsPerVisit',a.points_per_visit,'rewardThreshold',a.reward_threshold,'rewardText',a.reward_text,'settingsVersion',a.settings_version
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

create or replace function public.consume_auth_budget(
  p_identifier_hash text, p_limit integer, p_window_seconds integer
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempt public.auth_attempts; v_failures integer;
begin
  if length(p_identifier_hash) <> 64 or p_limit not between 2 and 1000
     or p_window_seconds not between 60 and 3600 then raise exception 'INVALID_INPUT'; end if;

  -- Bound storage used by random identifiers. The indexed cleanup also removes
  -- expired login/public-budget rows well after their blocking window ends.
  delete from public.auth_attempts a
  where a.updated_at<now()-interval '1 hour' and a.identifier_hash<>p_identifier_hash;

  -- Seed at zero, then lock and increment in this transaction. The unique
  -- insert plus FOR UPDATE makes the limit atomic even for concurrent requests.
  insert into public.auth_attempts(identifier_hash, failures)
  values(p_identifier_hash, 0)
  on conflict(identifier_hash) do nothing;
  select * into v_attempt from public.auth_attempts a
  where a.identifier_hash=p_identifier_hash for update;

  if v_attempt.blocked_until is not null and v_attempt.blocked_until>now() then
    return false;
  end if;
  if v_attempt.window_started_at<now()-make_interval(secs=>p_window_seconds) then
    v_failures := 1;
    update public.auth_attempts a
    set failures=1, window_started_at=now(), blocked_until=null, updated_at=now()
    where a.identifier_hash=p_identifier_hash;
  else
    v_failures := v_attempt.failures+1;
    update public.auth_attempts a
    set failures=v_failures,
      blocked_until=case when v_failures>=p_limit then now()+make_interval(secs=>p_window_seconds) else null end,
      updated_at=now()
    where a.identifier_hash=p_identifier_hash;
  end if;
  -- The fifth check is allowed, but it atomically blocks any following check.
  -- A successful check deletes the row via clear_auth_failures.
  return true;
end; $$;

create or replace function public.consume_auth_attempt(p_identifier_hash text)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  select public.consume_auth_budget(p_identifier_hash, 5, 900);
$$;

create or replace function public.consume_pbkdf_budget(p_identifier_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_global_hash text := encode(digest('pbkdf:global:v1', 'sha256'), 'hex');
  v_global public.auth_attempts;
  v_client public.auth_attempts;
  v_global_failures integer;
  v_client_failures integer;
begin
  if length(p_identifier_hash) <> 64 or p_identifier_hash=v_global_hash then
    raise exception 'INVALID_INPUT';
  end if;

  -- The fixed global row is always locked first. Once it is blocked, a caller
  -- cannot manufacture new per-address rows by varying proxy headers.
  delete from public.auth_attempts a
  where a.updated_at<now()-interval '1 hour'
    and a.identifier_hash not in (p_identifier_hash, v_global_hash);
  insert into public.auth_attempts(identifier_hash, failures)
  values(v_global_hash, 0)
  on conflict(identifier_hash) do nothing;
  select * into v_global from public.auth_attempts a
  where a.identifier_hash=v_global_hash for update;
  if v_global.blocked_until is not null and v_global.blocked_until>now() then
    return false;
  end if;

  insert into public.auth_attempts(identifier_hash, failures)
  values(p_identifier_hash, 0)
  on conflict(identifier_hash) do nothing;
  select * into v_client from public.auth_attempts a
  where a.identifier_hash=p_identifier_hash for update;
  if v_client.blocked_until is not null and v_client.blocked_until>now() then
    return false;
  end if;

  if v_client.window_started_at<now()-interval '15 minutes' then
    v_client_failures := 1;
    update public.auth_attempts a
    set failures=1, window_started_at=now(), blocked_until=null, updated_at=now()
    where a.identifier_hash=p_identifier_hash;
  else
    v_client_failures := v_client.failures+1;
    update public.auth_attempts a
    set failures=v_client_failures,
      blocked_until=case when v_client_failures>=30 then now()+interval '15 minutes' else null end,
      updated_at=now()
    where a.identifier_hash=p_identifier_hash;
  end if;

  if v_global.window_started_at<now()-interval '15 minutes' then
    v_global_failures := 1;
    update public.auth_attempts a
    set failures=1, window_started_at=now(), blocked_until=null, updated_at=now()
    where a.identifier_hash=v_global_hash;
  else
    v_global_failures := v_global.failures+1;
    update public.auth_attempts a
    set failures=v_global_failures,
      blocked_until=case when v_global_failures>=600 then now()+interval '15 minutes' else null end,
      updated_at=now()
    where a.identifier_hash=v_global_hash;
  end if;
  return true;
end; $$;

create or replace function public.clear_auth_failures(p_identifier_hash text)
returns void language sql security definer set search_path = public, pg_temp as $$ delete from public.auth_attempts where identifier_hash=p_identifier_hash; $$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.require_owner(uuid) to service_role;
grant execute on function public.owner_create_enrollment_invite(uuid,text,timestamptz) to service_role;
grant execute on function public.enroll_customer(text,text,text,text,text,text,text,timestamptz,text) to service_role;
grant execute on function public.get_customer_auth_record(text) to service_role;
grant execute on function public.rotate_customer_access(uuid,text,text,timestamptz) to service_role;
grant execute on function public.rotate_customer_access_for_login(uuid,text,text,text,timestamptz,text) to service_role;
grant execute on function public.member_summary(text,text,text,text,timestamptz) to service_role;
grant execute on function public.owner_check(uuid) to service_role;
grant execute on function public.owner_update_activity_settings(uuid,text,integer,integer,text) to service_role;
grant execute on function public.owner_create_pin_reset(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.recover_customer_pin(text,text,text,text,text,text,timestamptz,text,text) to service_role;
grant execute on function public.owner_scan(uuid,text) to service_role;
grant execute on function public.owner_add_visit_point(uuid,uuid,uuid) to service_role;
grant execute on function public.owner_redeem_reward(uuid,uuid,uuid) to service_role;
grant execute on function public.owner_cancel_scan(uuid,uuid) to service_role;
grant execute on function public.owner_dashboard(uuid,integer,integer) to service_role;
grant execute on function public.consume_auth_budget(text,integer,integer) to service_role;
grant execute on function public.consume_auth_attempt(text) to service_role;
grant execute on function public.consume_pbkdf_budget(text) to service_role;
grant execute on function public.clear_auth_failures(text) to service_role;
