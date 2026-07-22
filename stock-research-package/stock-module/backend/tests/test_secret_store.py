import json
from pathlib import Path

from cryptography.fernet import Fernet

from app.domain.model_profiles import ModelProfileCreate, ModelProfileUpdate
from app.repositories.model_profiles import ModelProfileRepository
from app.security.secrets import FernetSecretStore
from app.services.model_profiles import ModelProfileService


def _build_service(tmp_path: Path) -> tuple[ModelProfileRepository, FernetSecretStore, ModelProfileService]:
    repository = ModelProfileRepository(tmp_path / "hub.db")
    secrets = FernetSecretStore(repository, Fernet.generate_key().decode("ascii"))
    service = ModelProfileService(repository, secrets, owner_id="local")
    return repository, secrets, service


def test_saved_key_is_encrypted_and_never_returned(tmp_path: Path) -> None:
    repository, secrets, service = _build_service(tmp_path)

    profile = service.create(
        ModelProfileCreate.siliconflow(name="硅基流动", api_key="secret-value")
    )

    assert profile.key_configured is True
    assert "secret-value" not in json.dumps(profile.model_dump(mode="json"), ensure_ascii=False)
    assert repository.read_secret_ciphertext(profile.id) != b"secret-value"
    assert secrets.get(profile.id) == "secret-value"


def test_metadata_update_does_not_clear_existing_key(tmp_path: Path) -> None:
    _, secrets, service = _build_service(tmp_path)
    profile = service.create(
        ModelProfileCreate.siliconflow(name="旧名称", api_key="original-key")
    )

    updated = service.update(profile.id, ModelProfileUpdate(name="新名称"))

    assert updated.name == "新名称"
    assert secrets.get(profile.id) == "original-key"


def test_key_replacement_changes_ciphertext(tmp_path: Path) -> None:
    repository, secrets, service = _build_service(tmp_path)
    profile = service.create(
        ModelProfileCreate.siliconflow(name="硅基流动", api_key="old-key")
    )
    before = repository.read_secret_ciphertext(profile.id)

    service.update(profile.id, ModelProfileUpdate(api_key="replacement-key"))

    assert repository.read_secret_ciphertext(profile.id) != before
    assert secrets.get(profile.id) == "replacement-key"


def test_delete_removes_profile_secret_and_catalog(tmp_path: Path) -> None:
    repository, secrets, service = _build_service(tmp_path)
    profile = service.create(
        ModelProfileCreate.siliconflow(name="硅基流动", api_key="secret-value")
    )
    repository.save_catalog(profile.id, ["model-a"], ttl_seconds=900)

    service.delete(profile.id)

    assert repository.get_profile(profile.id, owner_id="local") is None
    assert repository.read_secret_ciphertext(profile.id) is None
    assert repository.get_catalog(profile.id) is None
