"""Public request and response contracts."""

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class LoginRequest(BaseModel):
    identity: str = Field(min_length=1, max_length=255)
    password: SecretStr


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    username: str
    role: str
