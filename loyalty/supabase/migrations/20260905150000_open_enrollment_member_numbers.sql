-- Customers can now register directly. Member numbers are allocated inside the
-- same transaction so concurrent signups cannot receive the same number.

alter table public.customers drop constraint if exists customers_member_code_check;
alter table public.customers
  add constraint customers_member_code_check
  check (length(member_code) between 6 and 32);

create table if not exists public.member_number_counter (
  singleton boolean primary key default true check (singleton),
  last_number bigint not null default 0 check (last_number between 0 and 999999)
);

insert into public.member_number_counter(singleton, last_number)
values (true, 0)
on conflict (singleton) do nothing;

alter table public.member_number_counter enable row level security;
revoke all on table public.member_number_counter from public, anon, authenticated;

create or replace function public.enroll_customer_open(
  p_phone text, p_display_name text, p_pin_salt text, p_pin_hash text,
  p_qr_hash text, p_session_hash text, p_session_expiry timestamptz
) returns table(customer_id uuid, member_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer_id uuid;
  v_member_number bigint;
  v_member_code text;
begin
  update public.member_number_counter
  set last_number = last_number + 1
  where singleton
  returning last_number into v_member_number;

  if not found or v_member_number > 999999 then
    raise exception 'MEMBER_CODE_EXHAUSTED';
  end if;

  v_member_code := lpad(v_member_number::text, 6, '0');

  insert into public.customers(member_code, display_name, phone_e164, pin_salt, pin_hash, consented_at)
  values (v_member_code, trim(p_display_name), p_phone, p_pin_salt, p_pin_hash, now())
  returning id into v_customer_id;

  insert into public.loyalty_accounts(customer_id, activity_id)
  select v_customer_id, a.id from public.loyalty_activities a where a.is_active;
  insert into public.qr_credentials(customer_id, token_hash) values (v_customer_id, p_qr_hash);
  insert into public.customer_sessions(customer_id, token_hash, expires_at)
  values (v_customer_id, p_session_hash, p_session_expiry);

  return query select v_customer_id, v_member_code;
exception when unique_violation then
  raise exception 'ACCOUNT_EXISTS';
end; $$;

revoke all on function public.enroll_customer_open(text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.enroll_customer_open(text,text,text,text,text,text,timestamptz)
  to service_role;
