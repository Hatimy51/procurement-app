import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Import ALL models so every table is registered on Base.metadata before create_all.
from app.database import Base, get_db
import app.models  # noqa: F401
from app.main import app

from sqlalchemy.pool import StaticPool

# In-memory SQLite using StaticPool so all connections share the same memory DB
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine_test = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    """Create all tables once per test session."""
    Base.metadata.create_all(bind=engine_test)
    yield
    Base.metadata.drop_all(bind=engine_test)


@pytest.fixture()
def client():
    """TestClient wired to the in-memory test DB."""
    def _get_test_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _get_test_db
    with TestClient(app, raise_server_exceptions=False, follow_redirects=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def authed_client(client):
    """
    Returns a TestClient that is already logged in as the first admin/manager user.
    Auth is cookie-based — the TestClient carries the session_token cookie automatically
    after the setup/login call.
    """
    # Try first-time setup (only works when the users table is empty)
    resp = client.post(
        "/api/auth/setup",
        json={"name": "tester", "email": "tester@example.com", "password": "Pass123!"},
    )
    # If setup was already completed, log in instead
    if resp.status_code not in (200, 201):
        client.post(
            "/api/auth/login",
            json={"email": "tester@example.com", "password": "Pass123!"},
        )
    # The session cookie is now stored in `client.cookies` automatically.
    return client


