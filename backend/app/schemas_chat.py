from datetime import datetime
from pydantic import BaseModel


class ChatMessageCreate(BaseModel):
    message: str


class ChatMessageOut(BaseModel):
    id: str
    sender_name: str
    sender_role: str
    message: str
    created_at: datetime
