# -*- coding: utf-8 -*-
"""角色卡迁移脚本：将 JSON 角色卡迁移到数据库"""
import json
import sys
from pathlib import Path

# 添加项目路径
SERVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SERVER_DIR.parent))

from server.database import SessionLocal, init_db
from server.models.character_db import CharacterDB


def migrate_characters():
    """迁移 JSON 角色卡到数据库"""
    init_db()

    characters_dir = SERVER_DIR.parent / "data" / "characters"
    if not characters_dir.exists():
        print("❌ 角色卡目录不存在")
        return

    db = SessionLocal()
    migrated = 0
    skipped = 0
    errors = 0

    for json_file in characters_dir.glob("*.json"):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            char_id = data.get("id", json_file.stem)

            # 检查是否已存在
            existing = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
            if existing:
                print(f"⏭️  跳过已存在: {char_id}")
                skipped += 1
                continue

            # 提取 TTS 配置
            tts_config = data.get("tts", {})

            # 创建数据库记录
            char_db = CharacterDB(
                id=char_id,
                name=data.get("name", ""),
                description=data.get("description", ""),
                personality=data.get("personality", ""),
                system_prompt=data.get("system_prompt", ""),
                first_mes=data.get("first_mes", ""),
                mes_example=data.get("mes_example", ""),
                avatar_url=data.get("avatar", ""),
                is_nsfw=data.get("is_nsfw", False),
                is_public=True,
                tags=data.get("tags", []),
                tts_enabled=tts_config.get("enabled", True),
                tts_model=tts_config.get("model", ""),
                tts_voice=tts_config.get("voice", ""),
                tts_style_prompt=tts_config.get("style_prompt", ""),
                tts_ref_audio_path=tts_config.get("ref_audio_path", ""),
                tts_ref_audio_filename=tts_config.get("ref_audio_filename", ""),
            )

            db.add(char_db)
            migrated += 1
            print(f"✅ 迁移: {char_id} ({data.get('name', '')})")

        except Exception as e:
            print(f"❌ 迁移失败 {json_file.name}: {e}")
            errors += 1

    db.commit()
    db.close()

    print(f"\n迁移完成: 成功 {migrated}, 跳过 {skipped}, 失败 {errors}")


if __name__ == "__main__":
    migrate_characters()
