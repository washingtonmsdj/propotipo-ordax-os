-- OrdaX Supabase identity preflight.
-- READ-ONLY: this file must remain SELECT-only.

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'auth'
  and c.relname = 'users'
order by t.tgname;

select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'ordax_profiles')
order by table_name;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'ordax_profiles')
order by tablename, policyname;
