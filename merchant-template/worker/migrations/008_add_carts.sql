-- Migration 008: server-side Cart Domain (TASK-011/015).
CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_carts_merchant ON carts(merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  modifiers TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
