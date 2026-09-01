-- Migration 009: tax rules (TASK-013) - configurable GST/PST/HST per merchant.
CREATE TABLE IF NOT EXISTS tax_rules (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  tax_code TEXT NOT NULL,
  rate_bp INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tax_rules_merchant ON tax_rules(merchant_id);
