import os
import pytest


def test_encryption_requires_explicit_key(monkeypatch):
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    from app.encryption import encrypt_token
    with pytest.raises(RuntimeError):
        encrypt_token("secret")


def test_encrypt_decrypt_roundtrip(monkeypatch):
    from cryptography.fernet import Fernet
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    from app.encryption import encrypt_token, decrypt_token
    cipher = encrypt_token("refresh-token")
    assert cipher.startswith("enc:v1:")
    assert decrypt_token(cipher) == "refresh-token"


def test_dashboard_does_not_invent_savings_when_no_benchmark():
    from pathlib import Path
    text = Path(__file__).resolve().parents[1].joinpath("app/routers/dashboard.py").read_text()
    assert "0.048" not in text
    assert "total_savings_inr = None" in text
