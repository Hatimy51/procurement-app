"""
Database connection setup.

Deliberately kept generic: the app talks to the DB only through SQLAlchemy's
engine/session, never through raw provider-specific code. That means moving
from a local Postgres instance to a managed/cloud Postgres later is a one-line
change to DATABASE_URL — nothing else in the app needs to change.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Default points at a local Postgres for v1 (zero-cost, runs via docker-compose).
# Override with an env var to point at any other Postgres host later.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://procurement:procurement@localhost:5432/procurement_db",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a DB session per request, closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
