CREATE TABLE IF NOT EXISTS merchant_info (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slogan TEXT,
  description TEXT,
  logo_url TEXT,
  cover_url TEXT,
  primary_color TEXT DEFAULT '#8B0000',
  template_id TEXT DEFAULT 'classic',
  phone TEXT,
  address TEXT,
  business_hours TEXT,
  latitude REAL,
  longitude REAL,
  social_media TEXT,
  menu_categories TEXT,
  featured_items TEXT,
  enable_ordering INTEGER DEFAULT 1,
  enable_payment INTEGER DEFAULT 0,
  enable_chat INTEGER DEFAULT 1,
  enable_phone INTEGER DEFAULT 0,
  language TEXT DEFAULT 'zh',
  currency_symbol TEXT DEFAULT '¥',
  tax_rate INTEGER DEFAULT 500,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  order_number TEXT,
  order_type TEXT DEFAULT 'pickup' CHECK(order_type IN ('dine_in','pickup')),
  table_id TEXT,
  idempotency_key TEXT,
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

-- Phase 3: Server-side Cart Domain
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

-- Phase 3: Tax Engine (TASK-013)
CREATE TABLE IF NOT EXISTS tax_rules (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  tax_code TEXT NOT NULL,
  rate_bp INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tax_rules_merchant ON tax_rules(merchant_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','ai','agent','system')),
  content TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_records (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  call_sid TEXT,
  customer_number TEXT,
  duration INTEGER,
  recording_url TEXT,
  transcript TEXT,
  summary TEXT,
  status TEXT DEFAULT 'completed',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_file_name TEXT,
  drive_mime_type TEXT,
  drive_modified_at TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'active',
  chunk_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  chunk_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT DEFAULT 'completed',
  files_processed INTEGER DEFAULT 0,
  files_added INTEGER DEFAULT 0,
  errors TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_conversation_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL,
  conversation TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  target_number TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_call_records_merchant ON call_records(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_merchant ON knowledge_docs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file ON knowledge_chunks(file_id, merchant_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_merchant ON sync_log(merchant_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_archive_sid ON call_conversation_archive(call_sid);
CREATE INDEX IF NOT EXISTS idx_call_transfers_sid ON call_transfers(call_sid);

-- Phase 5: Analytics
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_merchant ON analytics_events(merchant_id, created_at);

-- Phase 6: Multi-store
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  business_hours TEXT,
  manager_name TEXT,
  manager_phone TEXT,
  email TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Phase 7: Inventory
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  store_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT '个',
  stock REAL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  cost_price REAL DEFAULT 0,
  supplier_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_merchant ON inventory_items(merchant_id, store_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  supplier_id TEXT,
  store_id TEXT,
  status TEXT DEFAULT 'pending',
  items TEXT,
  total REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Phase 7: Delivery integrations
CREATE TABLE IF NOT EXISTS delivery_orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  order_id TEXT,
  platform TEXT NOT NULL,
  platform_order_id TEXT,
  delivery_status TEXT DEFAULT 'pending',
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  items TEXT,
  total REAL DEFAULT 0,
  platform_fee REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
