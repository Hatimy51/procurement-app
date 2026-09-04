"""
Authentication + role-based access control.

Roles and what each can do:
  - purchase: procurement screens (POs, Suppliers, RFQs, Quotes, Inbox, GRNs) — full read/write.
  - accounts: financial screens (Invoices, ERP Sync) — full read/write.
  - manager:  full portal access — all screens, all write actions. Oversight + approvals.
  - admin:    user/account management ONLY — can create/delete users, nothing else.
  - store:    GRN entry queue filtered to their assigned store location only.

Sessions are server-side browser sessions. They are intended for local/internal
deployment; session records are invalidated by logout and can be expired by
the application when their configured lifetime is reached.
"""
import os
import secrets
from fastapi import Depends, HTTPException, Request, Response
from datetime import datetime
from sqlalchemy.orm import Session as DBSession
import bcrypt

from app.database import get_db
from app import models

SESSION_COOKIE_NAME = "session_token"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

# Roles with full portal read access (can view all screens)
FULL_READ_ROLES = {"purchase", "accounts", "manager"}

# The universal super-role — can do everything any other role can
SUPER_ROLE = "manager"


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


SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key=SESSION_COOKIE_NAME, value=token,
        httponly=True, samesite="lax",
        secure=SESSION_COOKIE_SECURE,
        max_age=SESSION_MAX_AGE_SECONDS,  # 30 days
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME)


SESSION_IDLE_TIMEOUT_SECONDS = int(os.getenv("SESSION_IDLE_TIMEOUT_SECONDS", str(60 * 60 * 8)))  # 8 hours


def get_current_user(request: Request, db: DBSession = Depends(get_db)) -> models.User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not logged in.")
    session = db.query(models.Session).filter(models.Session.token == token).first()
    if not session:
        raise HTTPException(401, "Session expired or invalid — please log in again.")

    now = datetime.utcnow()

    # Hard expiry: absolute 30-day ceiling from creation
    if (now - session.created_at).total_seconds() > SESSION_MAX_AGE_SECONDS:
        db.delete(session)
        db.commit()
        raise HTTPException(401, "Session expired — please log in again.")

    # Idle expiry: no activity for SESSION_IDLE_TIMEOUT_SECONDS
    last_seen = session.last_seen_at or session.created_at
    if (now - last_seen).total_seconds() > SESSION_IDLE_TIMEOUT_SECONDS:
        db.delete(session)
        db.commit()
        raise HTTPException(401, "Session timed out due to inactivity — please log in again.")

    # Refresh last_seen_at on every authenticated request
    session.last_seen_at = now
    db.commit()

    return session.user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    """Only admin (and manager as super-role) can manage user accounts."""
    if user.role not in (models.UserRole.admin, models.UserRole.manager):
        raise HTTPException(403, "Only an Admin can manage user accounts.")
    return user


# Kept for backward compatibility — now admin role manages users
require_manager = require_admin


def require_router_access(owner_role: str):
    """
    Applied once per router in main.py — e.g.
    `app.include_router(enquiries.router, dependencies=[Depends(require_router_access("purchase"))])`.

    Access rules:
      - GET (viewing): allowed for the owning role AND for manager.
      - Anything else (creating/editing/deleting): allowed for the owning role AND manager.
      - Paths ending in "/approve": manager only (for Customer Quote approval).
      - admin role: blocked from ALL procurement routers — user management screen only.
      - store role: allowed only through the GRN router; GRN endpoints enforce store-location scope.
    """
    def dependency(request: Request, user: models.User = Depends(get_current_user)) -> models.User:
        role = user.role.value

        # admin and store have no access to any procurement router
        if role == "admin":
            raise HTTPException(403, "Admin accounts can only access user management.")
        if role == "store" and owner_role != "grn":
            raise HTTPException(403, "Store accounts can only access the GRN receiving queue.")

        # approve endpoints: manager only
        if request.url.path.endswith("/approve"):
            if role != SUPER_ROLE:
                raise HTTPException(403, "Only a Manager can approve a quote.")
            return user

        # manager can do everything
        if role == SUPER_ROLE:
            return user

        # owning role check
        if role != owner_role:
            raise HTTPException(403, "You don't have access to this screen.")

        return user

    return dependency
