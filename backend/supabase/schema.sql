-- ============================================================
-- Dnyanankur ERP — Supabase backend schema
-- ============================================================
-- This app was already built around a generic key/value storage
-- contract (see Dnyanankur.Storage / StorageAdapter in js/app.js):
-- every entity (students, teachers, inventory, fees, settings,
-- audit logs, etc.) is read/written as one JSON blob per key,
-- e.g. key = "dnyanankur_erp.students" -> value = [ {...}, {...} ].
--
-- Rather than force 90k lines of working business logic to switch
-- from whole-array JSON reads/writes to normalized relational
-- queries, this single table mirrors that exact key -> value
-- contract in Postgres. It's a legitimate, common pattern
-- ("KV table on top of Postgres") and is a drop-in cloud backend
-- for the existing adapter interface with zero app-logic rewrites.
--
-- If you outgrow this later, migrate individual keys (e.g.
-- "dnyanankur_erp.students") into proper normalized tables one
-- at a time — the JSON in `value` already tells you the exact
-- shape of each record.
-- ============================================================

create table if not exists app_storage (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists app_storage_updated_at_idx
  on app_storage (updated_at desc);

-- Keep updated_at accurate even on raw SQL updates (not just app upserts)
create or replace function app_storage_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_storage_updated_at on app_storage;
create trigger trg_app_storage_updated_at
  before update on app_storage
  for each row execute function app_storage_set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
-- Starting point: any client holding the anon key can read/write,
-- matching today's behavior (localStorage has no access control
-- either). Tighten this once real user accounts / Supabase Auth
-- roles are wired up — e.g. restrict by an org_id column, or
-- require an authenticated session.
-- ============================================================

alter table app_storage enable row level security;

create policy "app_storage_select_all"
  on app_storage for select
  using (true);

create policy "app_storage_insert_all"
  on app_storage for insert
  with check (true);

create policy "app_storage_update_all"
  on app_storage for update
  using (true);

create policy "app_storage_delete_all"
  on app_storage for delete
  using (true);

-- ============================================================
-- OPTIONAL — tighter policy once Supabase Auth is enforced.
-- Uncomment and drop the "_all" policies above once ready.
-- ============================================================
-- create policy "app_storage_authenticated_only"
--   on app_storage for all
--   using (auth.role() = 'authenticated')
--   with check (auth.role() = 'authenticated');
