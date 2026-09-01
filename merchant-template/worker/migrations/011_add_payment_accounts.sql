-- Migration 011: Stripe Connect payment accounts (TASK-033/034).
CREATE TABLE IF NOT EXISTS payment_accounts (
  merchant_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  connected_at TEXT DEFAULT (datetime('now')),
  metadata TEXT
);
