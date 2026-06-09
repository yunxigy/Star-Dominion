# -*- coding: utf-8 -*-
"""聊天历史迁移脚本：将 JSON 聊天记录迁移到数据库"""
import json
import sys
from pathlib import Path
from datetime import datetime

# 添加项目路径
SERVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SERVER_DIR.parent))

from server.database import SessionLocal, init_db
from server.models.chat_db import ChatSession, ChatMessage
from server.models.user import User


def migrate_chats():
    """迁移 JSON 聊天记录到数据库"""
    init_db()

    chats_dir = SERVER_DIR.parent / "data" / "chats"
    if not chats_dir.exists():
        print("❌ 聊天目录不存在")
        return

    db = SessionLocal()

    # 获取第一个用户作为默认用户
    default_user = db.query(User).first()
    if not default_user:
        print("❌ 没有用户，请先创建用户")
        db.close()
        return

    migrated = 0
    errors = 0

    for json_file in chats_dir.glob("*.json"):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            character_id = json_file.stem
            messages = data if isinstance(data, list) else data.get("messages", [])

            if not messages:
                print(f"⏭️  跳过空文件: {character_id}")
                continue

            # 创建会话
            session = ChatSession(
                user_id=default_user.id,
                character_id=character_id,
            )
            db.add(session)
            db.flush()  # 获取 session.id

            # 迁移消息
            for i, msg in enumerate(messages):
                role = msg.get("role", "user")
                content = msg.get("content", "")

                # 处理不同的消息格式
                if isinstance(content, str):
                    content_data = {"text": content}
                elif isinstance(content, dict):
                    content_data = content
                else:
                    content_data = {"text": str(content)}

                chat_msg = ChatMessage(
                    session_id=session.id,
                    role=role,
                    content=content_data,
                )
                db.add(chat_msg)

            migrated += 1
            print(f"✅ 迁移: {character_id} ({len(messages)} 条消息)")

        except Exception as e:
            print(f"❌ 迁移失败 {json_file.name}: {e}")
            errors += 1

    db.commit()
    db.close()

    print(f"\n迁移完成: 成功 {migrated}, 失败 {errors}")


if __name__ == "__main__":
    migrate_chats()
