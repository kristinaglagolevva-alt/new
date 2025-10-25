from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Tuple, Optional
import re

import httpx


def _adf_to_text(node) -> str:
    """Convert Jira ADF documents to plain text (best effort)."""
    if not node:
        return ""
    if isinstance(node, str):
        return node

    parts: list[str] = []

    def walk(current) -> None:
        if current is None:
            return
        if isinstance(current, str):
            parts.append(current)
            return
        if isinstance(current, dict):
            node_type = current.get("type")
            if node_type == "text":
                parts.append(current.get("text", ""))
                return
            for child in current.get("content") or []:
                walk(child)
            if node_type in {"paragraph", "heading", "listItem"}:
                parts.append("\n")
            return
        if isinstance(current, list):
            for item in current:
                walk(item)

    walk(node)
    text = "".join(parts)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


class JiraError(RuntimeError):
    """Raised for unexpected Jira API responses."""


@dataclass
class JiraProject:
    id: str
    key: str
    name: str


@dataclass
class JiraIssue:
    id: str
    key: str
    summary: str
    status: str
    project_key: str
    project_name: str
    time_spent_seconds: int | None
    time_estimate_seconds: int | None
    assignee_account_id: str | None
    assignee_display_name: str | None
    assignee_email: str | None
    updated_at: datetime | None
    description: Optional[str]


_ATLASSIAN_NET_RE = re.compile(r"\.atlassian\.net$", re.IGNORECASE)


class JiraClient:
    """Thin wrapper around Jira REST API with cloud/self-host adaptation."""

    def __init__(self, base_url: str, email: str, api_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.email = email.strip()
        self.api_token = api_token.strip()

        hostname = self.base_url.split("//")[-1]
        self._is_cloud = bool(_ATLASSIAN_NET_RE.search(hostname))

        self._client: httpx.Client
        self._bearer_client: httpx.Client | None = None
        self._basic_client: httpx.Client | None = None

        if self._is_cloud:
            self._client = httpx.Client(
                base_url=self.base_url,
                auth=(self.email, self.api_token),
                headers={"Accept": "application/json"},
                timeout=20.0,
            )
        else:
            # Primary attempt — Bearer token (как у ребят).
            headers = {"Accept": "application/json"}
            bearer = self._build_bearer_header()
            if bearer:
                headers["Authorization"] = bearer
            self._bearer_client = httpx.Client(
                base_url=self.base_url,
                headers=headers,
                timeout=20.0,
            )
            # Fallback — basic auth (как в официальной версии).
            if self.email and self.api_token:
                self._basic_client = httpx.Client(
                    base_url=self.base_url,
                    auth=(self.email, self.api_token),
                    headers={"Accept": "application/json"},
                    timeout=20.0,
                )
            # Default client just reuses bearer (если есть) либо без авторизации.
            self._client = self._bearer_client or httpx.Client(
                base_url=self.base_url,
                headers={"Accept": "application/json"},
                timeout=20.0,
            )

    def _build_bearer_header(self) -> str | None:
        if not self.api_token:
            return None
        token = self.api_token.strip()
        if not token:
            return None
        if token.lower().startswith("bearer "):
            return token
        return f"Bearer {token}"

    def close(self) -> None:
        self._client.close()
        if self._bearer_client and self._bearer_client is not self._client:
            self._bearer_client.close()
        if self._basic_client and self._basic_client is not self._client:
            self._basic_client.close()

    def __enter__(self) -> "JiraClient":  # pragma: no cover
        return self

    def __exit__(self, *exc_info) -> None:  # pragma: no cover
        self.close()

    def fetch_projects(self, max_results: int = 200) -> List[JiraProject]:
        endpoints = [
            ("/rest/api/3/project/search", {"maxResults": str(max_results)}),
            ("/rest/api/3/project", None),
            ("/rest/api/2/project", None),
            ("/rest/api/3/project/search", {"maxResults": str(max_results), "expand": "insight"}),
        ]
        if not self._is_cloud:
            endpoints.append(("/rest/api/latest/project", None))

        last_error: Exception | None = None

        for path, params in endpoints:
            try:
                response = self._request("GET", path, params=params)
                if response.status_code == 401:
                    raise JiraError("Не удалось авторизоваться в Jira. Проверьте логин и токен.")
                if response.status_code in {404, 410}:
                    continue
                if response.status_code >= 400:
                    raise JiraError(f"Jira API error: {response.status_code}")

                data = response.json()
                if isinstance(data, dict) and "values" in data:
                    items = data.get("values") or []
                elif isinstance(data, list):
                    items = data
                else:
                    items = []

                projects: List[JiraProject] = []
                for item in items:
                    projects.append(
                        JiraProject(
                            id=str(item.get("id")),
                            key=item.get("key", item.get("projectKey", "")),
                            name=item.get("name")
                            or item.get("displayName")
                            or item.get("projectName")
                            or item.get("key", "Unnamed"),
                        )
                    )

                if projects:
                    return projects
            except JiraError as exc:  # pragma: no cover - depends on Jira config
                last_error = exc
            except Exception as exc:  # pragma: no cover - network/JSON issues
                last_error = JiraError(str(exc))

        if last_error:
            raise last_error

        return []

    def fetch_issues(
        self,
        project_key: str,
        max_results: int = 100,
        updated_since: str | None = None,
    ) -> Tuple[List[JiraIssue], dict]:
        page_size = max(1, max_results or 1)
        base_jql = f'project = "{project_key}"'
        if updated_since:
            base_jql += f' AND updated >= "{updated_since}"'
        jql = f"{base_jql} ORDER BY updated DESC"

        endpoints = ["/rest/api/3/search"]
        if not self._is_cloud:
            endpoints.extend((
                "/rest/api/2/search",
                "/rest/api/latest/search",
            ))

        last_error: JiraError | None = None

        for path in endpoints:
            try:
                issues: List[JiraIssue] = []
                project_meta: dict = {}
                start_at = 0

                while True:
                    params = {
                        "jql": jql,
                        "maxResults": str(page_size),
                        "startAt": str(start_at),
                        "fields": "summary,status,project,timespent,assignee,updated,timeoriginalestimate,aggregatetimeoriginalestimate,aggregatetimespent,description",
                    }

                    response = self._request("GET", path, params=params)
                    if response.status_code == 401:
                        raise JiraError("Не удалось авторизоваться при загрузке задач.")
                    if response.status_code >= 400:
                        raise JiraError(f"Jira API error: {response.status_code}")

                    try:
                        data = response.json()
                    except ValueError as exc:
                        raise JiraError(f"Некорректный ответ Jira ({path}): {exc}") from exc

                    issues_data = data.get("issues") or []
                    if not issues_data:
                        break

                    for item in issues_data:
                        fields = item.get("fields", {})
                        project = fields.get("project") or {}
                        project_meta = {
                            "id": project.get("id"),
                            "key": project.get("key", project_key),
                            "name": project.get("name", project_key),
                        }
                        assignee = fields.get("assignee") or {}
                        updated_raw = fields.get("updated")
                        try:
                            updated_dt = datetime.fromisoformat(updated_raw.replace("Z", "+00:00")) if updated_raw else None
                        except Exception:  # pragma: no cover
                            updated_dt = None

                        raw_description = fields.get("description")
                        try:
                            description_text = _adf_to_text(raw_description)
                        except Exception:
                            description_text = None

                        issues.append(
                            JiraIssue(
                                id=str(item.get("id")),
                                key=item.get("key", ""),
                                summary=fields.get("summary", ""),
                                status=(fields.get("status") or {}).get("name", ""),
                                project_key=project_meta.get("key", project_key),
                                project_name=project_meta.get("name", project_key),
                                time_spent_seconds=fields.get("timespent") or fields.get("aggregatetimespent"),
                                time_estimate_seconds=fields.get("timeoriginalestimate")
                                or fields.get("aggregatetimeoriginalestimate"),
                                assignee_account_id=assignee.get("accountId"),
                                assignee_display_name=assignee.get("displayName"),
                                assignee_email=assignee.get("emailAddress"),
                                updated_at=updated_dt,
                                description=description_text,
                            )
                        )

                    start_at += len(issues_data)
                    total = data.get("total")
                    if total is not None and start_at >= int(total):
                        break
                    if len(issues_data) < page_size:
                        break

                if issues:
                    return issues, project_meta
            except JiraError as exc:  # pragma: no cover - depends on Jira config
                last_error = exc
            except Exception as exc:  # pragma: no cover - network/JSON issues
                last_error = JiraError(str(exc))

        if last_error:
            raise last_error

        return [], {}

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        if self._is_cloud:
            return self._client.request(method, path, **kwargs)

        attempts: List[httpx.Client] = []
        seen = set()
        if self._bearer_client:
            attempts.append(self._bearer_client)
            seen.add(id(self._bearer_client))
        if self._basic_client and id(self._basic_client) not in seen:
            attempts.append(self._basic_client)
            seen.add(id(self._basic_client))
        if id(self._client) not in seen:
            attempts.append(self._client)

        last_exception: Exception | None = None
        last_response: httpx.Response | None = None
        for client in attempts:
            try:
                response = client.request(method, path, **kwargs)
            except Exception as exc:  # pragma: no cover - network issues
                last_exception = exc
                continue
            last_response = response
            if response.status_code == 401:
                continue
            return response

        if last_response is not None:
            return last_response
        if last_exception is not None:
            raise JiraError(str(last_exception))
        raise JiraError("Не удалось выполнить запрос к Jira")
