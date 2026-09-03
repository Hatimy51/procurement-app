from datetime import datetime
from pydantic import BaseModel


class CustomerCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None


class CustomerOut(BaseModel):
    id: str
    name: str
    email: str | None
    phone: str | None
    site_count: int
    created_at: datetime

    created_by: str | None = None
    updated_by: str | None = None
    updated_at: datetime | None = None
