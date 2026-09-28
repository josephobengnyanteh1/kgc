# KGC Phase 5 — Finance & Giving
Adds tithes, offerings and dues records, verification states, branch-aware access and audit logging.

Apply `db/schema.sql`, run `npm install`, configure `.env`, then `npm start`. Authenticated members can use `/finance.html`.

Production payment integrations must use provider webhooks/signature verification server-side; never trust a browser-submitted payment-success flag.
