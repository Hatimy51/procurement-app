"""Schemas for Delivery Challans — quantities only, no pricing."""
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class ReadyQuoteOut(BaseModel):
    """A quote (approved/sent) that still has undelivered quantity on at
    least one line — the 'ready to deliver' queue."""
    id: str
    quote_number: str
    customer_name: str
    site_name: str
    lines_remaining: int


class QuoteLineDeliveryStatus(BaseModel):
    """One quote line's delivery progress — used to build the DC creation
    form, so the Purchaser can see what's left before entering this
    batch's quantity."""
    quote_line_item_id: str
    description: str
    spec: str | None
    unit: str
    quantity_quoted: Decimal
    quantity_already_delivered: Decimal
    quantity_remaining: Decimal


class DCLineItemIn(BaseModel):
    quote_line_item_id: str
    quantity_delivered: Decimal


class DeliveryChallanCreate(BaseModel):
    customer_quote_id: str
    vehicle_number: str | None = None
    driver_name: str | None = None
    notes: str | None = None
    items: list[DCLineItemIn]


class DeliveryChallanDraftUpdate(BaseModel):
    vehicle_number: str | None = None
    driver_name: str | None = None
    notes: str | None = None
    items: list[DCLineItemIn]


class DCLineItemOut(BaseModel):
    id: str
    quote_line_item_id: str
    description: str
    spec: str | None
    unit: str
    quantity_delivered: Decimal


class DeliveryChallanListItemOut(BaseModel):
    id: str
    dc_number: str
    status: str
    quote_number: str
    customer_name: str
    site_name: str
    item_count: int
    created_at: datetime


class DeliveryChallanDetailOut(BaseModel):
    id: str
    dc_number: str
    status: str
    quote_number: str
    customer_name: str
    site_name: str
    vehicle_number: str | None
    driver_name: str | None
    notes: str | None
    created_at: datetime
    dispatched_at: datetime | None
    items: list[DCLineItemOut]
