import os
import uuid
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import get_current_user
from app.schemas_chat import ChatMessageOut

router = APIRouter(prefix="/api/chat", tags=["chat"])

UPLOAD_DIR = Path(os.getenv("CHAT_UPLOAD_DIR", "chat_uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 10 MB limit — same cap used by the vendor portal
CHAT_UPLOAD_MAX_BYTES = int(os.getenv("CHAT_UPLOAD_MAX_BYTES", str(10 * 1024 * 1024)))

# Allowlist: common document and image types only.
# Executables, scripts, and archives are explicitly excluded.
ALLOWED_CHAT_MIME_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    # Documents
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
    "application/vnd.ms-excel",                                             # .xls
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "application/msword",                                                   # .doc
    "text/csv", "text/plain",
}

ALLOWED_CHAT_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
    ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".csv", ".txt",
}


def _out(m: models.ChatMessage) -> ChatMessageOut:
    file_url = f"/api/chat/files/{m.id}" if m.file_path else None
    return ChatMessageOut(
        id=m.id,
        sender_name=m.sender.name if m.sender else "Unknown",
        sender_role=m.sender.role.value if m.sender else "user",
        message=m.message,
        file_url=file_url,
        file_name=m.file_name,
        file_size=m.file_size,
        file_type=m.file_type,
        created_at=m.created_at,
    )


@router.get("/messages", response_model=list[ChatMessageOut])
def list_messages(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Most recent 200 messages, oldest first (ready to render top-to-bottom)."""
    messages = (
        db.query(models.ChatMessage)
        .order_by(models.ChatMessage.created_at.desc())
        .limit(200)
        .all()
    )
    return [_out(m) for m in reversed(messages)]


@router.post("/messages", response_model=ChatMessageOut)
async def send_message(
    message: str = Form(""),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """
    Send a message with optional file attachment.
    Accepts text message and/or file upload via multipart/form-data.
    """
    message_text = (message or "").strip()
    file_path = None
    file_name = None
    file_size = None
    file_type = None

    if file and file.filename:
        # --- Validate file extension ---
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_CHAT_EXTENSIONS:
            raise HTTPException(
                400,
                f"File type '{ext}' is not allowed. Permitted types: "
                + ", ".join(sorted(ALLOWED_CHAT_EXTENSIONS)),
            )

        # --- Validate MIME type (client-reported, defence-in-depth) ---
        if file.content_type and file.content_type not in ALLOWED_CHAT_MIME_TYPES:
            raise HTTPException(
                400,
                f"MIME type '{file.content_type}' is not allowed in chat.",
            )

        # --- Enforce size limit (read limit+1 to detect oversize) ---
        contents = await file.read(CHAT_UPLOAD_MAX_BYTES + 1)
        if len(contents) > CHAT_UPLOAD_MAX_BYTES:
            raise HTTPException(
                413,
                f"File is too large. Maximum allowed size is "
                f"{CHAT_UPLOAD_MAX_BYTES // (1024 * 1024)} MB.",
            )

        file_name = file.filename
        file_type = file.content_type
        file_size = len(contents)
        safe_filename = f"{uuid.uuid4().hex}_{Path(file_name).name}"
        dest_path = UPLOAD_DIR / safe_filename
        with open(dest_path, "wb") as f:
            f.write(contents)
        file_path = str(dest_path)

    if not message_text and not file_path:
        raise HTTPException(400, "Message text or file attachment is required.")

    msg = models.ChatMessage(
        sender_user_id=user.id,
        message=message_text,
        file_path=file_path,
        file_name=file_name,
        file_size=file_size,
        file_type=file_type,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _out(msg)


@router.get("/files/{message_id}")
def download_chat_file(
    message_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Securely serve attached files for a chat message."""
    msg = db.query(models.ChatMessage).filter(models.ChatMessage.id == message_id).first()
    if not msg or not msg.file_path:
        raise HTTPException(404, "File not found.")

    file_path = Path(msg.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on server disk.")

    return FileResponse(
        path=file_path,
        filename=msg.file_name or file_path.name,
        media_type=msg.file_type or "application/octet-stream",
    )
