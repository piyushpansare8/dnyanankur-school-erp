# Deploying to Vercel with Supabase Auth

Good news: the app already has a **complete, real login system built in**
(`Dnyanankur.Auth` in `js/app.js` — session management, roles, idle
timeout, the works), wired to Supabase Auth from the start. It was just
pointed at placeholder credentials. You're not building auth from
scratch — you're pointing existing code at your real project.

## 1. Run the SQL (Supabase SQL Editor, in order)

1. `backend/supabase/schema.sql` — the `app_storage` table (app data)
2. `backend/supabase/auth-schema.sql` — the `profiles` table + the
   `bootstrap_first_principal()` function the app calls on first login.
   **This also tightens `app_storage`'s RLS to "must be logged in"** —
   run it only after you've confirmed login works, or you'll lock
   yourself out of data before there's a session to read it with.

## 2. Enable email login in Supabase

Authentication → Providers → Email → make sure it's **on**.

Decide how people get accounts:
- **Invite-only (recommended for a school ERP):** Authentication →
  Users → **Add user** manually for each staff member, or disable
  public sign-ups (Authentication → Settings → "Allow new users to
  sign up" → off) and add users yourself. This app is unlikely to want
  a public "sign up" form for random visitors.
- **Open signup:** leave sign-ups on if you do want people to
  self-register (they'll land with no role until a principal assigns
  one — see step 4).

## 3. Point the app at your real project

Two places need the same URL + anon key (Project Settings → API):

**`frontend/index.html`** (near the top of `<head>`):
```html
window.DNK_SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
window.DNK_SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

**`frontend/js/app.js`** — search for `SUPABASE_URL =` (in the
`Dnyanankur.Auth` module) and replace the two placeholder-format
values there with the same real URL + anon key:
```js
var SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
var SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

(Yes, both — the Auth module and the CloudSync data-storage layer were
built separately and each hold their own config. CloudSync will try to
reuse Auth's config automatically once Auth has loaded, but setting
both explicitly is the reliable path.)

## 4. Deploy to Vercel

From inside the `frontend/` folder:

```bash
npm install -g vercel   # if you don't have it
cd frontend
vercel
```

Answer the prompts (link/create a project, accept defaults — it's a
static site, no build step). For production:

```bash
vercel --prod
```

Or, for continuous deployment: push `frontend/` to a GitHub repo, then
in the Vercel dashboard → **Add New Project** → import that repo. Set
**Root Directory** to `frontend` if the repo contains more than just
this folder. No framework preset needed — plain static HTML/CSS/JS.

## 5. Log in and become the first principal

1. Open your deployed URL.
2. Log in with the first account you created in Supabase Auth (or sign
   up, if you left that open).
3. The app calls `bootstrap_first_principal()` automatically on a
   roleless first login — that account becomes **principal** (full
   admin), and every login after that gets whatever role a principal
   assigns them via the app's own user management / Migration Tool
   screens.

## 6. Restrict who can reach it at all (optional, extra layer)

Login already gates the app itself (`#page-login` covers everything
until a session exists). If you also want to stop random people from
even loading the page before Supabase Auth is involved:
- **Vercel password protection** — Project → Settings → Deployment
  Protection (Pro plan feature), or
- **Vercel Access/SSO** if you're on a team plan, or
- Keep it simple and rely on invite-only Supabase accounts (step 2) —
  the page loads, but nobody without a real account can get past login.

## Notes

- The anon key is meant to be public/client-visible by design — Row
  Level Security (from `auth-schema.sql`) is what actually protects
  data, not hiding the key. Don't put your Supabase **service_role**
  key anywhere in this frontend code.
- Vendor libraries are currently loaded from CDN (see previous setup
  step) — fine for Vercel, no vendor/ folder needed.
