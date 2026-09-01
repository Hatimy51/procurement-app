"""Additions to schemas.py for the Customer Quotes (quote assembly +
approval) screen — kept in a separate file, same pattern as
schemas_enquiry_review.py, so schemas.py doesn't need risky edits."""
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class ReadyEnquiryOut(BaseModel):
    """One row in the 'Ready to Quote' list — reviewed enquiries that don't
    have a quote yet."""
    id: str
    site_name: str
    customer_name: str
    item_count: int
    items_price_missing: int
    created_at: datetime


class QuoteListItemOut(BaseModel):
    """One row in the Customer Quotes list."""
    id: str
    quote_number: str
    status: str
    site_name: str
    customer_name: str
    item_count: int
    grand_total: Decimal
    created_at: datetime


class QuoteLineItemOut(BaseModel):
    id: str
    description: str
    spec: str | None
    quantity: Decimal
    unit: str
    gst_percent: Decimal | None
    unit_price: Decimal | None  # null = still "Price Missing"


class QuoteDetailOut(BaseModel):
    id: str
    quote_number: str
    status: str
    site_name: str
    customer_name: str
    notes: str | None
    created_at: datetime
    approved_by_name: str | None
    approved_at: datetime | None
    sent_at: datetime | None
    items: list[QuoteLineItemOut]
    subtotal: Decimal
    total_gst: Decimal
    grand_total: Decimal
    items_price_missing: int


class QuoteLineItemUpdate(BaseModel):
    id: str
    unit_price: Decimal | None = None


class QuoteDraftUpdate(BaseModel):
    """The 'Save Draft' action — notes and any edited line prices together,
    same 'save everything changed in one call' pattern as Quote History's
    Save All."""
    notes: str | None = None
    items: list[QuoteLineItemUpdate] = []


