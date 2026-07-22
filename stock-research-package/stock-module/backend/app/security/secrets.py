"""Authenticated encryption for locally persisted model API keys."""

from typing import Protocol

from cryptography.fernet import Fernet, InvalidToken

from app.repositories.model_profiles import ModelProfileRepository


class SecretNotFound(KeyError):
    """Raised when a requested model secret does not exist."""


class SecretDecryptionError(ValueError):
    """Raised when stored ciphertext cannot be authenticated or decrypted."""


class SecretStore(Protocol):
    def put(self, secret_ref: str, plaintext: str) -> None:
        raise NotImplementedError

    def get(self, secret_ref: str) -> str:
        raise NotImplementedError

    def delete(self, secret_ref: str) -> None:
        raise NotImplementedError


class FernetSecretStore:
    def __init__(
        self,
        repository: ModelProfileRepository,
        key: str | bytes,
        *,
        key_version: str = "v1",
    ) -> None:
        encoded_key = key.encode("ascii") if isinstance(key, str) else key
        self._fernet = Fernet(encoded_key)
        self._repository = repository
        self._key_version = key_version

    def put(self, secret_ref: str, plaintext: str) -> None:
        if not plaintext:
            raise ValueError("model API key cannot be empty")
        ciphertext = self._fernet.encrypt(plaintext.encode("utf-8"))
        self._repository.upsert_secret(secret_ref, self._key_version, ciphertext)

    def get(self, secret_ref: str) -> str:
        ciphertext = self._repository.read_secret_ciphertext(secret_ref)
        if ciphertext is None:
            raise SecretNotFound(secret_ref)
        try:
            return self._fernet.decrypt(ciphertext).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError) as exc:
            raise SecretDecryptionError("model API key could not be decrypted") from exc

    def delete(self, secret_ref: str) -> None:
        self._repository.delete_secret(secret_ref)
