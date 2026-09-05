-- pgcrypto is installed in Supabase's extensions schema. Keep the definer
-- function's search path explicit so digest() resolves without exposing any
-- caller-controlled schema.
alter function public.consume_pbkdf_budget(text)
  set search_path = public, extensions, pg_temp;
