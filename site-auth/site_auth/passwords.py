"""Argon2id password hashing boundary."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password must not be empty")
    return _hasher.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    if not encoded:
        return False
    try:
        return _hasher.verify(encoded, password)
    except (InvalidHashError, VerificationError):
        return False


def password_needs_rehash(encoded: str) -> bool:
    try:
        return _hasher.check_needs_rehash(encoded)
    except InvalidHashError:
        return True
