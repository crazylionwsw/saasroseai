-- 中央管控平台 D1 数据库 Schema

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','frozen','expired','deleted')),
  plan TEXT DEFAULT 'basic' CHECK(plan IN ('basic','pro','enterprise')),
  cf_account_email TEXT,
  cf_account_id TEXT,
  cf_api_token TEXT,
  subdomain TEXT UNIQUE,
  template_id TEXT DEFAULT 'classic',
  theme_color TEXT DEFAULT '#8B0000',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  notes TEXT,
  slogan TEXT,
  description TEXT,
  address TEXT,
  business_hours TEXT,
  logo_url TEXT,
  cover_url TEXT,
  social_media TEXT,
  language TEXT DEFAULT 'zh',
  currency_symbol TEXT
);

CREATE TABLE IF NOT EXISTS merchant_configs (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id),
  drive_token_encrypted TEXT,
  drive_folder_id TEXT,
  twilio_phone_sid TEXT,
  twilio_auth_token_encrypted TEXT,
  stripe_account_id TEXT,
  wechat_merchant_id TEXT,
  alipay_merchant_id TEXT,
  custom_domain TEXT,
  ssl_status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS merchant_tokens (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id),
  token_hash TEXT NOT NULL,
  issued_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  version TEXT NOT NULL,
  template_version TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','deploying','success','failed')),
  worker_url TEXT,
  pages_url TEXT,
  cf_deployment_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  error_log TEXT,
  deployed_by TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  preview_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  features TEXT
);

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);
CREATE INDEX IF NOT EXISTS idx_merchants_subdomain ON merchants(subdomain);
CREATE INDEX IF NOT EXISTS idx_deployments_merchant ON deployments(merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, target_type);
