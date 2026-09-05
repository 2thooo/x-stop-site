-- pgcrypto is installed in Supabase's extensions schema. Keep the definer
-- function's search path explicit so gen_random_bytes() resolves safely.
alter function public.enroll_customer_open(text,text,text,text,text,text,timestamptz)
  set search_path = public, extensions, pg_temp;
