# -*- coding: utf-8 -*-
"""MiMo TTS 语音合成服务"""
import base64
import logging
import os
from pathlib import Path
from openai import OpenAI

logger = logging.getLogger(__name__)

VOICES_DIR = Path(__file__).parent.parent.parent / "data" / "voices"


class TTSService:
    """MiMo-V2.5-TTS 语音合成"""

    def __init__(self, config: dict):
        self.config = config
        self.enabled = config.get("enabled", True)
        self.base_url = config.get("base_url", "https://api.xiaomimimo.com/v1")
        self.api_key = config.get("api_key", "")
        self.default_model = config.get("default_model", "mimo-v2.5-tts-voiceclone")
        self.default_voice = config.get("default_voice", "冰糖")
        self.format = config.get("format", "wav")

        if self.enabled and self.api_key:
            self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)
            logger.info("✅ TTS 服务初始化完成")
        else:
            self.client = None
            logger.warning("⚠️ TTS 未配置 API Key，语音合成功能不可用")

    def synthesize(
        self,
        text: str,
        character_tts: dict = None,
        style_instruction: str = "",
    ) -> bytes:
        """
        合成语音

        Args:
            text: 要合成的文本
            character_tts: 角色的 TTS 配置 {
                "model": "mimo-v2.5-tts-voiceclone",
                "voice": "冰糖" 或 "data:audio/mpeg;base64,...",
                "ref_audio_path": "data/voices/xxx.wav",
                "style_prompt": "温柔平静的语调",
            }
            style_instruction: 额外的风格指令

        Returns:
            音频文件的字节数据
        """
        if not self.client:
            raise RuntimeError("TTS 服务未配置")

        tts_cfg = character_tts or {}
        model = tts_cfg.get("model", self.default_model)
        voice = tts_cfg.get("voice", self.default_voice)
        style_prompt = tts_cfg.get("style_prompt", "")
        ref_audio_path = tts_cfg.get("ref_audio_path", "")

        # 构建 user 消息（风格指令）
        user_content = style_instruction or style_prompt or ""

        # 构建 assistant 消息（要合成的文本）
        assistant_content = text

        messages = [
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": assistant_content},
        ]

        # 构建 audio 参数
        audio_params = {"format": self.format}

        if model == "mimo-v2.5-tts-voiceclone":
            # 音色克隆：需要 base64 编码的参考音频
            voice_data = self._load_voice_clone(voice, ref_audio_path)
            audio_params["voice"] = voice_data
        elif model == "mimo-v2.5-tts":
            # 预置音色
            audio_params["voice"] = voice
        elif model == "mimo-v2.5-tts-voicedesign":
            # 音色设计：voice 字段不需要
            pass

        logger.info(f"🔊 TTS 合成: model={model}, text={text[:30]}...")

        completion = self.client.chat.completions.create(
            model=model,
            messages=messages,
            audio=audio_params,
        )

        message = completion.choices[0].message
        audio_bytes = base64.b64decode(message.audio.data)
        logger.info(f"✅ TTS 合成完成: {len(audio_bytes)} bytes")
        return audio_bytes

    def _load_voice_clone(self, voice: str, ref_audio_path: str) -> str:
        """加载音色克隆的参考音频，返回 base64 编码"""
        # 如果 voice 已经是 base64 数据，直接返回
        if voice.startswith("data:"):
            return voice

        # 如果有参考音频文件路径
        if ref_audio_path and os.path.exists(ref_audio_path):
            return self._encode_audio_file(ref_audio_path)

        # 如果 voice 是一个文件名，尝试在 voices 目录中查找
        voice_path = VOICES_DIR / voice
        if voice_path.exists():
            return self._encode_audio_file(str(voice_path))

        raise FileNotFoundError(f"找不到参考音频: {voice} 或 {ref_audio_path}")

    def _encode_audio_file(self, file_path: str) -> str:
        """将音频文件编码为 base64 data URI"""
        with open(file_path, "rb") as f:
            audio_bytes = f.read()

        ext = Path(file_path).suffix.lower()
        mime_map = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "audio/mp4"}
        mime_type = mime_map.get(ext, "audio/wav")

        b64 = base64.b64encode(audio_bytes).decode("utf-8")
        return f"data:{mime_type};base64,{b64}"
