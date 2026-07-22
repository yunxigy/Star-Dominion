"""SQLite persistence for model profiles, encrypted keys and model catalogs."""

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import sqlite3

from app.domain.model_profiles import StoredModelProfile


class ModelProfileRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def save_profile(self, profile: StoredModelProfile) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO model_profiles (
                    id, owner_id, scope, name, provider, base_url,
                    timeout_seconds, enabled, secret_ref, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    owner_id = excluded.owner_id,
                    scope = excluded.scope,
                    name = excluded.name,
                    provider = excluded.provider,
                    base_url = excluded.base_url,
                    timeout_seconds = excluded.timeout_seconds,
                    enabled = excluded.enabled,
                    secret_ref = excluded.secret_ref,
                    updated_at = excluded.updated_at
                """,
                (
                    profile.id,
                    profile.owner_id,
                    profile.scope,
                    profile.name,
                    profile.provider,
                    profile.base_url,
                    profile.timeout_seconds,
                    int(profile.enabled),
                    profile.secret_ref,
                    profile.created_at.isoformat(),
                    profile.updated_at.isoformat(),
                ),
            )

    def get_profile(self, profile_id: str, *, owner_id: str) -> StoredModelProfile | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM model_profiles WHERE id = ? AND owner_id = ?",
                (profile_id, owner_id),
            ).fetchone()
        return self._profile_from_row(row) if row else None

    def list_profiles(self, *, owner_id: str) -> list[StoredModelProfile]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM model_profiles WHERE owner_id = ? ORDER BY updated_at DESC",
                (owner_id,),
            ).fetchall()
        return [self._profile_from_row(row) for row in rows]

    def delete_profile(self, profile_id: str, *, owner_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM model_profiles WHERE id = ? AND owner_id = ?",
                (profile_id, owner_id),
            )
        return cursor.rowcount > 0

    def upsert_secret(self, secret_ref: str, key_version: str, ciphertext: bytes) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO model_secrets (secret_ref, key_version, ciphertext, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(secret_ref) DO UPDATE SET
                    key_version = excluded.key_version,
                    ciphertext = excluded.ciphertext,
                    updated_at = excluded.updated_at
                """,
                (secret_ref, key_version, ciphertext, datetime.now(UTC).isoformat()),
            )

    def read_secret_ciphertext(self, secret_ref: str) -> bytes | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT ciphertext FROM model_secrets WHERE secret_ref = ?",
                (secret_ref,),
            ).fetchone()
        return bytes(row[0]) if row else None

    def delete_secret(self, secret_ref: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM model_secrets WHERE secret_ref = ?", (secret_ref,))

    def save_catalog(self, profile_id: str, models: list[str], *, ttl_seconds: int) -> None:
        now = datetime.now(UTC)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO model_catalog_cache (profile_id, models_json, fetched_at, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(profile_id) DO UPDATE SET
                    models_json = excluded.models_json,
                    fetched_at = excluded.fetched_at,
                    expires_at = excluded.expires_at
                """,
                (
                    profile_id,
                    json.dumps(models, ensure_ascii=False),
                    now.isoformat(),
                    (now + timedelta(seconds=ttl_seconds)).isoformat(),
                ),
            )

    def get_catalog(self, profile_id: str) -> tuple[list[str], datetime] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT models_json, expires_at FROM model_catalog_cache WHERE profile_id = ?",
                (profile_id,),
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0]), datetime.fromisoformat(row[1])

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS model_profiles (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    timeout_seconds INTEGER NOT NULL,
                    enabled INTEGER NOT NULL,
                    secret_ref TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_model_profiles_owner
                    ON model_profiles(owner_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS model_secrets (
                    secret_ref TEXT PRIMARY KEY,
                    key_version TEXT NOT NULL,
                    ciphertext BLOB NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(secret_ref) REFERENCES model_profiles(secret_ref) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS model_catalog_cache (
                    profile_id TEXT PRIMARY KEY,
                    models_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY(profile_id) REFERENCES model_profiles(id) ON DELETE CASCADE
                );
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @staticmethod
    def _profile_from_row(row: sqlite3.Row) -> StoredModelProfile:
        return StoredModelProfile(
            id=row["id"],
            owner_id=row["owner_id"],
            scope=row["scope"],
            name=row["name"],
            provider=row["provider"],
            base_url=row["base_url"],
            timeout_seconds=row["timeout_seconds"],
            enabled=bool(row["enabled"]),
            secret_ref=row["secret_ref"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )
