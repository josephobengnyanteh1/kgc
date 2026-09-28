-- KGC platform schema — run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  location VARCHAR(255),
  service_times VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Website content: add/edit these rows in Supabase -> Table Editor and the site updates instantly
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  location VARCHAR(255),
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);

-- SECURITY: turn on Row Level Security with NO public policies.
-- Supabase exposes tables through a public API key; this blocks anyone using that key.
-- Our server connects with the private database password, so it is not affected.
ALTER TABLE branches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sermons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
