# -*- coding: utf-8 -*-
"""JSON 角色迁移到数据库"""
import json
import logging
from pathlib import Path
from .database import SessionLocal
from .models.character_db import CharacterDB

logger = logging.getLogger("shouanren.migrate")


def migrate_json_characters(data_dir: Path) -> int:
    """将 data/characters/*.json 迁移到数据库（跳过已存在的）。

    Returns:
        迁移数量
    """
    chars_dir = data_dir / "characters"
    if not chars_dir.exists():
        return 0

    json_files = list(chars_dir.glob("*.json"))
    if not json_files:
        return 0

    migrated = 0
    with SessionLocal() as db:
        for f in json_files:
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except Exception as e:
                logger.warning(f"跳过无效 JSON {f.name}: {e}")
                continue

            char_id = data.get("id", f.stem)

            # 跳过已存在
            existing = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
            if existing:
                logger.debug(f"角色已存在，跳过: {char_id}")
                continue

            # 解析 TTS 配置
            tts = data.get("tts", {})

            char = CharacterDB(
                id=char_id,
                name=data.get("name", f.stem),
                description=data.get("description", ""),
                personality=data.get("personality", ""),
                system_prompt=data.get("system_prompt", ""),
                first_mes=data.get("first_mes", ""),
                mes_example=data.get("mes_example", ""),
                avatar_url=data.get("avatar", ""),
                tts_enabled=tts.get("enabled", True),
                tts_model=tts.get("model", "mimo-v2.5-tts-voiceclone"),
                tts_voice=tts.get("voice", "冰糖"),
                tts_style_prompt=tts.get("style_prompt", ""),
                tts_ref_audio_path=tts.get("ref_audio_path", ""),
                tts_ref_audio_filename=tts.get("ref_audio_filename", ""),
                tags=data.get("tags", []),
                is_public=True,
            )
            db.add(char)
            migrated += 1
            logger.info(f"迁移角色: {char_id} ({data.get('name', '')})")

        if migrated > 0:
            db.commit()
            logger.info(f"共迁移 {migrated} 个角色到数据库")

    return migrated
