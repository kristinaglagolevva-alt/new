from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseSettings, Field


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = BASE_DIR / "data" / "app.db"


class Settings(BaseSettings):
    database_url: str = Field(
        default=f"sqlite:///{DEFAULT_SQLITE_PATH}",
        env="DATABASE_URL",
    )
    auth_secret_key: str = Field(
        default="change-me",
        env="AUTH_SECRET_KEY",
    )
    auth_access_token_expire_minutes: int = Field(
        default=60 * 24,
        env="AUTH_ACCESS_TOKEN_EXPIRE_MINUTES",
    )
    default_admin_email: str = Field(
        default="admin@example.com",
        env="DEFAULT_ADMIN_EMAIL",
    )
    default_admin_password: str = Field(
        default="admin123",
        env="DEFAULT_ADMIN_PASSWORD",
    )
    super_admin_email: str = Field(
        default="admin@example.com",
        env="SUPER_ADMIN_EMAIL",
    )

    class Config:
        env_file = BASE_DIR / ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


settings = Settings()
