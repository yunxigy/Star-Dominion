# -*- coding: utf-8 -*-
"""语音识别服务"""
import logging
import os

logger = logging.getLogger(__name__)


class STTService:
    """Whisper 语音识别"""

    def __init__(self, config: dict):
        self.config = config
        self.enabled = config.get("enabled", True)
        self.model_name = config.get("model", "base")
        self.device = config.get("device", "cpu")
        self._model = None

        if self.enabled:
            logger.info(f"✅ STT 服务初始化完成 (model={self.model_name}, device={self.device})")
        else:
            logger.warning("⚠️ STT 服务已禁用")

    def _get_model(self):
        """延迟加载模型"""
        if self._model is None:
            from faster_whisper import WhisperModel
            logger.info(f"🎤 加载 Whisper 模型: {self.model_name}")
            self._model = WhisperModel(
                self.model_name, device=self.device, compute_type="int8"
            )
        return self._model

    def transcribe(self, audio_path: str) -> str:
        """
        语音转文字

        Args:
            audio_path: 音频文件路径

        Returns:
            识别的文本
        """
        if not self.enabled:
            raise RuntimeError("STT 服务已禁用")

        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        model = self._get_model()

        segments, info = model.transcribe(
            audio_path,
            language="zh",
            beam_size=10,
            vad_filter=True,
            condition_on_previous_text=False,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=300,
            ),
            temperature=0,
            compression_ratio_threshold=2.5,
        )

        text = "".join(segment.text for segment in segments).strip()
        text = text.replace("。", "").replace("，", "").strip()

        logger.info(f"🎤 STT 结果: {text}")
        return text if text else "（没有听清楚，请再说一次）"
