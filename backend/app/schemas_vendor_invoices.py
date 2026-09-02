"""Schemas for Vendor Invoices — Inbound procurement billing against Purchase Orders & GRNs."""
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class ReadyPOForVendorInvoiceOut(BaseModel):
    """A Purchase Order with received-but-not-yet-invoiced quantity on at
    least one line — ready to be billed by the vendor."""
    id: str
    po_number: str
    supplier_name: str
    lines_available: int


class POLineVendorInvoiceStatus(BaseModel):
    po_line_item_id: str
    description: str
    spec: str | None
    unit: str
    unit_price: Decimal | None
    gst_percent: Decimal | None
    quantity_ordered: Decimal
    quantity_received: Decimal
    quantity_already_invoiced: Decimal
    quantity_available_to_invoice: Decimal


class VendorInvoiceLineItemIn(BaseModel):
    po_line_item_id: str | None = None
    grn_line_item_id: str | None = None
    quantity_invoiced: Decimal
    unit_price: Decimal | None = None
    gst_percent: Decimal | None = None


class VendorInvoiceCreate(BaseModel):
    invoice_number: str
    supplier_id: str
    po_id: str
    grn_id: str | None = None
    invoice_date: datetime | None = None
    notes: str | None = None
    items: list[VendorInvoiceLineItemIn]


class VendorInvoiceDraftUpdate(BaseModel):
    invoice_number: str | None = None
    invoice_date: datetime | None = None
    notes: str | None = None
    items: list[VendorInvoiceLineItemIn]


class VendorInvoiceLineItemOut(BaseModel):
    id: str
    po_line_item_id: str | None
    grn_line_item_id: str | None
    description: str
    spec: str | None
    unit: str
    quantity_invoiced: Decimal
    unit_price: Decimal | None
    gst_percent: Decimal | None


class VendorInvoiceListItemOut(BaseModel):
    id: str
    invoice_number: str
    status: str
    po_number: str
    supplier_name: str
    grand_total: Decimal
    created_at: datetime


class VendorInvoiceDetailOut(BaseModel):
    id: str
    invoice_number: str
    status: str
    po_id: str
    po_number: str
    supplier_id: str
    supplier_name: str
    grn_id: str | None
    invoice_date: datetime | None
    received_at: datetime | None
    notes: str | None
    created_at: datetime
    items: list[VendorInvoiceLineItemOut]
    subtotal: Decimal
    total_gst: Decimal
    grand_total: Decimal
    items_price_missing: int
