# Kingdom Glory Church — website & member portal

Static website (`/public`) + Express API (`server.js`) + Supabase (database and private photo storage), hosted on Vercel.

## Why your Vercel site showed `500 FUNCTION_INVOCATION_FAILED`
`server.js` tried to create a `private_uploads` folder when it started. Vercel's disk is read-only, so the function crashed before it could answer any request (`ENOENT … mkdir '/var/task/private_uploads'`). This version stores photos in Supabase Storage instead, and never writes to disk.

## Setup (about 15 minutes)

### 1. Supabase
1. Create a project at supabase.com. Save the database password.
2. **SQL Editor** → paste `db/schema.sql` → **Run**. Then run `db/seed.sql` (edit branch names first).
3. **Project Settings → Database → Connection string → Transaction pooler**. Copy it (port 6543) and put your password in. This is `DATABASE_URL`.
4. **Project Settings → API**: copy the *Project URL* (`SUPABASE_URL`) and the *service_role* key (`SUPABASE_SERVICE_ROLE_KEY`). Keep the service_role key secret; never put it in browser code.
5. The private `member-photos` storage bucket is created automatically on the first photo upload.

> **Updating an existing Supabase project?** Just run `db/schema.sql` again (it only adds what is missing), then `db/seed.sql`. Nothing is deleted.

### 2. Vercel → Project → Settings → Environment Variables
Add: `DATABASE_URL` (Transaction pooler string), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (32+ random characters), `SUPABASE_PHOTO_BUCKET` (`member-photos`), `PUBLIC_BASE_URL` (your live site address).
For online giving also add `PAYSTACK_SECRET_KEY` and/or `FLW_SECRET_KEY` (+ `FLW_WEBHOOK_SECRET_HASH`). Start with test keys.
Generate a secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
Then commit and push (or **Redeploy**).

### 3. Test
Open `https://YOUR-SITE.vercel.app/api/health` → should show `{"ok":true,"database":"connected"}`.

### 4. Make yourself the first admin
Register on `/register.html` with your email, then run `db/make-admin.sql` (with your email) in the Supabase SQL Editor. Sign in at `/login.html`; you will land on the admin dashboard.

## Editing the website
- **Church details** (phone, email, address, service times, live-stream link, social links): `public/js/config.js`. Every value is a sample; replace them.
- **Events, sermons, branches**: Supabase → Table Editor → `events`, `sermons`, `branches`. Changes show on the site within about a minute.
- **Photos**: replace `public/images/hero.jpg` with a larger image (at least 1920 px wide) for a sharper hero.

## Run locally
```
cp .env.example .env    # fill in the values
npm install
npm start               # http://localhost:3000
```

## Roles
`MEMBER`, `BRANCH_ADMIN` (own branch only), `FINANCE_OFFICER`, `CHURCH_ADMIN`, `SUPER_ADMIN`. Change a person's role in Supabase → `users` table.

## Branches
`db/seed.sql` creates the four branches (USA - Utah, Accra Grace Temple, Koforidua, Asamankese) and links Facebook, TikTok and YouTube to Accra Grace Temple.
Add addresses, phone numbers, email, service times and social links any time: **Admin dashboard → Branches**. Church admins can also add branches and hide them.

## Members' app (`/app/`)
A separate installable app (PWA) for church members: home, events, giving, inbox and profile. Members open `https://YOUR-SITE/app/` on their phone and tap **Install** (Android/Chrome) or **Share → Add to Home Screen** (iPhone). It works on phones, tablets and desktop. After changing app files, bump `VERSION` in `public/app/sw.js` so phones pick up the update.

## Online giving (Paystack / Flutterwave)
Members pay by Mobile Money or card; payments are only marked confirmed after the server checks with the provider (amount, currency and reference). In the provider dashboard set the webhook URLs to:
- `https://YOUR-SITE/api/payments/paystack/webhook`
- `https://YOUR-SITE/api/payments/flutterwave/webhook` (set the same secret hash in `FLW_WEBHOOK_SECRET_HASH`)

## Events & announcements
Admin dashboard → Events / Announcements. Publishing an announcement sends a notification to members (all, or one branch).
