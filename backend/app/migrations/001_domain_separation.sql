-- =============================================================================
-- Migration: 001_domain_separation.sql
-- Description: Strict Domain Separation for Inbound (Vendor PO -> GRN -> Vendor Invoice)
--              and Outbound (Customer Quote -> Delivery Challan -> Customer Invoice)
-- =============================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grnstatus') THEN
        CREATE TYPE grnstatus AS ENUM ('draft', 'received');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendorinvoicestatus') THEN
        CREATE TYPE vendorinvoicestatus AS ENUM ('draft', 'verified', 'paid');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Create Goods Receipt Notes & Line Items (Inbound Flow)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id UUID PRIMARY KEY,
    grn_number VARCHAR NOT NULL,
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    status grnstatus NOT NULL DEFAULT 'draft',
    vehicle_number VARCHAR,
    driver_name VARCHAR,
    challan_number VARCHAR,
    notes TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (NOW() AT TIME ZONE 'utc'),
    received_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_po_id ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_status ON goods_receipt_notes(status);

CREATE TABLE IF NOT EXISTS goods_receipt_note_line_items (
    id UUID PRIMARY KEY,
    grn_id UUID NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_line_item_id UUID NOT NULL REFERENCES purchase_order_line_items(id) ON DELETE RESTRICT,
    description VARCHAR NOT NULL,
    spec VARCHAR,
    unit VARCHAR NOT NULL,
    quantity_received NUMERIC NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grn_line_items_grn_id ON goods_receipt_note_line_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_line_items_po_line_id ON goods_receipt_note_line_items(po_line_item_id);

-- -----------------------------------------------------------------------------
-- 2. Create Vendor Invoices & Line Items (Inbound Flow)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_invoices (
    id UUID PRIMARY KEY,
    invoice_number VARCHAR NOT NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
    status vendorinvoicestatus NOT NULL DEFAULT 'draft',
    invoice_date TIMESTAMP WITHOUT TIME ZONE,
    received_at TIMESTAMP WITHOUT TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_supplier_id ON vendor_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_po_id ON vendor_invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_grn_id ON vendor_invoices(grn_id);

CREATE TABLE IF NOT EXISTS vendor_invoice_line_items (
    id UUID PRIMARY KEY,
    vendor_invoice_id UUID NOT NULL REFERENCES vendor_invoices(id) ON DELETE CASCADE,
    po_line_item_id UUID REFERENCES purchase_order_line_items(id) ON DELETE RESTRICT,
    grn_line_item_id UUID REFERENCES goods_receipt_note_line_items(id) ON DELETE SET NULL,
    description VARCHAR NOT NULL,
    spec VARCHAR,
    unit VARCHAR NOT NULL,
    quantity_invoiced NUMERIC NOT NULL,
    unit_price NUMERIC,
    gst_percent NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoice_line_items_inv_id ON vendor_invoice_line_items(vendor_invoice_id);

-- -----------------------------------------------------------------------------
-- 3. Data Migration: Port existing PO-linked Delivery Challan rows to GRNs
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_challans' AND column_name = 'po_id'
    ) THEN
        -- Insert GRNs from existing PO-linked DCs
        INSERT INTO goods_receipt_notes (
            id, grn_number, po_id, status, vehicle_number, driver_name, notes, created_at, received_at
        )
        SELECT 
            id, 
            REPLACE(dc_number, 'DC-', 'GRN-'), 
            po_id, 
            CASE WHEN status::text = 'dispatched' THEN 'received'::grnstatus ELSE 'draft'::grnstatus END,
            vehicle_number, 
            driver_name, 
            notes, 
            created_at, 
            dispatched_at 
        FROM delivery_challans 
        WHERE po_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;

        -- Insert line items
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'delivery_challan_line_items' AND column_name = 'po_line_item_id'
        ) THEN
            INSERT INTO goods_receipt_note_line_items (
                id, grn_id, po_line_item_id, description, spec, unit, quantity_received
            )
            SELECT 
                dli.id, 
                dli.dc_id, 
                dli.po_line_item_id, 
                dli.description, 
                dli.spec, 
                dli.unit, 
                dli.quantity_delivered
            FROM delivery_challan_line_items dli
            INNER JOIN delivery_challans dc ON dc.id = dli.dc_id
            WHERE dc.po_id IS NOT NULL AND dli.po_line_item_id IS NOT NULL
            ON CONFLICT (id) DO NOTHING;

            -- Delete ported line items
            DELETE FROM delivery_challan_line_items 
            WHERE dc_id IN (SELECT id FROM delivery_challans WHERE po_id IS NOT NULL);
        END IF;

        -- Delete ported header rows
        DELETE FROM delivery_challans WHERE po_id IS NOT NULL;

        -- Drop legacy PO columns from DC tables
        ALTER TABLE delivery_challan_line_items DROP COLUMN IF EXISTS po_line_item_id;
        ALTER TABLE delivery_challans DROP COLUMN IF EXISTS po_id;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Restore strict NOT NULL and FK constraints on Outbound Delivery Challans
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_challans' AND column_name = 'customer_quote_id' AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE delivery_challans ALTER COLUMN customer_quote_id SET NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_challan_line_items' AND column_name = 'quote_line_item_id' AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE delivery_challan_line_items ALTER COLUMN quote_line_item_id SET NOT NULL;
    END IF;
END $$;
