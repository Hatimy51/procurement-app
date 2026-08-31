"""Schemas for Invoices — GST-aware (standard single-rate split only, no
CGST/SGST/IGST breakdown, no e-way bill logic). Quantity per line is capped
by what's been dispatched via Delivery Challans, minus what's already
invoiced — not by the quoted quantity."""
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class ReadyQuoteOut(BaseModel):
    id: str
    quote_number: str
    customer_name: str
    site_name: str
    lines_available: int


class QuoteLineInvoiceStatus(BaseModel):
    quote_line_item_id: str
    description: str
    spec: str | None
    unit: str
    unit_price: Decimal | None
    gst_percent: Decimal | None
    quantity_quoted: Decimal
    quantity_dispatched: Decimal
    quantity_already_invoiced: Decimal
    quantity_available_to_invoice: Decimal


class InvoiceLineItemIn(BaseModel):
    quote_line_item_id: str
    quantity_invoiced: Decimal
    unit_price: Decimal | None = None
    gst_percent: Decimal | None = None


class InvoiceCreate(BaseModel):
    customer_quote_id: str
    notes: str | None = None
    items: list[InvoiceLineItemIn]


class InvoiceDraftUpdate(BaseModel):
    notes: str | None = None
    items: list[InvoiceLineItemIn]


class InvoiceLineItemOut(BaseModel):
    id: str
    quote_line_item_id: str
    description: str
    spec: str | None
    unit: str
    quantity_invoiced: Decimal
    unit_price: Decimal | None
    gst_percent: Decimal | None


class InvoiceListItemOut(BaseModel):
    id: str
    invoice_number: str
    status: str
    quote_number: str
    customer_name: str
    grand_total: Decimal
    created_at: datetime


class InvoiceDetailOut(BaseModel):
    id: str
    invoice_number: str
    status: str
    quote_number: str
    customer_name: str
    site_name: str
    notes: str | None
    created_at: datetime
    issued_at: datetime | None
    items: list[InvoiceLineItemOut]
    subtotal: Decimal
    total_gst: Decimal
    grand_total: Decimal
    items_price_missing: int
