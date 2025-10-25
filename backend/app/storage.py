from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Iterable, List

from .models import TemplateInStorage

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEMPLATES_FILE = DATA_DIR / "templates.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)


class TemplateStorageError(RuntimeError):
    """Base exception for storage-related errors."""


def _load_raw_templates() -> List[dict]:
    if not TEMPLATES_FILE.exists():
        TEMPLATES_FILE.write_text("[]", encoding="utf-8")
        return []
    try:
        return json.loads(TEMPLATES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise TemplateStorageError("templates.json is corrupted") from exc


def _dump_raw_templates(items: Iterable[dict]) -> None:
    payload = list(items)
    TEMPLATES_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def list_templates() -> list[TemplateInStorage]:
    raw = _load_raw_templates()
    templates = []
    for item in raw:
        updated_at = item.get("updatedAt") or item.get("updated_at")
        if isinstance(updated_at, str):
            updated_dt = datetime.fromisoformat(updated_at)
        else:
            updated_dt = datetime.utcnow()
        templates.append(
            TemplateInStorage(
                id=item["id"],
                name=item["name"],
                type=item["type"],
                content=item.get("content", ""),
                description=item.get("description"),
                updated_at=updated_dt,
            )
        )
    return templates


def save_templates(templates: Iterable[TemplateInStorage]) -> None:
    _dump_raw_templates(template.dict() for template in templates)


def get_template(template_id: str) -> TemplateInStorage | None:
    for template in list_templates():
        if template.id == template_id:
            return template
    return None
