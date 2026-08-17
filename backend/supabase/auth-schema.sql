-- ============================================================
-- Dnyanankur ERP — Auth / RBAC schema
-- ============================================================
-- The app's JS (Dnyanankur.Auth / SessionManager / PermissionManager
-- in js/app.js) already expects this exact table + RPC to exist. It was
-- built against Supabase Auth from the start — this file just creates
-- what it's already calling.
-- ============================================================

create table if not exists profiles (
  id                        uuid primary key references auth.users(id) on delete cascade,
  email                     text,
  username                  text,
  name                      text,
  role                      text check (role in ('principal','clerk','teacher','student','parent')),
  permissions               jsonb default '{}'::jsonb,
  linked_teacher_id         text,
  linked_student_id         text,
  linked_parent_account_id  text,
  child_student_ids         jsonb default '[]'::jsonb,
  linked_clerk_id           text,
  disabled                  boolean not null default false,
  view_all                  boolean not null default false,
  classes                   jsonb default '[]'::jsonb,
  class_assignments         jsonb default '[]'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create or replace function profiles_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function profiles_set_updated_at();

-- ============================================================
-- bootstrap_first_principal()
-- Called by the app the first time ANY user logs in with no role yet.
-- Atomically checks "does a principal already exist?" and, if not,
-- creates one for the calling user — closes the race the app's own
-- comments describe (see bootstrapFirstPrincipal() in js/app.js).
-- SECURITY DEFINER so it can write profiles even though the calling
-- user has no row/role yet (and RLS below would otherwise block it).
-- ============================================================
create or replace function bootstrap_first_principal()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  already_exists boolean;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    return false;
  end if;

  select exists(select 1 from profiles where role = 'principal') into already_exists;
  if already_exists then
    return false;
  end if;

  insert into profiles (id, email, role, view_all)
  values (
    caller_id,
    (select email from auth.users where id = caller_id),
    'principal',
    true
  )
  on conflict (id) do update
    set role = 'principal', view_all = true;

  return true;
end;
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles enable row level security;

-- Everyone can read their own row (needed for the very first,
-- roleless login before bootstrap runs).
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

-- A principal can read every row (admin screens, Migration Tool, the
-- 15A-approve-workflow etc. all need this).
create policy "profiles_select_principal"
  on profiles for select
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'principal')
  );

-- Users may update their own row (e.g. changing their own name) —
-- tighten further with a trigger/column check if you don't want users
-- editing their own `role`.
create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id);

-- A principal can update any row (role changes, disabling accounts,
-- linking teacher/student/parent records via the Migration Tool).
create policy "profiles_update_principal"
  on profiles for update
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'principal')
  );

-- Only a principal can create new profile rows directly (regular
-- provisioning goes through the Migration Tool in-app, which runs as
-- a principal). bootstrap_first_principal() bypasses this via
-- SECURITY DEFINER, so the very first user is unaffected.
create policy "profiles_insert_principal"
  on profiles for insert
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'principal')
  );

-- ============================================================
-- Tighten app_storage now that real auth exists
-- ============================================================
-- Run this once you've confirmed login works — it replaces the wide-open
-- policies from schema.sql with "must be logged in."
-- ============================================================
drop policy if exists "app_storage_select_all" on app_storage;
drop policy if exists "app_storage_insert_all" on app_storage;
drop policy if exists "app_storage_update_all" on app_storage;
drop policy if exists "app_storage_delete_all" on app_storage;

create policy "app_storage_authenticated_only"
  on app_storage for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
