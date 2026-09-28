# Kingdom Glory Church — Phase 2 Backend

This project now includes the Phase 1 frontend and a Phase 2 backend foundation.

## Requirements
- Node.js 20+
- PostgreSQL 15+

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGIN`.
2. Create a PostgreSQL database named `kgc` and run `db/schema.sql`.
3. Install dependencies: `npm install`
4. Start: `npm start`
5. Open `http://localhost:3000/register.html`.

## Security foundations
- Helmet security headers
- HTTP-only authentication cookie
- bcrypt password hashing
- Rate limiting
- Strict request validation with Zod
- MIME/size-limited profile uploads with random filenames
- Parameterized PostgreSQL queries
- Audit logging
- Pending-account state before activation

## Production requirements
Use HTTPS, a strong randomly generated JWT secret, a managed PostgreSQL database, private object storage for photos, email/phone verification, MFA for privileged roles, centralized logging/monitoring, backups, and independent security testing before production use.
# KGC
# kgc
