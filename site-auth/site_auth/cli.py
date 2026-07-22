"""Interactive administrator lifecycle commands."""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from getpass import getpass
import os
import sys

from sqlalchemy import func, or_, select, update

from .config import Settings
from .database import create_database
from .models import Session, User
from .passwords import hash_password


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="site-auth-admin")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-admin")
    create.add_argument("--email", required=True)
    create.add_argument("--username", required=True)
    create.add_argument("--password-stdin", action="store_true")
    reset = commands.add_parser("reset-admin")
    reset.add_argument("--username", required=True)
    reset.add_argument("--password-stdin", action="store_true")
    return parser


def _read_password(*, from_stdin: bool = False) -> str:
    if from_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
        confirmation = sys.stdin.readline().rstrip("\r\n")
        if not password or not confirmation:
            raise ValueError("标准输入必须提供两行管理员密码")
    else:
        password = getpass("管理员密码：")
        confirmation = getpass("再次输入管理员密码：")
    if password != confirmation:
        raise ValueError("两次输入的密码不一致")
    if len(password) < 12:
        raise ValueError("管理员密码至少需要 12 个字符")
    return password


def run(
    argv: Sequence[str] | None = None,
    *,
    environment: Mapping[str, str] | None = None,
) -> int:
    try:
        args = _parser().parse_args(argv)
    except SystemExit as exc:
        return int(exc.code)

    try:
        settings = Settings.from_env(os.environ if environment is None else environment)
        database = create_database(settings.database_path)
        with database.sessions() as db:
            if args.command == "create-admin":
                email = args.email.strip().lower()
                username = args.username.strip()
                existing = db.scalar(
                    select(User).where(
                        or_(
                            func.lower(User.email) == email,
                            func.lower(User.username) == username.lower(),
                        )
                    )
                )
                if existing is not None:
                    print("管理员已存在；如需更换密码请使用 reset-admin")
                    return 2
                password = _read_password(from_stdin=args.password_stdin)
                db.add(
                    User(
                        email=email,
                        username=username,
                        password_hash=hash_password(password),
                        role="admin",
                    )
                )
                db.commit()
                print(f"管理员 {username} 创建成功")
                return 0

            user = db.scalar(
                select(User).where(
                    func.lower(User.username) == args.username.strip().lower()
                )
            )
            if user is None or user.role != "admin":
                print("管理员不存在")
                return 2
            password = _read_password(from_stdin=args.password_stdin)
            user.password_hash = hash_password(password)
            db.execute(
                update(Session)
                .where(Session.user_id == user.id, Session.revoked_at.is_(None))
                .values(revoked_at=func.now())
            )
            db.commit()
            print(f"管理员 {user.username} 的密码已重置，现有会话已撤销")
            return 0
    except ValueError as exc:
        print(str(exc))
        return 2
    finally:
        if "database" in locals():
            database.dispose()


def main() -> None:
    raise SystemExit(run())
