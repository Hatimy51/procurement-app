from datetime import datetime
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class SetupRequest(BaseModel):
    """Creates the very first account — always a Manager. Only allowed
    while the users table is completely empty."""
    name: str
    email: str
    password: str


class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str  # "purchase" | "accounts" | "manager"


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    created_at: datetime


class BootstrapStatusOut(BaseModel):
    needs_setup: bool
