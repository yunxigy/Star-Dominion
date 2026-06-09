# -*- coding: utf-8 -*-
"""多后端 LLM 服务 - 增强版"""
import logging
import time
from typing import Optional, Generator
from openai import OpenAI, APITimeoutError, APIConnectionError, RateLimitError

logger = logging.getLogger(__name__)


class LLMService:
    """多后端 LLM 调度器，支持超时、重试、fallback、流式输出"""

    def __init__(self, config: dict):
        self.config = config
        self.backends = config.get("backends", {})
        self.default_backend = config.get("default_backend", "openai")
        self._clients = {}

        # 增强配置
        self.timeout = config.get("timeout", 30)  # 请求超时（秒）
        self.max_retries = config.get("max_retries", 2)  # 最大重试次数
        self.retry_delay = config.get("retry_delay", 1)  # 重试延迟（秒）
        self.fallback_backends = config.get("fallback_backends", [])  # fallback后端列表

        logger.info(f"✅ LLM 服务初始化完成，默认后端: {self.default_backend}")

    def _get_client(self, backend_name: str) -> OpenAI:
        """获取或创建后端客户端"""
        if backend_name in self._clients:
            return self._clients[backend_name]

        cfg = self.backends.get(backend_name)
        if not cfg:
            raise ValueError(f"未知的 LLM 后端: {backend_name}")

        api_key = cfg.get("api_key", "")
        if not api_key:
            raise ValueError(f"后端 {backend_name} 未配置 API Key")

        base_url = cfg.get("base_url", "https://api.openai.com/v1")

        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self.timeout,
        )
        self._clients[backend_name] = client
        return client

    def _try_chat(
        self,
        backend_name: str,
        messages: list,
        model: str = None,
        max_tokens: int = 1024,
        temperature: float = 0.8,
    ) -> str:
        """尝试调用单个后端"""
        cfg = self.backends.get(backend_name, {})
        model_name = model or cfg.get("model", "gpt-4o")
        client = self._get_client(backend_name)

        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=self.timeout,
        )
        return response.choices[0].message.content

    def chat(
        self,
        messages: list,
        backend: str = None,
        model: str = None,
        max_tokens: int = 1024,
        temperature: float = 0.8,
    ) -> str:
        """
        调用 LLM 生成回复（带重试和fallback）

        Args:
            messages: OpenAI 格式的消息列表
            backend: 后端名称，默认使用配置的默认后端
            model: 模型名称，默认使用后端配置的模型
            max_tokens: 最大生成 token 数
            temperature: 温度参数

        Returns:
            AI 回复文本
        """
        primary_backend = backend or self.default_backend

        # 构建尝试顺序：主后端 -> fallback后端
        backends_to_try = [primary_backend]
        for fb in self.fallback_backends:
            if fb != primary_backend and fb in self.backends:
                backends_to_try.append(fb)

        last_error = None

        for backend_name in backends_to_try:
            # 重试逻辑
            for attempt in range(self.max_retries + 1):
                try:
                    logger.info(f"🤖 LLM 调用: backend={backend_name}, attempt={attempt + 1}")
                    result = self._try_chat(backend_name, messages, model, max_tokens, temperature)
                    logger.info(f"✅ LLM 回复成功: {result[:50]}...")
                    return result

                except APITimeoutError as e:
                    last_error = e
                    logger.warning(f"⚠️ LLM 超时 (backend={backend_name}, attempt={attempt + 1}): {e}")
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay * (attempt + 1))  # 指数退避

                except APIConnectionError as e:
                    last_error = e
                    logger.warning(f"⚠️ LLM 连接失败 (backend={backend_name}, attempt={attempt + 1}): {e}")
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay * (attempt + 1))

                except RateLimitError as e:
                    last_error = e
                    logger.warning(f"⚠️ LLM 限流 (backend={backend_name}): {e}")
                    # 限流时直接尝试下一个后端
                    break

                except Exception as e:
                    last_error = e
                    logger.error(f"❌ LLM 调用失败 (backend={backend_name}): {e}")
                    # 其他错误直接尝试下一个后端
                    break

        # 所有后端都失败
        logger.error(f"❌ 所有 LLM 后端都失败: {last_error}")
        raise last_error

    def chat_stream(
        self,
        messages: list,
        backend: str = None,
        model: str = None,
        max_tokens: int = 1024,
        temperature: float = 0.8,
    ) -> Generator[str, None, None]:
        """
        流式调用 LLM

        Args:
            messages: OpenAI 格式的消息列表
            backend: 后端名称
            model: 模型名称
            max_tokens: 最大生成 token 数
            temperature: 温度参数

        Yields:
            AI 回复的文本片段
        """
        backend_name = backend or self.default_backend
        cfg = self.backends.get(backend_name, {})
        model_name = model or cfg.get("model", "gpt-4o")
        client = self._get_client(backend_name)

        try:
            stream = client.chat.completions.create(
                model=model_name,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
            )

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error(f"❌ LLM 流式调用失败: {e}")
            yield f"[错误: {str(e)}]"

    def get_available_backends(self) -> list:
        """获取所有已配置 API Key 的后端列表"""
        available = []
        for name, cfg in self.backends.items():
            if cfg.get("api_key"):
                available.append({
                    "name": name,
                    "model": cfg.get("model", ""),
                    "base_url": cfg.get("base_url", ""),
                })
        return available

    def health_check(self, backend_name: str = None) -> dict:
        """检查后端健康状态"""
        backend = backend_name or self.default_backend
        cfg = self.backends.get(backend, {})

        if not cfg.get("api_key"):
            return {"backend": backend, "status": "not_configured", "error": "未配置 API Key"}

        try:
            client = self._get_client(backend)
            # 发送一个简单的测试请求
            response = client.chat.completions.create(
                model=cfg.get("model", "gpt-4o"),
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5,
                timeout=10,
            )
            return {
                "backend": backend,
                "status": "healthy",
                "model": cfg.get("model"),
                "latency_ms": 0,  # 可以计算实际延迟
            }
        except Exception as e:
            return {
                "backend": backend,
                "status": "unhealthy",
                "error": str(e),
            }
