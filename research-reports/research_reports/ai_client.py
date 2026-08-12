"""OpenAI-compatible SiliconFlow client for report generation."""

from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(frozen=True, slots=True)
class AICompletion:
    text: str
    model: str


class SiliconFlowClient:
    def __init__(self, *, http: httpx.Client, base_url: str, api_key: str, model: str, timeout: float = 45.0) -> None:
        self._http = http
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    def generate(self, *, system: str, user: str) -> AICompletion:
        if not self._api_key:
            raise RuntimeError("AI provider is not configured")
        response = self._http.post(
            f"{self._base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            json={"model": self._model, "temperature": 0.2, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            timeout=httpx.Timeout(self._timeout, connect=8.0),
        )
        if response.status_code >= 400:
            raise RuntimeError(f"AI provider returned HTTP {response.status_code}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RuntimeError("AI provider returned an invalid response") from exc
        return AICompletion(text=str(content), model=self._model)

    def list_models(self) -> list[str]:
        if not self._api_key:
            raise RuntimeError("AI provider is not configured")
        response = self._http.get(
            f"{self._base_url}/models",
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=httpx.Timeout(self._timeout, connect=8.0),
        )
        if response.status_code >= 400:
            raise RuntimeError(f"AI provider returned HTTP {response.status_code}")
        try:
            raw_models = response.json()["data"]
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("AI provider returned an invalid model catalog") from exc
        if not isinstance(raw_models, list):
            raise RuntimeError("AI provider returned an invalid model catalog")
        models: list[str] = []
        for item in raw_models:
            if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip():
                models.append(item["id"].strip())
        return models
