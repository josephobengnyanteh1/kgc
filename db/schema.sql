-- KGC platform schema — safe to run again any time (it only adds what is missing).
-- Supabase: SQL Editor -> New query -> paste -> Run
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  location VARCHAR(255),
  service_times VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Branch details you can edit later (Admin dashboard -> Branches, or Supabase -> Table Editor)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone VARCHAR(60);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS email VARCHAR(320);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_name ON branches(name);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'MEMBER'
    CHECK (role IN ('MEMBER','BRANCH_ADMIN','FINANCE_OFFICER','CHURCH_ADMIN','SUPER_ADMIN')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','DEACTIVATED','REJECTED')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  full_name VARCHAR(160) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(30),
  phone VARCHAR(40) NOT NULL,
  address TEXT,
  ministry VARCHAR(120),
  profile_photo_key TEXT,
  profile_photo_mime VARCHAR(80),
  profile_photo_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(80),
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_user_id UUID REFERENCES users(id),
  branch_id UUID REFERENCES branches(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('TITHE','OFFERING','DUES')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'GHS',
  payment_method VARCHAR(40) NOT NULL,
  reference VARCHAR(120) UNIQUE,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','FAILED','REVERSED')),
  recorded_by UUID REFERENCES users(id),
  verified_by UUID REFERENCES users(id),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events, announcements, notifications
CREATE TABLE IF NOT EXISTS church_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id),
  title VARCHAR(180) NOT NULL,
  description TEXT,
  location VARCHAR(255),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id),
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Online giving (Paystack / Flutterwave)
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(120) UNIQUE NOT NULL,
  provider VARCHAR(30) NOT NULL CHECK (provider IN ('PAYSTACK','FLUTTERWAVE')),
  member_user_id UUID REFERENCES users(id),
  branch_id UUID REFERENCES branches(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('TITHE','OFFERING','DUES')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'GHS',
  donor_name VARCHAR(160),
  donor_email VARCHAR(320) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','FAILED','REVERSED')),
  provider_transaction_id VARCHAR(120),
  checkout_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_events_start ON church_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_branch ON church_events(branch_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_announcements_pub ON announcements(published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paytx_status ON payment_transactions(status, created_at DESC);

-- Sermons and contact messages
CREATE TABLE IF NOT EXISTS sermons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  speaker VARCHAR(160),
  preached_on DATE NOT NULL DEFAULT CURRENT_DATE,
  video_url TEXT,
  thumbnail_url TEXT,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  email VARCHAR(320),
  phone VARCHAR(40),
  topic VARCHAR(40) NOT NULL DEFAULT 'General',
  body TEXT NOT NULL,
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_members_branch ON members(branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_member ON financial_records(member_user_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_branch_date ON financial_records(branch_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_type_status ON financial_records(type, status);

-- SECURITY: turn on Row Level Security with NO public policies.
-- Supabase exposes tables through a public API key; this blocks anyone using that key.
-- Our server connects with the private database password, so it is not affected.
ALTER TABLE branches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sermons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
