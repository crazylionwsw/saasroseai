-- Migration 010: knowledge sync config (TASK-041/056) + chat sessions (TASK-040).
ALTER TABLE merchant_info ADD COLUMN drive_token_encrypted TEXT;
ALTER TABLE merchant_info ADD COLUMN drive_folder_id TEXT;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  customer_id TEXT,
  mode TEXT DEFAULT 'ai',
  status TEXT DEFAULT 'open',
  message_count INTEGER DEFAULT 0,
  summary TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_merchant ON chat_sessions(merchant_id, started_at DESC);
