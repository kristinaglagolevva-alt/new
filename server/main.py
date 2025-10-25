from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_PATH = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_PATH / "templates.json"
DATA_PATH.mkdir(parents=True, exist_ok=True)


def load_templates() -> List[dict]:
    if not DATA_FILE.exists():
        DATA_FILE.write_text("[]", encoding="utf-8")
        return []
    try:
        raw_items = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("templates.json is corrupted") from exc
    normalized: List[dict] = []
    for item in raw_items:
        created_at = item.get("createdAt") or item.get("updatedAt") or current_timestamp()
        updated_at = item.get("updatedAt") or created_at
        normalized.append(
            {
                "id": item.get("id") or str(uuid.uuid4()),
                "name": item.get("name") or "Новый шаблон",
                "type": item.get("type") or "custom",
                "content": item.get("content") or "",
                "description": item.get("description"),
                "category": item.get("category"),
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )
    return normalized


def save_templates(templates: List[dict]) -> None:
    DATA_FILE.write_text(json.dumps(templates, ensure_ascii=False, indent=2), encoding="utf-8")


class TemplatePayload(BaseModel):
    name: str
    type: str
    content: str
    description: str | None = None
    category: str | None = None


class TemplateModel(TemplatePayload):
    id: str
    createdAt: str
    updatedAt: str


app = FastAPI(title="Template Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/templates", response_model=list[TemplateModel])
def list_templates() -> list[TemplateModel]:
    return [TemplateModel(**tpl) for tpl in load_templates()]


@app.post("/templates", response_model=TemplateModel, status_code=201)
def create_template(payload: TemplatePayload) -> TemplateModel:
    templates = load_templates()
    now = current_timestamp()
    new_template = TemplateModel(
        id=str(uuid.uuid4()),
        name=payload.name,
        type=payload.type,
        content=payload.content,
        description=payload.description,
        category=payload.category,
        createdAt=now,
        updatedAt=now,
    )
    templates.insert(0, new_template.dict())
    save_templates(templates)
    return new_template


@app.put("/templates/{template_id}", response_model=TemplateModel)
def update_template(template_id: str, payload: TemplatePayload) -> TemplateModel:
    templates = load_templates()
    for index, template in enumerate(templates):
        if template["id"] == template_id:
            created_at = template.get("createdAt") or template.get("updatedAt") or current_timestamp()
            updated = TemplateModel(
                id=template_id,
                name=payload.name,
                type=payload.type,
                content=payload.content,
                description=payload.description,
                category=payload.category,
                createdAt=created_at,
                updatedAt=current_timestamp(),
            )
            templates[index] = updated.dict()
            save_templates(templates)
            return updated
    raise HTTPException(status_code=404, detail="Template not found")


@app.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: str) -> Response:
    templates = load_templates()
    updated = [template for template in templates if template.get("id") != template_id]
    if len(updated) == len(templates):
        raise HTTPException(status_code=404, detail="Template not found")
    save_templates(updated)
    return Response(status_code=204)
