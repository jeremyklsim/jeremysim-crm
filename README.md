# Jeremysim.co Studio CRM

Private CRM and project board. Static site (no build step) using Supabase for login and data.

- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: Supabase project URL and publishable key (safe to be public; data is protected by row-level security)
- `vendor/supabase.js`: vendored supabase-js browser build (update with `npm i @supabase/supabase-js` and copy `dist/umd/supabase.js`)

Security: all tables have row-level security so only the signed-in owner can read or write rows. Turn off public sign-ups in Supabase (Authentication, Sign In / Providers).
