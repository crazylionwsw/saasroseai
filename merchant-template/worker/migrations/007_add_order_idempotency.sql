-- Migration 007: order idempotency (TASK-020).
-- Client-supplied Idempotency-Key on POST /orders prevents duplicate orders on retry.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
