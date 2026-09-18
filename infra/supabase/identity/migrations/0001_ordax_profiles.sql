begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.ordax_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.ordax_profiles enable row level security;

revoke all on table public.ordax_profiles from public, anon, authenticated;
grant select, update on table public.ordax_profiles to authenticated;

create policy ordax_profiles_select_own
on public.ordax_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy ordax_profiles_update_own
on public.ordax_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function private.handle_ordax_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ordax_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_ordax_user_created() from public, anon, authenticated;

create trigger on_auth_user_created_ordax
after insert on auth.users
for each row execute function private.handle_ordax_user_created();

create or replace function private.touch_ordax_profile_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function private.touch_ordax_profile_updated_at() from public, anon, authenticated;

create trigger touch_ordax_profile_updated_at
before update on public.ordax_profiles
for each row execute function private.touch_ordax_profile_updated_at();

commit;
