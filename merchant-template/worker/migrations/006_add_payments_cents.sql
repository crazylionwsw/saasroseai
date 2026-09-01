-- Migration 006: server-side pricing (integer cents), order/payment state machines,
-- payments ledger, webhook idempotency events, QR dine-in table id, per-merchant tax rate.

-- 1. Per-merchant tax rate (basis points, 500 = 5.00%)
ALTER TABLE merchant_info ADD COLUMN tax_rate INTEGER DEFAULT 500;

-- 2. Recreate orders with integer-cent money columns, order_type, table_id and
-- the task-spec status/payment_status enums. Legacy REAL money columns are kept
-- and kept in sync (dollars) so existing reports keep working.
CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  order_number TEXT,
  order_type TEXT DEFAULT 'pickup' CHECK(order_type IN ('dine_in','pickup')),
  table_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  items TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  delivery_fee REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  tip_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending_payment','paid','confirmed','preparing','ready','completed','cancelled','refunded')),
  payment_status TEXT DEFAULT 'not_required' CHECK(payment_status IN ('not_required','pending','processing','succeeded','failed','cancelled','refunded','partially_refunded')),
  payment_method TEXT,
  payment_id TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO orders_new (
  id, merchant_id, order_number, order_type, customer_name, customer_phone, customer_address,
  items, subtotal, delivery_fee, discount, total,
  subtotal_cents, tax_cents, tip_cents, total_cents, currency,
  status, payment_status, payment_method, payment_id, note, created_at, updated_at
)
SELECT
  id, merchant_id, id, 'pickup', customer_name, customer_phone, customer_address,
  items, subtotal, delivery_fee, discount, total,
  CAST(ROUND(COALESCE(subtotal,0) * 100) AS INTEGER), 0, 0, CAST(ROUND(COALESCE(total,0) * 100) AS INTEGER),
  'CAD',
  CASE status
    WHEN 'pending' THEN 'pending_payment'
    WHEN 'confirmed' THEN 'paid'
    WHEN 'delivering' THEN 'preparing'
    ELSE status
  END,
  CASE payment_status
    WHEN 'unpaid' THEN 'pending'
    WHEN 'paid' THEN 'succeeded'
    ELSE payment_status
  END,
  payment_method, payment_id, note, created_at, updated_at
FROM orders;

DROP TABLE orders;

ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, merchant_id);

-- 3. Payments ledger
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed','cancelled','refunded','partially_refunded')),
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- 4. Webhook idempotency ledger
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT,
  processed_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_dedupe ON payment_events(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_merchant ON payment_events(merchant_id, processed_at DESC);

-- 5. Refunds
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  provider_refund_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'CAD',
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);
