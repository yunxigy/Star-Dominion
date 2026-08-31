from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.context_builder import ContextBuilder
from tools.llm.client import LLMConfig
from tools.model_profiles import (
    ModelProfileError,
    ModelProfileStore,
    activate_model_profile,
)
from tools.studio_preferences import StudioModelSettingsStore


def profile(profile_id: str, model: str, *, context_tokens: int = 64000) -> dict:
    return {
        "id": profile_id,
        "label": profile_id.title(),
        "provider": "openai",
        "base_url": "https://models.example/v1",
        "model": model,
        "api_format": "chat",
        "context_tokens": context_tokens,
        "max_output_tokens": 4096,
        "temperature": 0,
        "timeout_seconds": 45,
    }


def test_legacy_single_model_maps_to_default_without_exposing_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    legacy = StudioModelSettingsStore(tmp_path)
    legacy.save_settings(
        {
            "provider": "openai",
            "base_url": "https://legacy.example/v1",
            "model": "legacy-prose",
            "api_format": "chat",
            "context_tokens": 32000,
            "max_tokens": 2048,
        }
    )
    legacy.save_credential("legacy-secret")

    surface = ModelProfileStore(tmp_path).surface()

    assert surface["legacy_mapped"] is True
    assert surface["profiles"][0]["id"] == "default"
    assert surface["profiles"][0]["model"] == "legacy-prose"
    assert surface["profiles"][0]["configured"] is True
    assert "legacy-secret" not in json.dumps(surface, ensure_ascii=False)


def test_three_named_profiles_route_independently_and_keep_credentials_private(tmp_path: Path):
    store = ModelProfileStore(tmp_path)
    store.save_profile(profile("balanced", "planner"), api_key="plan-secret")
    store.save_profile(profile("prose", "writer"), api_key="write-secret")
    store.save_profile(profile("critic", "reviewer"), api_key="review-secret")
    store.save_routes(
        {
            "goethe": "balanced",
            "dante": "prose",
            "chapter_write": "prose",
            "review": "critic",
            "research": "balanced",
        }
    )

    assert store.resolve("goethe")["model"] == "planner"
    assert store.resolve("chapter_write")["api_key"] == "write-secret"
    assert store.resolve("review")["model"] == "reviewer"
    assert store.resolve("research")["model"] == "planner"
    surface_text = json.dumps(store.surface(), ensure_ascii=False)
    assert "plan-secret" not in surface_text
    assert "write-secret" not in surface_text
    assert "review-secret" not in surface_text


def test_search_profile_keeps_embedding_credentials_private(tmp_path: Path):
    store = ModelProfileStore(tmp_path)
    search_profile = {
        **profile("search", "graph-extractor"),
        "embedding_base_url": "https://embeddings.example/v1",
        "embedding_model": "text-embedding-3-large",
        "embedding_dimension": 3072,
        "embedding_max_tokens": 8192,
    }
    store.save_profile(
        search_profile,
        api_key="llm-secret",
        embedding_api_key="embedding-secret",
    )
    store.save_routes({"search": "search"})

    resolved = store.resolve("search")
    surface_text = json.dumps(store.surface(), ensure_ascii=False)

    assert resolved["embedding_api_key"] == "embedding-secret"
    assert resolved["embedding_model"] == "text-embedding-3-large"
    assert resolved["embedding_dimension"] == 3072
    assert "llm-secret" not in surface_text
    assert "embedding-secret" not in surface_text


def test_local_embedding_profile_is_ready_without_embedding_credentials(tmp_path: Path):
    store = ModelProfileStore(tmp_path)
    local_profile = {
        **profile("local-search", "graph-extractor"),
        "embedding_provider": "local",
        "embedding_model": "BAAI/bge-small-zh-v1.5",
        "embedding_dimension": 512,
        "embedding_max_tokens": 512,
    }
    store.save_profile(local_profile, api_key="llm-secret")

    surface = store.surface()["profiles"][0]
    candidate = store.test_embedding_candidate(local_profile)

    assert surface["embedding_configured"] is True
    assert surface["embedding_key_configured"] is False
    assert candidate["embedding_provider"] == "local"
    assert candidate["embedding_api_key"] == ""


def test_vector_search_profile_resolves_without_chat_credentials(tmp_path: Path):
    store = ModelProfileStore(tmp_path)
    local_profile = {
        **profile("local-search", "unused-in-vector-mode"),
        "embedding_provider": "local",
        "embedding_model": "BAAI/bge-small-zh-v1.5",
        "embedding_dimension": 512,
        "embedding_max_tokens": 512,
        "search_mode": "vector",
    }
    store.save_profile(local_profile)
    store.save_routes({"search": "local-search"})

    resolved = store.resolve("search")

    assert resolved["api_key"] == ""
    assert resolved["embedding_provider"] == "local"
    store.save_profile({**local_profile, "search_mode": "graph"})
    with pytest.raises(ModelProfileError) as error:
        store.resolve("search")
    assert error.value.code == "MODEL_CREDENTIAL_MISSING"


def test_session_only_credential_is_not_written_to_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    store = ModelProfileStore(tmp_path)
    store.save_profile(
        profile("temporary", "session-model"),
        api_key="session-secret",
        remember_api_key=False,
    )

    assert store.resolve("goethe")["api_key"] == "session-secret"
    assert "session-secret" not in store.credentials_path.read_text(encoding="utf-8")


def test_disabling_credential_persistence_clears_an_existing_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    store = ModelProfileStore(tmp_path)
    store.save_profile(profile("prose", "writer"), api_key="persisted-secret")
    store.save_profile(profile("prose", "writer"), remember_api_key=False)

    assert store.surface()["profiles"][0]["configured"] is False
    assert store.credentials_path.read_text(encoding="utf-8").strip() == "{}"


def test_delete_profile_in_use_requires_and_applies_fallback(tmp_path: Path):
    store = ModelProfileStore(tmp_path)
    store.save_profile(profile("prose", "writer"), api_key="one")
    store.save_profile(profile("fallback", "backup"), api_key="two")
    store.save_routes({"chapter_write": "prose", "dante": "prose"})

    with pytest.raises(ModelProfileError) as error:
        store.delete_profile("prose")
    assert error.value.code == "MODEL_PROFILE_IN_USE"

    result = store.delete_profile("prose", fallback_id="fallback")
    assert result["routes"]["chapter_write"] == "fallback"
    assert result["routes"]["dante"] == "fallback"


def test_active_profile_drives_llm_config_and_context_budget(tmp_path: Path):
    active = {
        **profile("prose", "writer-large", context_tokens=128000),
        "api_key": "active-secret",
    }

    with activate_model_profile(active):
        config = LLMConfig.from_env()
        builder = ContextBuilder(tmp_path, "demo")

    assert config.model == "writer-large"
    assert config.api_key == "active-secret"
    assert config.temperature == 0
    assert config.max_tokens == 4096
    assert config.context_tokens == 128000
    assert builder.CONTEXT_WINDOW_TOKENS == 128000
    assert builder.MAX_OUTPUT_TOKENS == 4096
    assert builder.MAX_TOKENS == 120064


@pytest.mark.parametrize(
    ("context_tokens", "max_output_tokens"),
    (
        (1_050_000, 128_000),
        (2_000_000, 131_072),
        (10_000_000, 32_768),
        (1_000_000, 384_000),
        (2_000_000, 750_000),
    ),
)
def test_long_context_profiles_are_valid_and_drive_context_budget(
    tmp_path: Path,
    context_tokens: int,
    max_output_tokens: int,
):
    store = ModelProfileStore(tmp_path)
    saved = store.save_profile(
        {
            **profile("long-context", "long-context-model"),
            "context_tokens": context_tokens,
            "max_output_tokens": max_output_tokens,
        },
        api_key="long-context-secret",
    )

    with activate_model_profile(saved):
        builder = ContextBuilder(tmp_path, "demo")

    assert saved["context_tokens"] == context_tokens
    assert saved["max_output_tokens"] == max_output_tokens
    assert builder.CONTEXT_WINDOW_TOKENS == context_tokens
    assert builder.MAX_OUTPUT_TOKENS == max_output_tokens
    assert builder.MAX_TOKENS < context_tokens
    assert builder.MAX_TOKENS > context_tokens // 2


def test_model_profile_rejects_output_that_leaves_no_input_budget(tmp_path: Path):
    store = ModelProfileStore(tmp_path)

    with pytest.raises(ModelProfileError, match="最大输出必须小于上下文预算"):
        store.save_profile(
            {
                **profile("invalid-output", "custom-model"),
                "context_tokens": 500_000,
                "max_output_tokens": 500_000,
            }
        )


def test_legacy_budget_mismatch_does_not_block_loading_or_saving_profiles(tmp_path: Path):
    legacy_default = {
        **profile("default", "legacy-model"),
        "context_tokens": 64000,
        "max_output_tokens": 131072,
    }
    (tmp_path / "model-profiles.json").write_text(
        json.dumps(
            {
                "version": 1,
                "default_profile_id": "default",
                "profiles": [legacy_default],
                "routes": {"chapter_write": "default"},
            }
        ),
        encoding="utf-8",
    )

    store = ModelProfileStore(tmp_path)

    surface = store.surface()
    repaired = surface["profiles"][0]
    assert repaired["context_tokens"] == 64000
    assert repaired["max_output_tokens"] < repaired["context_tokens"]

    saved = store.save_profile(
        {
            **profile("niulai", "x-preview-f-free", context_tokens=324000),
            "max_output_tokens": 128000,
        }
    )

    assert saved["context_tokens"] == 324000
    persisted = json.loads((tmp_path / "model-profiles.json").read_text(encoding="utf-8"))
    persisted_default = next(item for item in persisted["profiles"] if item["id"] == "default")
    assert persisted_default["max_output_tokens"] < persisted_default["context_tokens"]


def test_model_profile_surface_exposes_presets_without_credentials(tmp_path: Path):
    store = ModelProfileStore(tmp_path)
    store.save_profile(profile("prose", "writer"), api_key="private-secret")

    surface = store.surface()
    serialized = json.dumps(surface, ensure_ascii=False)

    assert len(surface["presets"]) >= 20
    assert "openai-gpt-5.6-sol" in {preset["id"] for preset in surface["presets"]}
    assert "xiaomi-mimo-v2.5-pro" in {preset["id"] for preset in surface["presets"]}
    assert "private-secret" not in serialized
    assert all("api_key" not in preset for preset in surface["presets"])


def test_unknown_route_and_last_profile_deletion_are_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    store = ModelProfileStore(tmp_path)
    store.save_profile(profile("only", "single"), api_key="one")

    with pytest.raises(ModelProfileError) as route_error:
        store.resolve("unknown")
    assert route_error.value.code == "INVALID_MODEL_ROUTE"

    with pytest.raises(ModelProfileError) as delete_error:
        store.delete_profile("only")
    assert delete_error.value.code == "MODEL_PROFILE_LAST_PROFILE"
