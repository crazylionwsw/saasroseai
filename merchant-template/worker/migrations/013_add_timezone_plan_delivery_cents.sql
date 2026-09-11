-- Migration 013: timezone + plan + delivery cents (TASK-006/059/064).
ALTER TABLE merchant_info ADD COLUMN timezone TEXT DEFAULT 'America/Vancouver';
ALTER TABLE merchant_info ADD COLUMN plan TEXT DEFAULT 'basic';
ALTER TABLE delivery_orders ADD COLUMN total_cents INTEGER DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN platform_fee_cents INTEGER DEFAULT 0;
