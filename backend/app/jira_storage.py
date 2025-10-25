from __future__ import annotations

import base64
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONNECTIONS_FILE = DATA_DIR / "jira_connections.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_base_url(base_url: str) -> str:
    normalized = base_url.rstrip('/')
    lowered = normalized.lower()
    for suffix in ("/rest/api/3", "/rest/api/2", "/rest/api/latest", "/rest"):
        if lowered.endswith(suffix):
            normalized = normalized[: -len(suffix)]
            lowered = normalized.lower()
            break
    return normalized.lower()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@dataclass
class JiraProjectRecord:
    id: str
    key: str
    name: str
    status: str = "discovered"
    last_sync: Optional[str] = None
    tasks_count: int = 0


@dataclass
class JiraConnectionRecord:
    id: str
    base_url: str
    email: str
    token_b64: str
    created_at: str
    workspace_id: Optional[str] = None
    projects: List[JiraProjectRecord] = field(default_factory=list)

    def sanitized(self) -> dict:
        data = asdict(self)
        data.pop("token_b64", None)
        return data


def _load_raw_connections() -> List[dict]:
    if not CONNECTIONS_FILE.exists():
        CONNECTIONS_FILE.write_text("[]", encoding="utf-8")
        return []
    try:
        return json.loads(CONNECTIONS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise RuntimeError("jira_connections.json is corrupted") from exc


def _dump_raw_connections(items: Iterable[dict]) -> None:
    payload = list(items)
    CONNECTIONS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_connections() -> List[JiraConnectionRecord]:
    raw = _load_raw_connections()
    connections: List[JiraConnectionRecord] = []
    for item in raw:
        projects = [JiraProjectRecord(**project) for project in item.get("projects", [])]
        connections.append(
            JiraConnectionRecord(
                id=item["id"],
                base_url=item["base_url"],
                email=item["email"],
                token_b64=item["token_b64"],
                created_at=item.get("created_at") or datetime.utcnow().isoformat(),
                workspace_id=item.get("workspace_id"),
                projects=projects,
            )
        )
    return connections


def save_connections(connections: Iterable[JiraConnectionRecord]) -> None:
    _dump_raw_connections(asdict(connection) for connection in connections)


def upsert_connection(connection: JiraConnectionRecord) -> JiraConnectionRecord:
    connections = list_connections()
    updated = False
    for index, existing in enumerate(connections):
        if existing.id == connection.id:
            connections[index] = connection
            updated = True
            break
    if not updated:
        connections.append(connection)
    save_connections(connections)
    return connection


def store_connection(
    connection_id: str,
    base_url: str,
    email: str,
    api_token: str,
    workspace_id: str,
    projects: List[JiraProjectRecord],
) -> JiraConnectionRecord:
    normalized_url = _normalize_base_url(base_url)
    normalized_email = _normalize_email(email)
    token_b64 = base64.b64encode(api_token.encode("utf-8")).decode("utf-8")
    record = JiraConnectionRecord(
        id=connection_id,
        base_url=normalized_url,
        email=normalized_email,
        token_b64=token_b64,
        created_at=datetime.utcnow().isoformat(),
        workspace_id=workspace_id,
        projects=projects,
    )
    connections = list_connections()
    # Remove any existing connection with same base_url + email to avoid duplicates
    connections = [
        item
        for item in connections
        if not (_normalize_base_url(item.base_url) == normalized_url and _normalize_email(item.email) == normalized_email)
    ]
    connections.append(record)
    save_connections(connections)
    return record


def get_connection(connection_id: str) -> Optional[JiraConnectionRecord]:
    for connection in list_connections():
        if connection.id == connection_id:
            return connection
    return None


def find_connection_by_credentials(base_url: str, email: str) -> Optional[JiraConnectionRecord]:
    normalized_url = _normalize_base_url(base_url)
    normalized_email = _normalize_email(email)
    for connection in list_connections():
        if (
            _normalize_base_url(connection.base_url) == normalized_url
            and _normalize_email(connection.email) == normalized_email
        ):
            return connection
    return None


def deduplicate_connections() -> None:
    connections = list_connections()
    seen: dict[tuple[str, str], JiraConnectionRecord] = {}
    for connection in connections:
        key = (
            _normalize_base_url(connection.base_url),
            _normalize_email(connection.email),
        )
        if key not in seen:
            seen[key] = connection
    if len(seen) != len(connections):
        save_connections(seen.values())


def update_project_status(connection_id: str, project_key: str, status: str, tasks_count: int) -> Optional[JiraConnectionRecord]:
    connections = list_connections()
    for index, connection in enumerate(connections):
        if connection.id == connection_id:
            for project in connection.projects:
                if project.key == project_key:
                    project.status = status
                    project.tasks_count = tasks_count
                    project.last_sync = datetime.utcnow().isoformat()
                    break
            connections[index] = connection
            save_connections(connections)
            return connection
    return None


def decode_token(connection: JiraConnectionRecord) -> str:
    return base64.b64decode(connection.token_b64.encode("utf-8")).decode("utf-8")
