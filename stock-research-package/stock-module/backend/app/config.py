"""Environment-backed configuration for local and hosted stock modules."""

import base64
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import secrets

from app.domain.model_profiles import PlatformModelProfileConfig
from app.integrations.candidate_workers import WorkerCommand


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    catalyst_report_path: Path
    user_strategy_snapshot_path: Path
    worker_commands: tuple[WorkerCommand, ...] = ()
    environment: str = "development"
    model_master_key: str = field(default="", repr=False)
    platform_model_profiles: tuple[PlatformModelProfileConfig, ...] = ()
    analysis_service_url: str = "http://127.0.0.1:8003"
    gateway_internal_url: str = "http://127.0.0.1:8004/v1"
    gateway_service_token: str = field(default="", repr=False)
    route_signing_key: str = field(default="", repr=False)
    site_auth_url: str = "http://127.0.0.1:8000"
    site_auth_internal_key: str = field(default="", repr=False)
    allow_private_model_endpoints: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        module_root = Path(__file__).resolve().parents[2]
        data_dir = Path(os.environ.get("STOCK_DATA_DIR", module_root / "data"))
        environment = os.environ.get("STOCK_ENV", "development").strip().lower() or "development"
        model_master_key = os.environ.get("STOCK_MODEL_MASTER_KEY", "").strip()
        gateway_service_token = os.environ.get("STOCK_GATEWAY_SERVICE_TOKEN", "").strip()
        route_signing_key = os.environ.get("STOCK_ROUTE_SIGNING_KEY", "").strip()
        site_auth_internal_key = os.environ.get("SITE_AUTH_INTERNAL_KEY", "").strip()
        if environment == "production":
            for variable, value in (
                ("STOCK_MODEL_MASTER_KEY", model_master_key),
                ("STOCK_GATEWAY_SERVICE_TOKEN", gateway_service_token),
                ("STOCK_ROUTE_SIGNING_KEY", route_signing_key),
                ("SITE_AUTH_INTERNAL_KEY", site_auth_internal_key),
            ):
                if not value:
                    raise ValueError(f"production requires {variable}")
        else:
            secret_dir = data_dir / "secrets"
            model_master_key = model_master_key or _load_or_create_secret(
                secret_dir / "model-master.key",
                fernet_compatible=True,
            )
            gateway_service_token = gateway_service_token or _load_or_create_secret(
                secret_dir / "gateway-service.token"
            )
            route_signing_key = route_signing_key or _load_or_create_secret(
                secret_dir / "route-signing.key"
            )
        platform_model_profiles = _platform_profiles_from_env()
        commands = tuple(
            command
            for command in (
                _worker_command_from_env(
                    "CATALYST_WORKER_COMMAND_JSON",
                    "catalyst",
                    "九点猫研",
                    module_root.parent / "upstreams" / "a-share-us-catalyst",
                ),
                _worker_command_from_env(
                    "USER_STRATEGY_WORKER_COMMAND_JSON",
                    "user_strategy",
                    "用户策略",
                    module_root / "backend",
                ),
            )
            if command is not None
        )
        return cls(
            data_dir=data_dir,
            catalyst_report_path=Path(
                os.environ.get(
                    "CATALYST_REPORT_PATH",
                    module_root.parent / "upstreams" / "a-share-us-catalyst" / "dist" / "data" / "report.json",
                )
            ),
            user_strategy_snapshot_path=Path(
                os.environ.get(
                    "USER_STRATEGY_SNAPSHOT_PATH",
                    data_dir / "user-strategy" / "latest.json",
                )
            ),
            worker_commands=commands,
            environment=environment,
            model_master_key=model_master_key,
            platform_model_profiles=platform_model_profiles,
            analysis_service_url=os.environ.get(
                "STOCK_ANALYSIS_SERVICE_URL", "http://127.0.0.1:8003"
            ).rstrip("/"),
            gateway_internal_url=os.environ.get(
                "STOCK_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8004/v1"
            ).rstrip("/"),
            gateway_service_token=gateway_service_token,
            route_signing_key=route_signing_key,
            site_auth_url=os.environ.get(
                "SITE_AUTH_URL", "http://127.0.0.1:8000"
            ).rstrip("/"),
            site_auth_internal_key=site_auth_internal_key,
            allow_private_model_endpoints=(
                environment != "production"
                and os.environ.get("STOCK_ALLOW_PRIVATE_MODEL_ENDPOINTS", "").strip().lower()
                in {"1", "true", "yes", "on"}
            ),
        )


def _platform_profiles_from_env() -> tuple[PlatformModelProfileConfig, ...]:
    encoded = os.environ.get("STOCK_PLATFORM_MODEL_PROFILES_JSON", "").strip()
    if not encoded:
        return ()
    try:
        raw = json.loads(encoded)
    except json.JSONDecodeError as exc:
        raise ValueError("STOCK_PLATFORM_MODEL_PROFILES_JSON must be valid JSON") from exc
    if not isinstance(raw, list):
        raise ValueError("STOCK_PLATFORM_MODEL_PROFILES_JSON must be a JSON array")
    return tuple(PlatformModelProfileConfig.model_validate(item) for item in raw)


def _load_or_create_secret(path: Path, *, fernet_compatible: bool = False) -> str:
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    path.parent.mkdir(parents=True, exist_ok=True)
    value = (
        base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
        if fernet_compatible
        else secrets.token_urlsafe(32)
    )
    path.write_text(value, encoding="utf-8")
    return value


def _worker_command_from_env(
    variable: str,
    source_id: str,
    source_name: str,
    default_cwd: Path,
) -> WorkerCommand | None:
    encoded = os.environ.get(variable)
    if not encoded:
        return None
    try:
        raw = json.loads(encoded)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{variable} 必须是 JSON 对象") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("args"), list):
        raise ValueError(f"{variable} 的 args 必须是参数数组")
    return WorkerCommand(
        source_id=source_id,
        source_name=source_name,
        args=raw["args"],
        cwd=Path(raw.get("cwd", default_cwd)),
        timeout_seconds=raw.get("timeout_seconds", 900),
        env=raw.get("env", {}),
    )
