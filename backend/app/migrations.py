from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import text
from sqlalchemy.engine import Engine

from .jira_storage import deduplicate_connections


DEFAULT_WORKSPACE_ID = "workspace-default"
DEFAULT_WORKSPACE_KEY = "aktex"
DEFAULT_WORKSPACE_NAME = "Aktex"
DEFAULT_WORKSPACE_COLOR = "#111827"


def _column_exists(engine: Engine, table: str, column: str) -> bool:
    query = f"PRAGMA table_info({table})"
    with engine.connect() as connection:
        result = connection.execute(text(query))
        return any(row[1] == column for row in result.fetchall())


def _ensure_table(engine: Engine, ddl: str) -> None:
    with engine.connect() as connection:
        connection.execute(text(ddl))


def _ensure_columns(engine: Engine, table: str, columns: Iterable[tuple[str, str]]) -> None:
    for column, ddl in columns:
        if _column_exists(engine, table, column):
            continue
        with engine.connect() as connection:
            connection.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}'))


def _populate_workspace(engine: Engine, table: str) -> None:
    if not _column_exists(engine, table, "workspace_id"):
        return
    with engine.connect() as connection:
        connection.execute(
            text(
                f"UPDATE {table} SET workspace_id = :workspace WHERE workspace_id IS NULL OR workspace_id = ''"
            ),
            {"workspace": DEFAULT_WORKSPACE_ID},
        )


def _ensure_default_workspace(engine: Engine) -> None:
    with engine.connect() as connection:
        connection.execute(
            text(
                "INSERT OR IGNORE INTO workspaces (id, key, name, color, icon, created_at, updated_at) "
                "VALUES (:id, :key, :name, :color, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {
                "id": DEFAULT_WORKSPACE_ID,
                "key": DEFAULT_WORKSPACE_KEY,
                "name": DEFAULT_WORKSPACE_NAME,
                "color": DEFAULT_WORKSPACE_COLOR,
            },
        )


def run_migrations(engine: Engine) -> None:
    dialect = engine.dialect.name
    if dialect != 'sqlite':
        return

    _ensure_table(
        engine,
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            icon TEXT,
            parent_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
            kind TEXT NOT NULL DEFAULT 'tenant',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """,
    )

    _ensure_table(
        engine,
        """
        CREATE TABLE IF NOT EXISTS workspace_members (
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (workspace_id, user_id)
        )
        """,
    )

    _ensure_table(
        engine,
        """
        CREATE TABLE IF NOT EXISTS workspace_invites (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            token TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            expires_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            accepted_at DATETIME,
            inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL
        )
        """,
    )

    workspace_column = f'TEXT NOT NULL DEFAULT "{DEFAULT_WORKSPACE_ID}"'
    for table in (
        'legal_entities',
        'individuals',
        'contracts',
        'projects',
        'project_performers',
        'tasks',
        'work_packages',
        'document_records',
        'import_logs',
    ):
        _ensure_columns(engine, table, [('workspace_id', workspace_column)])

    _ensure_default_workspace(engine)

    _ensure_columns(
        engine,
        'workspaces',
        [
            ('parent_id', 'TEXT REFERENCES workspaces(id) ON DELETE RESTRICT'),
            ('kind', "TEXT NOT NULL DEFAULT 'tenant'"),
        ],
    )

    with engine.connect() as connection:
        connection.execute(text("UPDATE workspaces SET kind='tenant' WHERE kind IS NULL OR TRIM(kind) = ''"))
        connection.execute(text("UPDATE workspace_members SET role='owner' WHERE role IN ('admin', 'accountant')"))
        connection.execute(text("UPDATE workspace_members SET role='member' WHERE role IN ('manager', 'performer', '')"))

    # New fields for tasks (assignee info)
    _ensure_columns(
        engine,
        'tasks',
        [
            ('assignee_account_id', 'TEXT'),
            ('assignee_display_name', 'TEXT'),
            ('assignee_email', 'TEXT'),
            ('spent_seconds', 'FLOAT DEFAULT 0'),
            ('estimate_seconds', 'FLOAT DEFAULT 0'),
            ('description', 'TEXT'),
            ('billed_seconds', 'FLOAT DEFAULT 0'),
        ],
    )

    # Additional performer/vat fields for work packages
    _ensure_columns(
        engine,
        'work_packages',
        [
            ('performer_type', "TEXT DEFAULT 'individual'"),
            ('vat_included', 'BOOLEAN DEFAULT 0'),
            ('vat_percent', 'FLOAT DEFAULT 0'),
            ('vat_amount', 'FLOAT DEFAULT 0'),
        ],
    )

    # Additional metadata for document records
    _ensure_columns(
        engine,
        'document_records',
        [
            ('template_id', 'TEXT'),
            ('performer_type', "TEXT DEFAULT 'individual'"),
            ('vat_included', 'BOOLEAN DEFAULT 0'),
            ('vat_percent', 'FLOAT DEFAULT 0'),
            ('vat_amount', 'FLOAT DEFAULT 0'),
            ('approval_status', "TEXT DEFAULT 'draft'"),
            ('submitted_at', 'DATETIME'),
            ('manager_approved_at', 'DATETIME'),
            ('manager_approved_by', 'TEXT'),
            ('performer_approved_at', 'DATETIME'),
            ('performer_approved_by', 'TEXT'),
            ('finalized_at', 'DATETIME'),
            ('finalized_by', 'TEXT'),
            ('approval_notes', 'JSON DEFAULT "[]"'),
            ('performer_assignee_id', 'TEXT'),
            ('manager_assignee_id', 'TEXT'),
            ('shared_with_parent', 'BOOLEAN DEFAULT 0'),
            ('shared_parent_id', 'TEXT REFERENCES workspaces(id) ON DELETE SET NULL'),
            ('shared_at', 'DATETIME'),
            ('shared_by_user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'),
        ],
    )

    # Jira-sourced individuals info
    _ensure_columns(
        engine,
        'individuals',
        [
            ('email', 'TEXT DEFAULT ""'),
            ('external_id', 'TEXT'),
            ('source', "TEXT DEFAULT 'manual'"),
            ('user_id', 'TEXT'),
            ('is_approval_manager', 'BOOLEAN DEFAULT 0'),
            ('default_manager_id', 'TEXT'),
        ],
    )

    _ensure_columns(
        engine,
        'legal_entities',
        [
            ('power_of_attorney_number', 'TEXT'),
            ('power_of_attorney_date', 'DATE'),
        ],
    )

    _ensure_columns(
        engine,
        'users',
        [
            ('extra_roles', 'JSON DEFAULT "[]"'),
        ],
    )

    for table in (
        'legal_entities',
        'individuals',
        'contracts',
        'projects',
        'project_performers',
        'tasks',
        'work_packages',
        'document_records',
        'import_logs',
    ):
        _populate_workspace(engine, table)

    deduplicate_connections()

    # Ensure new v2 documents columns exist (backward compatible)
    _ensure_columns(
        engine,
        'documents_v2',
        [
            # мы уже создаём таблицу через SQLAlchemy, но у ранних БД могли отсутствовать эти поля
            ('period_start', 'DATE'),
            ('period_end', 'DATE'),
        ],
    )
