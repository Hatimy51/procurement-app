-- Migration 003: Store Locations, Vendor Portal Documents, Role Additions
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- 1. New store_locations table
CREATE TABLE IF NOT EXISTS store_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR NOT NULL UNIQUE,
    area        VARCHAR,
    address     TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. Add store_location_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_location_id UUID REFERENCES store_locations(id);

-- 3. Add store_location_id, approval fields to purchase_orders
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS store_location_id UUID REFERENCES store_locations(id),
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR,
    ADD COLUMN IF NOT EXISTS requires_manager_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Add gst_number to suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_number VARCHAR;

-- 5. Add new UserRole enum values
DO  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'userrole'::regtype AND enumlabel = 'admin') THEN
        ALTER TYPE userrole ADD VALUE 'admin';
    END IF;
END;
DO  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'userrole'::regtype AND enumlabel = 'store') THEN
        ALTER TYPE userrole ADD VALUE 'store';
    END IF;
END;

-- 6. VendorDocumentType enum and vendor_portal_documents table
DO  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendordocumenttype') THEN
        CREATE TYPE vendordocumenttype AS ENUM ('delivery_challan', 'invoice', 'other');
    END IF;
END;

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
