from fastapi import APIRouter, Depends, HTTPException, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import (
    hash_password, verify_password, create_session, set_session_cookie,
    clear_session_cookie, get_current_user, require_admin,
)
from app.schemas_auth import LoginRequest, SetupRequest, UserCreate, UserOut, BootstrapStatusOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

VALID_ROLES = ("purchase", "accounts", "manager", "admin", "store")

# Shared limiter instance — defined here; the one in main.py is the same object
# attached to app.state so slowapi middleware can reach it.
limiter = Limiter(key_func=get_remote_address)


def _user_out(u: models.User) -> UserOut:
    return UserOut(id=u.id, name=u.name, email=u.email, role=u.role.value, created_at=u.created_at)


@router.get("/bootstrap-status", response_model=BootstrapStatusOut)
def bootstrap_status(db: Session = Depends(get_db)):
    """Public (no login needed) — the frontend uses this to decide whether
    to show 'Log in' or 'Create your first Admin account'."""
    return BootstrapStatusOut(needs_setup=db.query(models.User).count() == 0)


@router.post("/setup", response_model=UserOut)
@limiter.limit("10/minute")
def setup_first_account(request: Request, payload: SetupRequest, response: Response, db: Session = Depends(get_db)):
    """Creates the first-ever account, always as Admin. Refuses once any
    account exists — from then on, only an existing Admin/Manager can create
    more accounts, via POST /api/auth/users."""
    if db.query(models.User).count() > 0:
        raise HTTPException(400, "Setup has already been completed. Log in, or ask an Admin to create your account.")

    user = models.User(
        name=payload.name, email=payload.email,
        password_hash=hash_password(payload.password), role=models.UserRole.admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_session(db, user)
    set_session_cookie(response, token)
    return _user_out(user)


@router.post("/login", response_model=UserOut)
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Max 10 login attempts per IP per minute to prevent brute-force attacks."""
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password.")

    token = create_session(db, user)
    set_session_cookie(response, token)
    return _user_out(user)


@router.post("/logout")
def logout(request_user: models.User = Depends(get_current_user), response: Response = None, db: Session = Depends(get_db)):
    db.query(models.Session).filter(models.Session.user_id == request_user.id).delete()
    db.commit()
    clear_session_cookie(response)
    return {"logged_out": True}


@router.get("/me", response_model=UserOut)
def me(user: models.User = Depends(get_current_user)):
    return _user_out(user)


@router.get("/users", response_model=list[UserOut])
def list_users(admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(models.User).order_by(models.User.name).all()
    return [_user_out(u) for u in users]


@router.post("/users", response_model=UserOut)
def create_user(payload: UserCreate, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    if payload.role not in VALID_ROLES:
        raise HTTPException(400, f"Role must be one of: {', '.join(VALID_ROLES)}.")
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(400, "An account with that email already exists.")

    user = models.User(
        name=payload.name, email=payload.email,
        password_hash=hash_password(payload.password), role=models.UserRole(payload.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.delete("/users/{user_id}")
def delete_user(user_id: str, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(400, "You can't delete your own account while logged in as it.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    db.query(models.Session).filter(models.Session.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"deleted": True, "id": user_id}
