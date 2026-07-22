from pathlib import Path
from io import StringIO

from sqlalchemy import select

from site_auth.cli import run
from site_auth.config import Settings
from site_auth.database import create_database
from site_auth.models import Session, User
from site_auth.passwords import verify_password


def _environment(tmp_path: Path) -> dict[str, str]:
    return {
        "SITE_AUTH_DATA_DIR": str(tmp_path),
        "SITE_AUTH_INTERNAL_KEY": "internal-test-key-0123456789abcdef",
        "SITE_AUTH_ALLOWED_ORIGINS": "https://testserver",
        "SITE_AUTH_COOKIE_SECURE": "true",
    }


def test_cli_creates_admin_without_echoing_password(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    answers = iter(["a long private password", "a long private password"])
    monkeypatch.setattr("site_auth.cli.getpass", lambda _: next(answers))

    result = run(
        [
            "create-admin",
            "--email",
            "owner@example.com",
            "--username",
            "owner",
        ],
        environment=_environment(tmp_path),
    )

    assert result == 0
    assert "a long private password" not in capsys.readouterr().out
    database = create_database(Settings.from_env(_environment(tmp_path)).database_path)
    with database.sessions() as db:
        user = db.scalar(select(User).where(User.username == "owner"))
        assert user is not None
        assert user.role == "admin"
        assert verify_password("a long private password", user.password_hash)
    database.dispose()


def test_cli_requires_explicit_reset_for_existing_admin(
    tmp_path: Path,
    monkeypatch,
) -> None:
    answers = iter(
        [
            "first private password",
            "first private password",
            "second private password",
            "second private password",
        ]
    )
    monkeypatch.setattr("site_auth.cli.getpass", lambda _: next(answers))
    environment = _environment(tmp_path)

    assert run(
        ["create-admin", "--email", "owner@example.com", "--username", "owner"],
        environment=environment,
    ) == 0
    assert run(
        ["create-admin", "--email", "owner@example.com", "--username", "owner"],
        environment=environment,
    ) == 2
    assert run(
        ["reset-admin", "--username", "owner"],
        environment=environment,
    ) == 0

    database = create_database(Settings.from_env(environment).database_path)
    with database.sessions() as db:
        user = db.scalar(select(User).where(User.username == "owner"))
        assert user is not None
        assert not verify_password("first private password", user.password_hash)
        assert verify_password("second private password", user.password_hash)
    database.dispose()


def test_cli_has_no_default_identity_or_password(tmp_path: Path) -> None:
    assert run(["create-admin"], environment=_environment(tmp_path)) == 2


def test_cli_can_read_password_twice_from_stdin_for_local_automation(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    monkeypatch.setattr(
        "site_auth.cli.sys.stdin",
        StringIO("stdin private password\nstdin private password\n"),
    )

    result = run(
        [
            "create-admin",
            "--email",
            "owner@example.com",
            "--username",
            "owner",
            "--password-stdin",
        ],
        environment=_environment(tmp_path),
    )

    assert result == 0
    assert "stdin private password" not in capsys.readouterr().out


def test_recreate_admin_requires_destructive_confirmation(tmp_path: Path) -> None:
    result = run(
        [
            "recreate-admin",
            "--email",
            "owner@example.com",
            "--username",
            "owner",
        ],
        environment=_environment(tmp_path),
    )

    assert result == 2


def test_recreate_admin_replaces_every_account_and_session(
    tmp_path: Path,
    monkeypatch,
) -> None:
    environment = _environment(tmp_path)
    answers = iter(["first private password", "first private password"])
    monkeypatch.setattr("site_auth.cli.getpass", lambda _: next(answers))
    assert run(
        ["create-admin", "--email", "old@example.com", "--username", "old"],
        environment=environment,
    ) == 0

    database = create_database(Settings.from_env(environment).database_path)
    with database.sessions() as db:
        old_user = db.scalar(select(User).where(User.username == "old"))
        assert old_user is not None
        db.add(
            Session(
                user_id=old_user.id,
                token_hash="a" * 64,
                csrf_hash="b" * 64,
                expires_at=old_user.created_at,
            )
        )
        db.commit()
    database.dispose()

    answers = iter(["replacement password", "replacement password"])
    monkeypatch.setattr("site_auth.cli.getpass", lambda _: next(answers))
    result = run(
        [
            "recreate-admin",
            "--email",
            "admin@example.com",
            "--username",
            "admin",
            "--confirm-delete-all-users",
        ],
        environment=environment,
    )

    assert result == 0
    database = create_database(Settings.from_env(environment).database_path)
    with database.sessions() as db:
        users = list(db.scalars(select(User)))
        sessions = list(db.scalars(select(Session)))
        assert [(user.username, user.role) for user in users] == [("admin", "admin")]
        assert sessions == []
        assert verify_password("replacement password", users[0].password_hash)
    database.dispose()
