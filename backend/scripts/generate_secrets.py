"""
Run this once to generate real values for your .env:

    python scripts/generate_secrets.py

Paste the printed values into SECRET_KEY and ENCRYPTION_KEY in backend/.env.
Never commit the output anywhere.
"""
import secrets

from cryptography.fernet import Fernet

print("SECRET_KEY=" + secrets.token_urlsafe(64))
print("ENCRYPTION_KEY=" + Fernet.generate_key().decode())
