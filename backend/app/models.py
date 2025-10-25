from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, validator


class TemplateType(str, Enum):
    ACT = "act"
    INVOICE = "invoice"
    TIMESHEET = "timesheet"
    CUSTOM = "custom"


class TemplatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: TemplateType = TemplateType.CUSTOM
    content: str = Field(default="")
    description: Optional[str] = None

    @validator("description")
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:  # noqa: D417
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class TemplateModel(TemplatePayload):
    id: str = Field(..., min_length=8)
    updated_at: datetime = Field(default_factory=datetime.utcnow, alias="updatedAt")

    class Config:
        orm_mode = True
        allow_population_by_field_name = True
        json_encoders = {datetime: lambda dt: dt.isoformat()}


class TemplateInStorage(TemplatePayload):
    id: str
    updated_at: datetime
