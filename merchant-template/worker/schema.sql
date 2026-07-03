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
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  items TEXT NOT NULL,
  subtotal REAL NOT NULL,
  delivery_fee REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','preparing','delivering','completed','cancelled')),
  payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded')),
  payment_method TEXT,
  payment_id TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_call_records_merchant ON call_records(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_merchant ON knowledge_docs(merchant_id);
