"""Schemas for Purchase Orders — same pattern as schemas_quotes.py."""
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class POLineItemIn(BaseModel):
    """One line item as submitted when creating/editing a PO. product_id is
    optional — omit it for a manual/custom line not in the product master."""
    product_id: str | None = None
    description: str
    spec: str | None = None
    quantity: Decimal
    unit: str
    gst_percent: Decimal | None = None
    unit_price: Decimal | None = None


class PurchaseOrderCreate(BaseModel):
    supplier_id: str
    customer_quote_id: str | None = None
    store_location_id: str | None = None
    notes: str | None = None
    items: list[POLineItemIn]


class PurchaseOrderDraftUpdate(BaseModel):
    """'Save Draft' — notes and the full items list are replaced together,
    same one-call pattern as Quote's Save Draft."""
    store_location_id: str | None = None
    notes: str | None = None
    items: list[POLineItemIn]


class POLineItemOut(BaseModel):
    id: str
    description: str
    spec: str | None
    quantity: Decimal
    unit: str
    gst_percent: Decimal | None
    unit_price: Decimal | None


class PurchaseOrderListItemOut(BaseModel):
    id: str
    po_number: str
    status: str
    supplier_name: str
    store_location_name: str | None = None
    approval_status: str | None = None
    requires_manager_approval: bool = False
    receipt_pct: float = 0.0
    item_count: int
    grand_total: Decimal
    created_at: datetime


class PurchaseOrderDetailOut(BaseModel):
    id: str
    po_number: str
    status: str
    supplier_id: str | None = None
    supplier_name: str
    supplier_email: str | None
    supplier_phone: str | None
    store_location_id: str | None = None
    store_location_name: str | None = None
    customer_quote_number: str | None
    approval_status: str | None = None
    requires_manager_approval: bool = False
    receipt_pct: float = 0.0
    erp_payment_status: str | None = None
    notes: str | None
    created_at: datetime
    sent_at: datetime | None
    items: list[POLineItemOut]
    subtotal: Decimal
    total_gst: Decimal
    grand_total: Decimal
    items_price_missing: int
