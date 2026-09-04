from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ChatMessageCreate(BaseModel):
    message: str


class ChatMessageOut(BaseModel):
    id: str
    sender_name: str
    sender_role: str
    message: str
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    file_type: Optional[str] = None
    created_at: datetime
