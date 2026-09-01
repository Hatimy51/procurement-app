"""
Authentication + role-based access control.

Roles and what each can do (agreed with the client):
  - purchase: every screen EXCEPT Invoices — full read/write there.
  - accounts: Invoices only — full read/write there, nothing else.
  - manager:  can VIEW every screen (oversight), but the only write action
              granted anywhere is approving a Customer Quote.

Sessions are simple and don't expire — this runs on one trusted local
machine, not the open internet. A session lasts until logout.
"""
import secrets
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session as DBSession
import bcrypt

from app.database import get_db
from app import models

SESSION_COOKIE_NAME = "session_token"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_session(db: DBSession, user: models.User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(models.Session(token=token, user_id=user.id))
    db.commit()
    return token


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key=SESSION_COOKIE_NAME, value=token,
        httponly=True, samesite="lax",
        max_age=60 * 60 * 24 * 30,  # 30 days — just caps an abandoned cookie, not a real expiry policy
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME)


def get_current_user(request: Request, db: DBSession = Depends(get_db)) -> models.User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not logged in.")
    session = db.query(models.Session).filter(models.Session.token == token).first()
    if not session:
        raise HTTPException(401, "Session expired or invalid — please log in again.")
    return session.user


def require_manager(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != models.UserRole.manager:
        raise HTTPException(403, "Only a Manager can do this.")
    return user


def require_router_access(owner_role: str):
    """
    Applied once per router in main.py — e.g.
    `app.include_router(enquiries.router, dependencies=[Depends(require_router_access("purchase"))])`.
    Handles the two access shapes every screen in this app needs, without
    editing every individual endpoint:
      - GET (viewing): allowed for the owning role AND for Manager
        (oversight — Manager can look at everything).
      - Anything else (creating/editing/deleting): allowed ONLY for the
        owning role.

    One deliberate carve-out: a request to a path ending in "/approve" is
    reserved for Manager alone, regardless of the router's owning role —
    this is how Customer Quote approval stays Manager-only even though the
    rest of that router (drafting, sending) belongs to Purchase.
    """
    def dependency(request: Request, user: models.User = Depends(get_current_user)) -> models.User:
        if request.url.path.endswith("/approve"):
            if user.role != models.UserRole.manager:
                raise HTTPException(403, "Only a Manager can approve a quote.")
            return user

        if request.method == "GET":
            if user.role.value not in (owner_role, "manager"):
                raise HTTPException(403, "You don't have access to this screen.")
        else:
            if user.role.value != owner_role:
                raise HTTPException(403, "You don't have permission to make changes here.")
        return user

    return dependency
