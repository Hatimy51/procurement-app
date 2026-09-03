from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import get_current_user
from app.schemas_chat import ChatMessageCreate, ChatMessageOut

# Deliberately NOT wrapped in require_router_access anywhere it's mounted —
# every role needs equal read/write access here so Purchase, Accounts, and
# Manager can actually talk to each other. Every endpoint still requires
# being logged in (get_current_user), just not any particular role.
router = APIRouter(prefix="/api/chat", tags=["chat"])


def _out(m: models.ChatMessage) -> ChatMessageOut:
    return ChatMessageOut(
        id=m.id, sender_name=m.sender.name, sender_role=m.sender.role.value,
        message=m.message, created_at=m.created_at,
    )


@router.get("/messages", response_model=list[ChatMessageOut])
def list_messages(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Most recent 200 messages, oldest first (ready to render top-to-bottom).
    Simple polling model, not a websocket — this is a small internal tool,
    not worth the added complexity of a live push connection."""
    messages = (
        db.query(models.ChatMessage)
        .order_by(models.ChatMessage.created_at.desc())
        .limit(200)
        .all()
    )
    return [_out(m) for m in reversed(messages)]


@router.post("/messages", response_model=ChatMessageOut)
def send_message(payload: ChatMessageCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if not payload.message.strip():
        raise HTTPException(400, "Message can't be empty.")
    msg = models.ChatMessage(sender_user_id=user.id, message=payload.message.strip())
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _out(msg)
