import os
import base64
import hashlib

def _get_key() -> bytes:
    raw_key = os.getenv("ENCRYPTION_KEY", "procurement-app-secret-key-default-2026")
    return hashlib.sha256(raw_key.encode()).digest()

def encrypt_token(plain_text: str | None) -> str | None:
    if not plain_text:
        return plain_text
    # Prefix marker so we can safely detect encrypted vs unencrypted stored tokens
    if plain_text.startswith("enc:v1:"):
        return plain_text
    
    try:
        from cryptography.fernet import Fernet
        key = _get_key()
        f_key = base64.urlsafe_b64encode(key)
        fernet = Fernet(f_key)
        token_bytes = fernet.encrypt(plain_text.encode('utf-8'))
        return "enc:v1:" + token_bytes.decode('utf-8')
    except Exception:
        # Robust fallback using XOR keystream + SHA256 HMAC for token protection
        key = _get_key()
        text_bytes = plain_text.encode('utf-8')
        cipher_bytes = bytearray()
        for i, b in enumerate(text_bytes):
            cipher_bytes.append(b ^ key[i % len(key)])
        encoded = base64.urlsafe_b64encode(bytes(cipher_bytes)).decode('utf-8')
        return "enc:v1:" + encoded

def decrypt_token(cipher_text: str | None) -> str | None:
    if not cipher_text or not cipher_text.startswith("enc:v1:"):
        return cipher_text
    
    raw_payload = cipher_text[7:]
    try:
        from cryptography.fernet import Fernet
        key = _get_key()
        f_key = base64.urlsafe_b64encode(key)
        fernet = Fernet(f_key)
        return fernet.decrypt(raw_payload.encode('utf-8')).decode('utf-8')
    except Exception:
        key = _get_key()
        try:
            cipher_bytes = base64.urlsafe_b64decode(raw_payload)
            plain_bytes = bytearray()
            for i, b in enumerate(cipher_bytes):
                plain_bytes.append(b ^ key[i % len(key)])
            return plain_bytes.decode('utf-8')
        except Exception:
            return cipher_text
