"""
Gmail OAuth + minimal Gmail API client. Uses urllib directly, same style as
extraction/groq_provider.py, rather than pulling in google-api-python-client
— keeps the dependency footprint small and the HTTP calls fully readable.

Setup required (see README/step-by-step): register an OAuth app in Google
Cloud Console, enable the Gmail API, add the client as a test user (while
the consent screen stays in "Testing" mode), and set these env vars:
    GOOGLE_CLIENT_ID
    GOOGLE_CLIENT_SECRET
    GOOGLE_REDIRECT_URI   (must exactly match what's registered in Cloud
                            Console — e.g. http://localhost:8000/api/inbox/oauth-callback)

Scope requested is gmail.readonly — this app only ever reads the inbox to
classify and extract enquiries/quotes; it never sends mail on the client's
behalf (matches the "AI never independently sends binding communications"
principle already used for Quotes/POs/Invoices).
"""
import base64
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


class GmailConfigError(RuntimeError):
    pass


def _get_config():
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    if not all([client_id, client_secret, redirect_uri]):
        raise GmailConfigError(
            "Gmail isn't configured yet — GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, "
            "and GOOGLE_REDIRECT_URI all need to be set (see the setup guide)."
        )
    return client_id, client_secret, redirect_uri


def build_auth_url(state: str) -> str:
    client_id, _, redirect_uri = _get_config()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",  # required to receive a refresh_token
        "prompt": "consent",       # forces a refresh_token even on repeat connects
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"


def _post_form(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"Google token request failed ({e.code}): {detail}")


def exchange_code_for_tokens(code: str) -> dict:
    """Returns {access_token, refresh_token, expires_in, ...}."""
    client_id, client_secret, redirect_uri = _get_config()
    return _post_form(GOOGLE_TOKEN_URL, {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    })


def refresh_access_token(refresh_token: str) -> dict:
    """Returns {access_token, expires_in, ...} — Google doesn't reissue the
    refresh_token itself on a refresh call, so keep using the original."""
    client_id, client_secret, _ = _get_config()
    return _post_form(GOOGLE_TOKEN_URL, {
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
    })


def get_valid_access_token(connection, db) -> str:
    """Refreshes and persists a new access token if the stored one has
    expired (or is about to, within a minute)."""
    if connection.token_expiry > datetime.utcnow() + timedelta(minutes=1):
        return connection.access_token

    refreshed = refresh_access_token(connection.refresh_token)
    connection.access_token = refreshed["access_token"]
    connection.token_expiry = datetime.utcnow() + timedelta(seconds=refreshed.get("expires_in", 3600))
    db.commit()
    return connection.access_token


def _gmail_get(access_token: str, path: str, params: dict | None = None) -> dict:
    url = f"{GMAIL_API_BASE}{path}"
    if params:
        url += f"?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"Gmail API request failed ({e.code}): {detail}")


def get_profile(access_token: str) -> dict:
    """Returns {emailAddress, ...} — used right after connecting to confirm
    which inbox was actually authorized."""
    return _gmail_get(access_token, "/profile")


def _strip_html(html: str) -> str:
    """Minimal HTML-to-text fallback for messages with no plain-text part —
    good enough for extraction purposes, not meant to be a real renderer."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _find_body_text(payload: dict) -> str:
    """Recursively searches Gmail's nested MIME part structure for a
    text/plain part; falls back to text/html (stripped) if that's all
    there is."""
    mime_type = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data")

    if mime_type == "text/plain" and body_data:
        return base64.urlsafe_b64decode(body_data + "==").decode(errors="replace")

    html_fallback = None
    if mime_type == "text/html" and body_data:
        html_fallback = base64.urlsafe_b64decode(body_data + "==").decode(errors="replace")

    for part in payload.get("parts", []) or []:
        found = _find_body_text(part)
        if found:
            return found

    if html_fallback:
        return _strip_html(html_fallback)
    return ""


# File types the rest of the app already knows how to read (see
# document_readers.py) — only attachments matching one of these get
# downloaded and processed; everything else (signature logos, .docx, etc.)
# is skipped.
SUPPORTED_ATTACHMENT_EXTENSIONS = (".xlsx", ".xls", ".csv", ".pdf", ".png", ".jpg", ".jpeg", ".webp")


def _find_attachments(payload: dict) -> list[dict]:
    """Recursively finds MIME parts that are actual file attachments (have
    a filename AND a body.attachmentId — Gmail's way of saying 'this part's
    content is too big to inline, fetch it separately')."""
    found = []
    filename = payload.get("filename")
    attachment_id = payload.get("body", {}).get("attachmentId")
    if filename and attachment_id and filename.lower().endswith(SUPPORTED_ATTACHMENT_EXTENSIONS):
        found.append({"filename": filename, "attachment_id": attachment_id})
    for part in payload.get("parts", []) or []:
        found.extend(_find_attachments(part))
    return found


def fetch_attachment(access_token: str, message_id: str, attachment_id: str) -> bytes:
    result = _gmail_get(access_token, f"/messages/{message_id}/attachments/{attachment_id}")
    return base64.urlsafe_b64decode(result["data"] + "==")


def _header(headers: list, name: str) -> str | None:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def fetch_recent_messages(access_token: str, after: datetime | None, max_results: int = 25) -> list[dict]:
    """
    Returns a list of {gmail_message_id, subject, from_address, received_at,
    body_text} for messages newer than `after` (or the last ~2 days on a
    first-ever scan, to avoid pulling someone's entire inbox history on
    first connect).
    """
    query = f"after:{int(after.timestamp())}" if after else "newer_than:2d"
    listing = _gmail_get(access_token, "/messages", {"q": query, "maxResults": max_results})
    message_ids = [m["id"] for m in listing.get("messages", [])]

    messages = []
    for mid in message_ids:
        full = _gmail_get(access_token, f"/messages/{mid}", {"format": "full"})
        payload = full.get("payload", {})
        headers = payload.get("headers", [])
        internal_date_ms = full.get("internalDate")
        received_at = (
            datetime.utcfromtimestamp(int(internal_date_ms) / 1000) if internal_date_ms else None
        )
        messages.append({
            "gmail_message_id": mid,
            "subject": _header(headers, "Subject"),
            "from_address": _header(headers, "From"),
            "received_at": received_at,
            "body_text": _find_body_text(payload),
            "attachments": _find_attachments(payload),
        })
    return messages
