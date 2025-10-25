# Backend Service

This directory contains the FastAPI backend that powers template storage for the Jira Integration Workflow project.

## Features

- CRUD endpoints for document templates (`/templates`).
- Workspace-based multi-tenancy: every request is scoped to the active workspace and persisted per tenant.
- Simple `/health` endpoint for uptime checks.
- File-based persistence (`backend/data/templates.json`).
- CORS enabled for local development with the Vite frontend.

## Getting Started

1. Create a virtual environment and install dependencies:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. (Optional) Configure the database connection. By default the app uses SQLite at `backend/data/app.db`. To use PostgreSQL export `DATABASE_URL`, for example:

   ```bash
   export DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/jira_integration"
   ```

3. Run the development server:

   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

   The frontend expects the API at `http://localhost:8000`. Override `VITE_API_BASE_URL` in `.env.local` if you run on a different host or port.

4. Persistent data lives in `data/templates.json`, `data/jira_connections.json`, and the database file (`data/app.db` when using SQLite). Commit them only if you need to share fixtures; otherwise add them to your personal `.gitignore`.

## Multi-Tenant Workspace Model

- Each administrator created without an explicit workspace context (for example, during bootstrap via `DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD`) automatically receives a dedicated tenant workspace.
- Оператор платформы (email из `SUPER_ADMIN_EMAIL`) выдаёт отдельные личные кабинеты через `/auth/register`. В запросе обязательно указывается режим: создать пустой кабинет (`workspace.mode = "new"`) или подключить существующий.
- Новые рабочие пространства создаются пустыми: никакие данные не копируются автоматически. Чтобы подтянуть «наследство» из старого single-tenant хранилища, есть явный `POST /workspaces/{workspaceId}/claim`.
- Authenticated administrators creating users through `/auth/register` must supply a workspace via the `X-Workspace-Id` header (or choose one explicitly). New members inherit workspace roles derived from their user role.
- Background services synchronize performers and managers by attaching them to the corresponding workspace before persisting related entities.
- ORM sessions enforce workspace scoping for all read/write operations, preventing accidental cross-tenant access.
- Владельцы рабочих пространств могут добавлять бухгалтеров и исполнителей только внутри своего контура через `POST /workspaces/{workspaceId}/users` (доступны роли `accountant`, `manager`, `performer`, `viewer`).
- Для обзора всей структуры доступен `GET /admin/workspaces` (только супер-админу).

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── orm_models.py
│   ├── schemas.py
│   ├── storage.py
│   └── services/
│       └── directory.py
├── data/
│   └── templates.json
│   └── jira_connections.json
├── requirements.txt
└── README.md
```

As the project grows, move reusable business logic into dedicated modules (services, repositories, etc.), and replace the JSON storage with a database-backed repository.
