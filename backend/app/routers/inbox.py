import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app import google_oauth
from app.document_readers import extract_text_from_upload
from app.extraction.base import get_extraction_service, CLASSIFICATION_CATEGORIES
from app.schemas_inbox import InboxStatusOut, ScanResultOut, InboxActivityItemOut
from app.routers.enquiries import _ingest_from_text
from app.routers.rfqs import _ingest_quote_for_supplier

router = APIRouter(prefix="/api/inbox", tags=["inbox"])

# Where the browser lands after a successful/failed OAuth round trip —
# the frontend's dev server origin. Kept simple (single hardcoded origin)
# since this app runs on localhost during development; revisit if this
# ever runs somewhere else.
FRONTEND_ORIGIN = "http://localhost:5173"


def _get_connection(db: Session) -> models.GmailConnection | None:
    return db.query(models.GmailConnection).order_by(models.GmailConnection.connected_at.desc()).first()


@router.get("/status", response_model=InboxStatusOut)
def get_status(db: Session = Depends(get_db)):
    conn = _get_connection(db)
    if not conn:
        return InboxStatusOut(connected=False)
    return InboxStatusOut(
        connected=True, email_address=conn.email_address,
        connected_at=conn.connected_at, last_scanned_at=conn.last_scanned_at,
    )


@router.get("/connect")
def start_connect():
    """Returns Google's consent-screen URL for the frontend to redirect
    the browser to (a plain JSON response, not a redirect itself, so the
    frontend controls when the browser navigates away)."""
    try:
        url = google_oauth.build_auth_url(state=str(uuid.uuid4()))
    except google_oauth.GmailConfigError as e:
        raise HTTPException(400, str(e))
    return {"auth_url": url}


@router.get("/oauth-callback")
def oauth_callback(code: str | None = None, error: str | None = None, db: Session = Depends(get_db)):
    """Google redirects the browser here after the user approves (or
    denies) access. This endpoint exchanges the code for tokens, stores
    the connection, then redirects the browser back into the app —
    there's nothing for a person to look at on this URL directly."""
    if error:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?inbox_error={error}")
    if not code:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?inbox_error=missing_code")

    try:
        tokens = google_oauth.exchange_code_for_tokens(code)
        profile = google_oauth.get_profile(tokens["access_token"])
    except Exception as e:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?inbox_error={urllib_quote(str(e))}")

    from app.encryption import encrypt_token

    # Only one connection at a time — replace whatever was there before.
    db.query(models.GmailConnection).delete()
    raw_refresh = tokens.get("refresh_token", "")
    conn = models.GmailConnection(
        email_address=profile.get("emailAddress", "unknown"),
        access_token=encrypt_token(tokens["access_token"]),
        refresh_token=encrypt_token(raw_refresh) if raw_refresh else "",
        token_expiry=datetime.utcnow(),  # forces a refresh check on first use; expires_in applied below
    )
    from datetime import timedelta
    conn.token_expiry = datetime.utcnow() + timedelta(seconds=tokens.get("expires_in", 3600))
    if not conn.refresh_token:
        # Google only returns a refresh_token on the FIRST consent for this
        # app+account, or when prompt=consent forces re-issuing it (which
        # build_auth_url always sets) — this branch should be rare, but
        # fail clearly rather than silently storing an unusable connection.
        return RedirectResponse(f"{FRONTEND_ORIGIN}/?inbox_error=no_refresh_token")

    db.add(conn)
    db.commit()
    return RedirectResponse(f"{FRONTEND_ORIGIN}/?inbox=connected")


def urllib_quote(s: str) -> str:
    import urllib.parse
    return urllib.parse.quote(s[:200])


@router.post("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    db.query(models.GmailConnection).delete()
    db.commit()
    return {"disconnected": True}


def _match_supplier_by_email(db: Session, from_header: str | None) -> models.Supplier | None:
    if not from_header:
        return None
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", from_header)
    if not match:
        return None
    address = match.group(0).lower()
    return db.query(models.Supplier).filter(
        models.Supplier.email.isnot(None),
        models.Supplier.email.ilike(address),
    ).first()


def _build_processing_text(access_token: str, msg: dict) -> tuple[str, list[str]]:
    """
    Combines the email body with the text of every readable attachment
    (Excel/PDF/image) into one block for classification and extraction —
    an attachment usually carries the real structured data (a supplier's
    formal quote sheet), while the body often just carries context ("please
    find attached"). Returns (combined_text, attachment_errors) — errors
    are collected rather than raised, since one unreadable attachment (e.g.
    a scanned PDF) shouldn't stop the rest of the message from being used.
    """
    parts = [f"Subject: {msg['subject']}", "", msg["body_text"]]
    errors = []
    for att in msg["attachments"]:
        try:
            file_bytes = google_oauth.fetch_attachment(access_token, msg["gmail_message_id"], att["attachment_id"])
            text = extract_text_from_upload(att["filename"], file_bytes)
            parts.append(f"\n--- Attachment: {att['filename']} ---\n{text}")
        except Exception as e:
            errors.append(f"{att['filename']}: {e}")
    return "\n".join(parts), errors


@router.post("/scan", response_model=ScanResultOut)
def scan_inbox(db: Session = Depends(get_db)):
    """
    Pulls recent messages since the last scan, classifies each one, and
    routes it:
      - new_enquiry      -> creates a draft Enquiry via the same pipeline
                             manual paste/upload already uses
      - supplier_quote   -> if the sender's address matches a known
                             Supplier, reuses the same reply-ingestion
                             pipeline the Quotations screen uses; if no
                             match, it's logged as unmatched for a human
                             to handle manually (never guesses)
      - everything else  -> logged only, for visibility — this app doesn't
                             auto-process POs/deliveries/invoices arriving
                             by email in this version

    Attachments (Excel/PDF/image) are downloaded and read through the same
    document_readers used for manual uploads, and their text is combined
    with the email body before classification — a supplier's quote often
    lives entirely in an attached spreadsheet or PDF, not the email text.

    Every message is recorded in InboxMessageLog by its Gmail message ID,
    so re-running a scan never processes the same message twice.
    """
    conn = _get_connection(db)
    if not conn:
        raise HTTPException(400, "No inbox is connected yet.")

    access_token = google_oauth.get_valid_access_token(conn, db)
    messages = google_oauth.fetch_recent_messages(access_token, after=conn.last_scanned_at)

    already_seen = {
        row.gmail_message_id
        for row in db.query(models.InboxMessageLog.gmail_message_id)
        .filter(models.InboxMessageLog.gmail_message_id.in_([m["gmail_message_id"] for m in messages]))
        .all()
    }

    extraction_service = get_extraction_service()
    enquiries_created = quotes_matched = logged_only = 0

    for msg in messages:
        if msg["gmail_message_id"] in already_seen:
            continue

        text_for_classification, attachment_errors = _build_processing_text(access_token, msg)
        try:
            category, _confidence = extraction_service.classify(text_for_classification, CLASSIFICATION_CATEGORIES)
        except Exception:
            category = "general"

        outcome = "logged_only"
        related_enquiry_id = None
        related_supplier_id = None

        if category == "new_enquiry":
            try:
                enquiry = _ingest_from_text(None, None, text_for_classification, db, source="gmail")
                related_enquiry_id = enquiry.id
                outcome = "enquiry_created"
                enquiries_created += 1
            except Exception:
                outcome = "enquiry_creation_failed"

        elif category == "supplier_quote":
            supplier = _match_supplier_by_email(db, msg["from_address"])
            if supplier:
                try:
                    _ingest_quote_for_supplier(supplier.id, text_for_classification, db)
                    related_supplier_id = supplier.id
                    outcome = "quote_matched"
                    quotes_matched += 1
                except Exception:
                    outcome = "quote_ingestion_failed" if not attachment_errors else "attachment_unreadable"
            else:
                outcome = "unmatched_supplier"

        else:
            logged_only += 1

        db.add(models.InboxMessageLog(
            gmail_message_id=msg["gmail_message_id"],
            subject=msg["subject"],
            from_address=msg["from_address"],
            received_at=msg["received_at"],
            category=category,
            outcome=outcome,
            related_enquiry_id=related_enquiry_id,
            related_supplier_id=related_supplier_id,
        ))

    conn.last_scanned_at = datetime.utcnow()
    db.commit()

    return ScanResultOut(
        messages_found=len(messages),
        enquiries_created=enquiries_created,
        quotes_matched=quotes_matched,
        logged_only=logged_only,
    )


@router.get("/activity", response_model=list[InboxActivityItemOut])
def get_activity(db: Session = Depends(get_db)):
    logs = db.query(models.InboxMessageLog).order_by(models.InboxMessageLog.created_at.desc()).limit(100).all()
    return [
        InboxActivityItemOut(
            id=log.id, subject=log.subject, from_address=log.from_address,
            received_at=log.received_at, category=log.category, outcome=log.outcome,
            related_enquiry_id=log.related_enquiry_id, related_supplier_id=log.related_supplier_id,
            created_at=log.created_at,
        )
        for log in logs
    ]
