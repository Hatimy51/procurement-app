import base64
import os

from cryptography.fernet import Fernet, InvalidToken


def _get_fernet() -> Fernet:
    """Return the configured Fernet instance. A real key is required."""
    raw_key = os.getenv("ENCRYPTION_KEY", "").strip()
    if not raw_key:
        raise RuntimeError("ENCRYPTION_KEY is not configured. Generate a Fernet key and add it to .env.")
    try:
        return Fernet(raw_key.encode("ascii"))
    except Exception as exc:
        raise RuntimeError("ENCRYPTION_KEY is invalid. Generate a valid Fernet key.") from exc


def encrypt_token(plain_text: str | None) -> str | None:
    if not plain_text:
        return plain_text
    if plain_text.startswith("enc:v1:"):
        return plain_text
    return "enc:v1:" + _get_fernet().encrypt(plain_text.encode("utf-8")).decode("utf-8")


def decrypt_token(cipher_text: str | None) -> str | None:
    if not cipher_text or not cipher_text.startswith("enc:v1:"):
        return cipher_text
    try:
        return _get_fernet().decrypt(cipher_text[7:].encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored OAuth token cannot be decrypted. Check ENCRYPTION_KEY.") from exc
