from datetime import datetime
from pydantic import BaseModel


class InboxStatusOut(BaseModel):
    connected: bool
    email_address: str | None = None
    connected_at: datetime | None = None
    last_scanned_at: datetime | None = None


class ScanResultOut(BaseModel):
    messages_found: int
    enquiries_created: int
    quotes_matched: int
    logged_only: int


class InboxActivityItemOut(BaseModel):
    id: str
    subject: str | None
    from_address: str | None
    received_at: datetime | None
    category: str
    outcome: str
    related_enquiry_id: str | None
    related_supplier_id: str | None
    created_at: datetime
