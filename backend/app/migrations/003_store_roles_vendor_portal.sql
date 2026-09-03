-- Migration 003: Store Locations, Vendor Portal Documents, Role Additions
CREATE TABLE IF NOT EXISTS store_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR NOT NULL UNIQUE,
    area        VARCHAR,
    address     TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS store_location_id UUID REFERENCES store_locations(id);

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS store_location_id UUID REFERENCES store_locations(id),
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR,
    ADD COLUMN IF NOT EXISTS requires_manager_approval BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_number VARCHAR;

ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'store';

DO 'BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = ''vendordocumenttype'') THEN CREATE TYPE vendordocumenttype AS ENUM (''delivery_challan'', ''invoice'', ''other''); END IF; END';

CREATE TABLE IF NOT EXISTS vendor_portal_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id   UUID NOT NULL REFERENCES suppliers(id),
    po_id         UUID NOT NULL REFERENCES purchase_orders(id),
    document_type vendordocumenttype NOT NULL,
    file_name     VARCHAR NOT NULL,
    file_path     VARCHAR NOT NULL,
    file_size     NUMERIC,
    notes         TEXT,
    uploaded_at   TIMESTAMP DEFAULT NOW()
);
