from pathlib import Path

import pytest

from site_auth.config import Settings
from site_auth.database import create_database
from site_auth.models import Session, User
from site_auth.passwords import hash_password, verify_password


def test_internal_key_has_no_default(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="SITE_AUTH_INTERNAL_KEY"):
        Settings.from_env(
            {
                "SITE_AUTH_DATA_DIR": str(tmp_path),
                "SITE_AUTH_ALLOWED_ORIGINS": "http://127.0.0.1:8013",
            }
        )


def test_settings_parse_local_environment(tmp_path: Path) -> None:
    settings = Settings.from_env(
        {
            "SITE_AUTH_DATA_DIR": str(tmp_path),
            "SITE_AUTH_INTERNAL_KEY": "k" * 32,
            "SITE_AUTH_ALLOWED_ORIGINS": (
                "http://127.0.0.1:8013,https://zhumenggy.top"
            ),
            "SITE_AUTH_COOKIE_SECURE": "false",
        }
    )

    assert settings.data_dir == tmp_path.resolve()
    assert settings.database_path == tmp_path.resolve() / "auth.db"
    assert settings.internal_service_key == "k" * 32
    assert settings.allowed_origins == (
        "http://127.0.0.1:8013",
        "https://zhumenggy.top",
    )
    assert settings.cookie_secure is False


def test_password_hash_uses_argon2id() -> None:
    encoded = hash_password("correct horse battery staple")

    assert encoded.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong", encoded)
    assert not verify_password("correct horse battery staple", "")
    assert not verify_password("correct horse battery staple", "not-a-hash")


def test_database_initializes_auth_tables(tmp_path: Path) -> None:
    database = create_database(tmp_path / "auth.db")

    assert set(database.table_names()) == {
        User.__tablename__,
        Session.__tablename__,
        "schema_metadata",
    }
    database.dispose()
