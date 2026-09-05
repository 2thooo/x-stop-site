-- Replace sequential member numbers with non-enumerable random codes. The
-- unique index remains the final collision guard; a rare collision is retried.

create or replace function public.enroll_customer_open(
  p_phone text, p_display_name text, p_pin_salt text, p_pin_hash text,
  p_qr_hash text, p_session_hash text, p_session_expiry timestamptz
) returns table(customer_id uuid, member_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer_id uuid;
  v_random text;
  v_member_code text;
  v_attempt integer := 0;
begin
  if exists (select 1 from public.customers where phone_e164 = p_phone) then
    raise exception 'ACCOUNT_EXISTS';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_random := upper(encode(gen_random_bytes(8), 'hex'));
    v_member_code := 'X-' || substr(v_random, 1, 4) || '-' || substr(v_random, 5, 4)
      || '-' || substr(v_random, 9, 4) || '-' || substr(v_random, 13, 4);

    begin
      insert into public.customers(member_code, display_name, phone_e164, pin_salt, pin_hash, consented_at)
      values (v_member_code, trim(p_display_name), p_phone, p_pin_salt, p_pin_hash, now())
      returning id into v_customer_id;
      exit;
    exception when unique_violation then
      if exists (select 1 from public.customers where phone_e164 = p_phone) then
        raise exception 'ACCOUNT_EXISTS';
      end if;
      if v_attempt >= 5 then raise exception 'MEMBER_CODE_UNAVAILABLE'; end if;
    end;
  end loop;

  insert into public.loyalty_accounts(customer_id, activity_id)
  select v_customer_id, a.id from public.loyalty_activities a where a.is_active;
  insert into public.qr_credentials(customer_id, token_hash) values (v_customer_id, p_qr_hash);
  insert into public.customer_sessions(customer_id, token_hash, expires_at)
  values (v_customer_id, p_session_hash, p_session_expiry);

  return query select v_customer_id, v_member_code;
end; $$;

revoke all on function public.enroll_customer_open(text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.enroll_customer_open(text,text,text,text,text,text,timestamptz)
  to service_role;

drop table if exists public.member_number_counter;
