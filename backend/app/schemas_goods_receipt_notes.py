"""Schemas for Goods Receipt Notes (GRN) — Inbound procurement flow against Vendor Purchase Orders."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel


class ReadyPOForGRNOut(BaseModel):
    """A Purchase Order (sent) that still has unreceived quantity on at
    least one line — the 'ready to receive' queue."""
    id: str
    po_number: str
    supplier_name: str
    lines_remaining: int
    store_location: Optional[str] = None


class POLineGRNStatus(BaseModel):
    """One PO line's receipt progress — shows ordered/received/remaining so
    warehouse staff can enter this batch's received quantity."""
    po_line_item_id: str
    description: str
    spec: str | None
    unit: str
    quantity_ordered: Decimal
    quantity_already_received: Decimal
    quantity_remaining: Decimal


class GRNLineItemIn(BaseModel):
    po_line_item_id: str
    quantity_received: Decimal


class GRNCreate(BaseModel):
    po_id: str
    vehicle_number: str | None = None
    driver_name: str | None = None
    challan_number: str | None = None
    notes: str | None = None
    items: list[GRNLineItemIn]


class GRNDraftUpdate(BaseModel):
    vehicle_number: str | None = None
    driver_name: str | None = None
    challan_number: str | None = None
    notes: str | None = None
    items: list[GRNLineItemIn]


class GRNLineItemOut(BaseModel):
    id: str
    po_line_item_id: str
    description: str
    spec: str | None
    unit: str
    quantity_received: Decimal


class GRNListItemOut(BaseModel):
    id: str
    grn_number: str
    status: str
    po_number: str
    supplier_name: str
    item_count: int
    created_at: datetime


class GRNDetailOut(BaseModel):
    id: str
    grn_number: str
    status: str
    po_id: str
    po_number: str
    supplier_name: str
    vehicle_number: str | None
    driver_name: str | None
    challan_number: str | None
    notes: str | None
    created_at: datetime
    received_at: datetime | None
    items: list[GRNLineItemOut]
