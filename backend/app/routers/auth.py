from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import (
    hash_password, verify_password, create_session, set_session_cookie,
    clear_session_cookie, get_current_user, require_manager,
)
from app.schemas_auth import LoginRequest, SetupRequest, UserCreate, UserOut, BootstrapStatusOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(u: models.User) -> UserOut:
    return UserOut(id=u.id, name=u.name, email=u.email, role=u.role.value, created_at=u.created_at)


@router.get("/bootstrap-status", response_model=BootstrapStatusOut)
def bootstrap_status(db: Session = Depends(get_db)):
    """Public (no login needed) — the frontend uses this to decide whether
    to show 'Log in' or 'Create your first Manager account'."""
    return BootstrapStatusOut(needs_setup=db.query(models.User).count() == 0)


@router.post("/setup", response_model=UserOut)
def setup_first_account(payload: SetupRequest, response: Response, db: Session = Depends(get_db)):
    """Creates the first-ever account, always as Manager. Refuses once any
    account exists — from then on, only an existing Manager can create
    more accounts, via POST /api/auth/users."""
    if db.query(models.User).count() > 0:
        raise HTTPException(400, "Setup has already been completed. Log in, or ask a Manager to create your account.")

    user = models.User(
        name=payload.name, email=payload.email,
        password_hash=hash_password(payload.password), role=models.UserRole.manager,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_session(db, user)
    set_session_cookie(response, token)
    return _user_out(user)


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
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
def list_users(manager: models.User = Depends(require_manager), db: Session = Depends(get_db)):
    users = db.query(models.User).order_by(models.User.name).all()
    return [_user_out(u) for u in users]


@router.post("/users", response_model=UserOut)
def create_user(payload: UserCreate, manager: models.User = Depends(require_manager), db: Session = Depends(get_db)):
    if payload.role not in ("purchase", "accounts", "manager"):
        raise HTTPException(400, "Role must be one of: purchase, accounts, manager.")
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
def delete_user(user_id: str, manager: models.User = Depends(require_manager), db: Session = Depends(get_db)):
    if user_id == manager.id:
        raise HTTPException(400, "You can't delete your own account while logged in as it.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    db.query(models.Session).filter(models.Session.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"deleted": True, "id": user_id}
