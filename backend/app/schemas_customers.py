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
