-- Migration 004: Security hardening additions
-- Adds last_seen_at to sessions (idle timeout) and creates vendor_sessions table
-- (moves vendor portal sessions from in-memory dict to DB).
-- All statements are idempotent — safe to re-run on every startup.

-- 1. Add last_seen_at to sessions table (idle timeout tracking)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='sessions' AND column_name='last_seen_at'
    ) THEN
        ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMP DEFAULT NOW();
        -- Back-fill existing rows so the idle check doesn't immediately expire them
        UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL;
    END IF;
END $$;

-- 2. Create vendor_sessions table if it doesn't exist
CREATE TABLE IF NOT EXISTS vendor_sessions (
    token       VARCHAR PRIMARY KEY,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    created_at  TIMESTAMP DEFAULT NOW(),
    expires_at  TIMESTAMP NOT NULL
);

-- 3. Index for fast lookup by token (already the PK, but add supplier index too)
CREATE INDEX IF NOT EXISTS idx_vendor_sessions_supplier ON vendor_sessions(supplier_id);
