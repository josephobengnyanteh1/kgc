# KGC Phase 4 — Secure Member Portal

Includes a protected member dashboard, profile display, branch/ministry information, secure profile photo endpoint, recent account activity, logout, responsive UI, and authenticated `/api/me` and `/api/member/*` endpoints.

## Run
1. Copy `.env.example` to `.env` and set `DATABASE_URL` and a random `JWT_SECRET` (32+ characters).
2. Run the schema against PostgreSQL.
3. `npm install`
4. `npm start`
5. Open `http://localhost:3000/member.html` after logging in with an ACTIVE member account.

This is the portal foundation. Giving, attendance, birthdays, announcements and other church modules will be added as separate authenticated modules.
