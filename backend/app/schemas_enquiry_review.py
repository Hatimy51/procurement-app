"""Additions to schemas.py for the Enquiry Review screen — kept in a
separate file so the original schemas.py doesn't need risky edits."""
from decimal import Decimal
from pydantic import BaseModel


class EnquiryItemUpdate(BaseModel):
    description: str
    spec: str | None = None
    brand: str | None = None
    quantity: Decimal
    unit: str
    product_id: str | None = None  # link to a Product once matched, for pricing


class EnquiryItemWithPrice(BaseModel):
    id: str
    description: str
    spec: str | None
    brand: str | None
    quantity: Decimal
    unit: str
    product_id: str | None
    suggested_price: Decimal | None  # from latest Price Entry, if matched + found
    gst_percent: Decimal | None = None  # from the linked Product, for quoting math
    price_status: str  # "matched" | "unmatched" | "price_missing"
    # A confident (never auto-applied) product-match suggestion for items
    # that aren't linked yet — see app/matching.py. Null when nothing is
    # confident/unambiguous enough to suggest.
    suggested_product_id: str | None = None
    suggested_product_name: str | None = None
    suggested_match_score: float | None = None


class EnquiryDetailOut(BaseModel):
    id: str
    status: str
    site_name: str
    customer_name: str
    extraction_confidence: Decimal | None
    raw_source: str
    items: list[EnquiryItemWithPrice]
