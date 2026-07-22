import json
from pathlib import Path

import pytest

from app.config import Settings
from app.domain.model_profiles import ModelProfileCreate


def test_siliconflow_preset_has_no_default_model() -> None:
    preset = ModelProfileCreate.siliconflow(name="我的硅基流动", api_key="secret")

    assert str(preset.base_url) == "https://api.siliconflow.cn/v1"
    assert preset.provider == "siliconflow"
    assert not hasattr(preset, "default_model")


def test_production_requires_model_master_key(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("STOCK_ENV", "production")
    monkeypatch.setenv("STOCK_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("STOCK_MODEL_MASTER_KEY", raising=False)

    with pytest.raises(ValueError, match="STOCK_MODEL_MASTER_KEY"):
        Settings.from_env()


def test_platform_profiles_reference_key_environment_without_reading_it_into_public_metadata(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("STOCK_ENV", "development")
    monkeypatch.setenv("STOCK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STOCK_SILICONFLOW_API_KEY", "platform-secret")
    monkeypatch.setenv(
        "STOCK_PLATFORM_MODEL_PROFILES_JSON",
        json.dumps(
            [
                {
                    "id": "platform-sf",
                    "name": "平台硅基流动",
                    "provider": "siliconflow",
                    "base_url": "https://api.siliconflow.cn/v1",
                    "api_key_env": "STOCK_SILICONFLOW_API_KEY",
                }
            ]
        ),
    )

    settings = Settings.from_env()

    assert len(settings.platform_model_profiles) == 1
    profile = settings.platform_model_profiles[0]
    assert profile.id == "platform-sf"
    assert profile.api_key_env == "STOCK_SILICONFLOW_API_KEY"
    assert "platform-secret" not in repr(profile)
