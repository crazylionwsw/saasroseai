-- Migration 006: custom domain (TASK-062).
ALTER TABLE merchants ADD COLUMN custom_domain TEXT;
