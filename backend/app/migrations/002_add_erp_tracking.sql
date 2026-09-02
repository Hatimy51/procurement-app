-- =============================================================================
-- Migration: 002_add_erp_tracking.sql
-- Description: Add ERP integration tracking columns (erp_external_id, erp_sync_status,
--              erp_payment_status, erp_synced_at) to Purchase Orders, Invoices, and Vendor Invoices.
-- =============================================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_external_id VARCHAR;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_sync_status VARCHAR;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_payment_status VARCHAR;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_synced_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_external_id VARCHAR;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_sync_status VARCHAR;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_payment_status VARCHAR;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_synced_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS erp_external_id VARCHAR;
ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS erp_sync_status VARCHAR;
ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS erp_payment_status VARCHAR;
ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS erp_synced_at TIMESTAMP WITHOUT TIME ZONE;
