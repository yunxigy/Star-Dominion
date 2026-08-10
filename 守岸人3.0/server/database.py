# -*- coding: utf-8 -*-
"""数据库连接配置 - 支持 SQLite 和 PostgreSQL"""
import os
import logging
import uuid
from pathlib import Path

from sqlalchemy import create_engine, inspect, text, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from .migrations import run_migrations

logger = logging.getLogger(__name__)

# 数据库文件路径
ROOT_DIR = Path(__file__).parent.parent
DB_PATH = ROOT_DIR / "data" / "app.db"

# 数据库配置优先级：
# 1. 环境变量 DATABASE_URL
# 2. config.yaml 中的 database 配置
# 3. 默认使用 SQLite

def get_database_url() -> str:
    """获取数据库连接URL"""
    # 优先使用环境变量
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        return db_url

    # 尝试从配置文件读取
    try:
        from .config import CONFIG
        db_config = CONFIG.get("database", {})
        db_type = db_config.get("type", "sqlite")

        if db_type == "postgresql":
            host = db_config.get("host", "localhost")
            port = db_config.get("port", 5432)
            user = db_config.get("user", "postgres")
            password = db_config.get("password", "")
            dbname = db_config.get("dbname", "shouanren")
            return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
    except Exception:
        pass

    # 默认使用 SQLite
    return f"sqlite:///{DB_PATH}"


DATABASE_URL = get_database_url()
IS_POSTGRESQL = DATABASE_URL.startswith("postgresql")

# 创建引擎
if IS_POSTGRESQL:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    # SQLite 启用外键约束
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def _ensure_column_on(target_engine, table_name: str, column) -> bool:
    inspector = inspect(target_engine)
    existing_columns = {item["name"] for item in inspector.get_columns(table_name)}
    if column.name in existing_columns:
        return False

    col_type = column.type.compile(dialect=target_engine.dialect)
    nullable = "NULL" if column.nullable else "NOT NULL"
    default = ""
    if column.default is not None:
        default_value = (
            column.default.arg
            if hasattr(column.default, "arg")
            else column.default
        )
        if not callable(default_value):
            if isinstance(default_value, bool):
                default = f" DEFAULT {1 if default_value else 0}"
            elif isinstance(default_value, (int, float)):
                default = f" DEFAULT {default_value}"
            elif isinstance(default_value, str):
                escaped = default_value.replace("'", "''")
                default = f" DEFAULT '{escaped}'"

    statement = (
        f"ALTER TABLE {table_name} ADD COLUMN "
        f"{column.name} {col_type} {nullable}{default}"
    )
    with target_engine.begin() as connection:
        connection.execute(text(statement))
    return True


def migrate_chat_graph(target_engine) -> None:
    """Upgrade linear chat history into a parent-pointer branch graph."""
    from sqlalchemy import Column, DateTime, Integer, String

    from .models.chat_db import ChatBranch, ChatCheckpoint

    inspector = inspect(target_engine)
    if not inspector.has_table("chat_sessions") or not inspector.has_table(
        "chat_messages"
    ):
        return

    session_columns = (
        Column("current_branch_id", String, nullable=True),
        Column("head_message_id", String, nullable=True),
        Column("title", String(120), nullable=True),
        Column("version", Integer, nullable=False, default=1),
    )
    message_columns = (
        Column("branch_id", String, nullable=True),
        Column("parent_message_id", String, nullable=True),
        Column("sequence", Integer, nullable=True),
        Column("edited_at", DateTime(timezone=True), nullable=True),
    )
    for column in session_columns:
        _ensure_column_on(target_engine, "chat_sessions", column)
    for column in message_columns:
        _ensure_column_on(target_engine, "chat_messages", column)

    ChatBranch.__table__.create(bind=target_engine, checkfirst=True)
    ChatCheckpoint.__table__.create(bind=target_engine, checkfirst=True)

    with target_engine.begin() as connection:
        legacy_sessions = connection.execute(
            text(
                """
                SELECT id
                FROM chat_sessions
                WHERE current_branch_id IS NULL
                ORDER BY id
                """
            )
        ).mappings()
        for session_row in legacy_sessions:
            session_id = session_row["id"]
            root_branch_id = str(
                uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    f"shouanren:{session_id}:root",
                )
            )
            message_rows = list(
                connection.execute(
                    text(
                        """
                        SELECT id
                        FROM chat_messages
                        WHERE session_id = :session_id
                        ORDER BY created_at, id
                        """
                    ),
                    {"session_id": session_id},
                ).mappings()
            )
            head_message_id = message_rows[-1]["id"] if message_rows else None
            branch_exists = connection.execute(
                text("SELECT 1 FROM chat_branches WHERE id = :branch_id"),
                {"branch_id": root_branch_id},
            ).first()
            if branch_exists is None:
                connection.execute(
                    text(
                        """
                        INSERT INTO chat_branches (
                            id, session_id, parent_branch_id,
                            fork_message_id, head_message_id, name, created_at
                        )
                        VALUES (
                            :id, :session_id, NULL,
                            NULL, :head_message_id, :name, CURRENT_TIMESTAMP
                        )
                        """
                    ),
                    {
                        "id": root_branch_id,
                        "session_id": session_id,
                        "head_message_id": head_message_id,
                        "name": "主分支",
                    },
                )

            parent_message_id = None
            for sequence, message_row in enumerate(message_rows, start=1):
                connection.execute(
                    text(
                        """
                        UPDATE chat_messages
                        SET branch_id = :branch_id,
                            parent_message_id = :parent_message_id,
                            sequence = :sequence
                        WHERE id = :message_id
                        """
                    ),
                    {
                        "branch_id": root_branch_id,
                        "parent_message_id": parent_message_id,
                        "sequence": sequence,
                        "message_id": message_row["id"],
                    },
                )
                parent_message_id = message_row["id"]

            connection.execute(
                text(
                    """
                    UPDATE chat_branches
                    SET head_message_id = :head_message_id
                    WHERE id = :branch_id
                    """
                ),
                {
                    "head_message_id": head_message_id,
                    "branch_id": root_branch_id,
                },
            )
            connection.execute(
                text(
                    """
                    UPDATE chat_sessions
                    SET current_branch_id = :branch_id,
                        head_message_id = :head_message_id,
                        version = COALESCE(version, 1)
                    WHERE id = :session_id
                    """
                ),
                {
                    "branch_id": root_branch_id,
                    "head_message_id": head_message_id,
                    "session_id": session_id,
                },
            )


def migrate_lorebook_engine(target_engine) -> None:
    """Add advanced lorebook columns and runtime tables to legacy databases."""
    from .models.lorebook import (
        Lorebook,
        LorebookActivationEvent,
        LorebookBinding,
        LorebookEntry,
    )

    inspector = inspect(target_engine)
    if inspector.has_table("lorebooks"):
        for name in (
            "is_character_default",
            "token_budget",
            "recursive_scan",
            "max_recursion_steps",
        ):
            _ensure_column_on(target_engine, "lorebooks", Lorebook.__table__.c[name])
    if inspector.has_table("lorebook_entries"):
        for name in (
            "sticky",
            "delay",
            "prevent_recursion",
            "recursion_only",
            "group_prioritized",
            "revision",
        ):
            _ensure_column_on(
                target_engine,
                "lorebook_entries",
                LorebookEntry.__table__.c[name],
            )

    LorebookBinding.__table__.create(bind=target_engine, checkfirst=True)
    LorebookActivationEvent.__table__.create(bind=target_engine, checkfirst=True)


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_column(table_name: str, column) -> bool:
    """
    为已有表补充缺失字段

    Returns:
        bool: 是否添加了新列
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table_name):
            logger.warning(f"表 {table_name} 不存在，跳过迁移")
            return False

        existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
        if column.name in existing_columns:
            return False

        # 构建 ALTER TABLE 语句
        col_type = column.type.compile(dialect=engine.dialect)
        nullable = "NULL" if column.nullable else "NOT NULL"
        default = ""

        if column.default is not None:
            default_val = column.default.arg if hasattr(column.default, 'arg') else column.default
            if callable(default_val):
                # 默认值是函数（如 uuid.uuid4），跳过默认值
                default = ""
            elif isinstance(default_val, bool):
                default = f" DEFAULT {1 if default_val else 0}"
            elif isinstance(default_val, (int, float)):
                default = f" DEFAULT {default_val}"
            elif isinstance(default_val, str):
                default = f" DEFAULT '{default_val}'"

        sql = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {col_type} {nullable} {default}"

        with engine.begin() as conn:
            conn.execute(text(sql))

        logger.info(f"迁移成功: {table_name}.{column.name}")
        return True

    except Exception as e:
        logger.error(f"迁移失败: {table_name}.{column.name} - {e}")
        return False


def _migrate_existing_tables() -> None:
    """数据库结构迁移：兼容旧版数据"""
    from sqlalchemy import Column, Integer, DateTime, String, Text, Float, Boolean

    logger.info("开始数据库迁移检查...")

    # users 表迁移
    _ensure_column("users", Column("site_user_id", String(64), nullable=True))
    _ensure_column("users", Column("failed_login_attempts", Integer, default=0))
    _ensure_column("users", Column("locked_until", DateTime(timezone=True), nullable=True))
    _ensure_column("users", Column("voice_profile", Text, nullable=True))
    with engine.begin() as conn:
        duplicate = conn.execute(
            text(
                """
                SELECT site_user_id
                FROM users
                WHERE site_user_id IS NOT NULL
                GROUP BY site_user_id
                HAVING COUNT(*) > 1
                LIMIT 1
                """
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            raise RuntimeError(
                f"users.site_user_id contains duplicate value: {duplicate}"
            )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "ix_users_site_user_id ON users(site_user_id)"
            )
        )

    # stories 表迁移
    _ensure_column("stories", Column("outline", Text, nullable=True))
    _ensure_column("stories", Column("share_code", String(20), nullable=True))
    _ensure_column("stories", Column("character_id", String, nullable=True))
    _ensure_column("stories", Column("rating_avg", Float, default=0.0))
    _ensure_column("stories", Column("rating_count", Integer, default=0))

    # story_sessions 表迁移
    _ensure_column("story_sessions", Column("character_id", String, nullable=True))
    _ensure_column("story_sessions", Column("current_branch_id", String, nullable=True))

    # story_messages 表迁移
    _ensure_column("story_messages", Column("branch_id", String, nullable=True))
    _ensure_column("story_messages", Column("parent_branch_id", String, nullable=True))
    _ensure_column("story_messages", Column("is_checkpoint", Boolean, default=False))

    # characters 表迁移（数据库角色）
    _ensure_column("characters", Column("user_id", String, nullable=True))
    _ensure_column("characters", Column("creator_id", String, nullable=True))
    _ensure_column("characters", Column("tts_enabled", Boolean, default=True))
    _ensure_column("characters", Column("tts_model", String, nullable=True))
    _ensure_column("characters", Column("tts_voice", String, nullable=True))
    _ensure_column("characters", Column("tts_style_prompt", Text, nullable=True))
    _ensure_column("characters", Column("tts_ref_audio_path", String, nullable=True))
    _ensure_column("characters", Column("tts_ref_audio_filename", String, nullable=True))

    # lorebook_entries 表迁移
    _ensure_column(
        "lorebook_entries",
        Column("priority", Integer, nullable=False, default=0),
    )
    migrate_lorebook_engine(engine)

    migrate_chat_graph(engine)

    logger.info("数据库迁移检查完成")


def init_db():
    """初始化数据库"""
    from .models import (
        user, character_db, chat_db, image, system_config, story,
        group_chat_db, voice_session, lorebook, memory, affinity
    )

    # 创建所有表
    Base.metadata.create_all(bind=engine)

    # 执行一次性、版本化迁移
    run_migrations(engine, _migrate_existing_tables)

    logger.info(f"数据库初始化完成: {'PostgreSQL' if IS_POSTGRESQL else 'SQLite'}")
