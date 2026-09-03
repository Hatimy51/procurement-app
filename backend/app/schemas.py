"""API request/response schemas (Pydantic) — kept separate from the DB models
so the API's shape can evolve independently of the database's shape."""
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


class ProductCreate(BaseModel):
    name: str
    category: str | None = None
    spec: str | None = None
    unit: str | None = None
    gst_percent: Decimal | None = None


class PriceEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    cost_price: Decimal | None
    selling_price: Decimal | None
    date: datetime
    source: str


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    category: str | None
    spec: str | None
    unit: str | None
    gst_percent: Decimal | None
    created_at: datetime
    price_entries: list[PriceEntryOut] = []

    created_by: str | None = None
    updated_by: str | None = None
    updated_at: datetime | None = None


class PriceEntryCreate(BaseModel):
    product_id: str
    cost_price: Decimal | None = None
    selling_price: Decimal | None = None
    source: str = "manual"


class PriceEntryUpdate(BaseModel):
    cost_price: Decimal | None = None
    selling_price: Decimal | None = None


class EnquiryIngestRequest(BaseModel):
    raw_text: str
    customer_name: str
    site_name: str


class EnquiryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    description: str
    spec: str | None
    brand: str | None
    quantity: Decimal
    unit: str
    product_id: str | None


class EnquiryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    extraction_confidence: Decimal | None
    created_at: datetime
    items: list[EnquiryItemOut] = []
