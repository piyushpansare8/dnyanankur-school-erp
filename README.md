# Dnyanankur ERP — Frontend / Backend split (Supabase)

## What was done

The original file was a single ~92,000-line `.html` file with all CSS and
JavaScript inlined. It was split into:

```
frontend/
  index.html          ← markup only, references css/js files
  css/styles.css       ← all 13 <style> blocks, in original order
  js/app.js            ← all 122 inline <script> blocks, concatenated
                          in original order (verified with `node --check`)
  vendor/               ← YOU need to add this (see "Vendor files" below)
backend/
  supabase/
    schema.sql          ← run this in the Supabase SQL editor
README.md               ← this file
```

Nothing in the business logic was rewritten — the JS was extracted
byte-for-byte, just reordered from "scattered across the HTML" to "one
file, same execution order."

## Why Supabase plugs in at one seam, not 200 places

Good news: this app was **already architected for this swap**. Every
storage read/write funnels through one low-level object:
`Dnyanankur.Storage.get/set/remove` (defined near the top of `app.js`).
Higher-level code (`StorageAdapter`, `LocalStorageAdapter`, the Backup
Engine, Import/Export Engine, etc.) all delegate down to it instead of
calling `localStorage` directly. There was even a `SupabaseAdapterStub`
placeholder class already sitting in the code, clearly anticipating this
exact change.

That single seam is where the Supabase integration was added — a new
`Dnyanankur.CloudSync` block right after `Dnyanankur.Storage` is defined:

- **On boot**, it pulls every row from a Supabase table into
  `localStorage`, so the app sees your latest cloud data on this device.
- **On every write**, it saves to `localStorage` immediately (unchanged,
  synchronous, so nothing in the existing ~200 call sites breaks) *and*
  pushes the same write to Supabase in the background (fire-and-forget,
  with a retry queue if the write fails).

This means `localStorage` is now a fast local cache, and Supabase Postgres
is the durable, cross-device source of truth — **without converting
hundreds of synchronous call sites to async**, which would have meant
touching most of the 92k lines.

## Data model

One table, `app_storage(key text primary key, value jsonb, updated_at)`.
Each row mirrors one of the app's existing storage keys, e.g.:

| key | value |
|---|---|
| `dnyanankur_erp.students` | `[{admno, name, cls, ...}, ...]` |
| `dnyanankur_erp.teachers` | `[{empid, name, subject, ...}, ...]` |
| `schoolLedger` | `{...}` |
| `school_settings` | `{...}` |

This matches the app's own design — it already treats each entity as one
JSON blob per key (see `SchemaRegistry` in `app.js` for the exact field
list per entity: students, teachers, admissions, attendance, fees_school,
fees_transport, inventory, examination, communication, users, settings,
documents). If you outgrow the KV model later, migrate one key at a time
into a normalized table — the JSON already tells you the shape.

## Setup steps

1. **Create a Supabase project** at supabase.com (or use your existing
   one — the app's Auth module already references
   `https://jkhqmfvsdgzwjwvgzddw.supabase.co` as a placeholder, so you may
   already have one).
2. **Run `backend/supabase/schema.sql`** in the Supabase SQL editor.
3. **Get your Project URL + anon key** (Project Settings → API).
4. **Edit `frontend/index.html`**, near the top of `<head>`:
   ```html
   window.DNK_SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   window.DNK_SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
   ```
5. **Add vendor files** (see below) and open `index.html`.

## Vendor files (not included)

The original file loaded these as local, offline-bundled assets:

```
vendor/css/local-fonts.css
vendor/css/tailwind.local.css
vendor/js/xlsx.full.min.js
vendor/js/qrcode.min.js
vendor/js/JsBarcode.all.min.js
vendor/js/supabase.js          ← the Supabase JS SDK (UMD build)
vendor/js/chart.umd.min.js
vendor/js/html2canvas.min.js
```

Only the HTML was uploaded, so these weren't available to copy. Grab the
official builds for each (e.g. `supabase.js` = the UMD bundle from
`@supabase/supabase-js`) and drop them in `frontend/vendor/...` matching
the paths above, or point the `<script src>` tags at a CDN instead.

## Security note

`schema.sql` currently opens `app_storage` to anyone holding the anon key
— matching today's behavior (`localStorage` has no access control either).
Before going live with real student/fee data, tighten Row Level Security
to require an authenticated Supabase session (a commented-out stricter
policy is included at the bottom of `schema.sql`).

## Known limits of this approach

- **Eventual consistency, not real-time sync.** Two people editing at the
  same time will each overwrite their own key's data on save — there's no
  merge logic (same limitation the original app had with `localStorage`,
  just now shared across devices instead of stuck on one browser).
- **No per-record RLS yet** — access control is all-or-nothing per the KV
  table until it's migrated to normalized tables with real row ownership.
