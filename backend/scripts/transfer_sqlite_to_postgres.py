#!/usr/bin/env python
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, Tuple, Set

from sqlalchemy import create_engine, text, event
from sqlalchemy.engine import Engine
from sqlalchemy.schema import MetaData, Table

# Import models so that Base.metadata is fully populated
from backend.app import orm_models  # noqa: F401
from backend.app.database import Base


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy all data from the local SQLite database into a PostgreSQL database."
    )
    parser.add_argument(
        "--sqlite",
        default="backend/data/app.db",
        help="Путь к локальному SQLite файлу (по умолчанию backend/data/app.db).",
    )
    parser.add_argument(
        "--postgres-url",
        required=True,
        help="Строка подключения к PostgreSQL (например, postgresql+psycopg://user:pass@host:5432/db).",
    )
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Удалить все строки в целевой базе перед копированием.",
    )
    return parser.parse_args()


def ensure_sslmode(url: str) -> str:
    """
    Add sslmode=require to postgres URLs if it's missing.
    Works with both postgresql:// and postgresql+psycopg:// schemes.
    """
    if url.startswith(("postgresql://", "postgresql+")) and "sslmode=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode=require"
    return url


def make_sqlite_engine(sqlite_path: Path) -> Engine:
    sqlite_url = f"sqlite:///{sqlite_path.as_posix()}"
    engine = create_engine(sqlite_url)

    # Enforce FK checks on SQLite source to surface any issues early
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _):
        try:
            cur = dbapi_connection.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
        except Exception:
            # If this isn't SQLite or pragma fails, ignore gracefully
            pass

    return engine


def make_postgres_engine(url: str) -> Engine:
    url = ensure_sslmode(url)
    # Conservative connection options; pool_pre_ping helps drop dead connections
    return create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 10},
    )


def collect_fk_index(meta: MetaData) -> Dict[str, Dict[str, Tuple[str, str]]]:
    """
    Build an index of foreign key relationships for each table.

    Returns:
        {
          "<child_table>": {
              "<child_col>": ("<parent_table>", "<parent_col>")
          },
          ...
        }
    """
    fk_map: Dict[str, Dict[str, Tuple[str, str]]] = {}
    for table in meta.sorted_tables:
        mapping: Dict[str, Tuple[str, str]] = {}
        for fk in table.foreign_keys:
            parent_col = fk.column
            mapping[fk.parent.name] = (parent_col.table.name, parent_col.name)
        if mapping:
            fk_map[table.name] = mapping
    return fk_map


def prefetch_parent_sets(src_engine: Engine, fk_map: Dict[str, Dict[str, Tuple[str, str]]]) -> Dict[Tuple[str, str], Set]:
    """
    Prefetch distinct values of parent columns referenced by children to allow orphan filtering.
    """
    needed: Set[Tuple[str, str]] = set()
    for child, colmap in fk_map.items():
        for _, parent in colmap.items():
            needed.add(parent)

    cache: Dict[Tuple[str, str], Set] = {}
    with src_engine.connect() as conn:
        for (parent_table, parent_col) in needed:
            rs = conn.execute(text(f"SELECT DISTINCT {parent_col} FROM {parent_table}"))
            cache[(parent_table, parent_col)] = {row[0] for row in rs.fetchall()}
    return cache


def filter_orphans(table: Table, rows: list[dict], fk_map: Dict[str, Dict[str, Tuple[str, str]]], parent_sets: Dict[Tuple[str, str], Set]) -> tuple[list[dict], int]:
    """
    Remove rows that would violate FK constraints in Postgres.
    """
    removed = 0
    if table.name not in fk_map or not rows:
        return rows, removed

    colmap = fk_map[table.name]  # child_col -> (parent_table, parent_col)

    def ok(row: dict) -> bool:
        for child_col, parent_ref in colmap.items():
            parent_tbl, parent_col = parent_ref
            val = row.get(child_col)
            if val is None:
                # If NULLable FK, Postgres will accept NULL; keep row
                continue
            allowed = parent_sets.get((parent_tbl, parent_col), set())
            if val not in allowed:
                return False
        return True

    filtered = []
    for r in rows:
        if ok(r):
            filtered.append(r)
        else:
            removed += 1
    return filtered, removed


def main() -> None:
    args = parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite файл не найден: {sqlite_path}")

    source_engine = make_sqlite_engine(sqlite_path)
    target_engine = make_postgres_engine(args.postgres_url)

    meta = Base.metadata

    # Создаём схему в Postgres, если её ещё нет.
    meta.create_all(target_engine)

    if args.wipe:
        with target_engine.begin() as connection:
            for table in reversed(meta.sorted_tables):
                connection.execute(table.delete())

    # Построим индекс внешних ключей и подгрузим множества родительских значений
    fk_map = collect_fk_index(meta)
    parent_sets = prefetch_parent_sets(source_engine, fk_map)

    total_removed: Dict[str, int] = {}

    with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
        for table in meta.sorted_tables:
            rows = source_conn.execute(table.select()).fetchall()
            if not rows:
                continue

            payload = [dict(row._mapping) for row in rows]

            # Фильтруем сироты для всех таблиц, имеющих FK
            payload, removed = filter_orphans(table, payload, fk_map, parent_sets)
            if removed:
                total_removed[table.name] = total_removed.get(table.name, 0) + removed
                print(f"Filtered {removed} orphan row(s) from {table.name}")

            if not payload:
                print(f"Skipped {table.name} (no rows after filtering)")
                continue

            # Вставляем партиями на всякий случай
            BATCH = 1000
            for i in range(0, len(payload), BATCH):
                batch = payload[i : i + BATCH]
                target_conn.execute(table.insert(), batch)

            print(f"Copied {len(payload)} rows into {table.name}")

    if total_removed:
        print("\nSummary of filtered orphan rows due to FK constraints:")
        for tbl, cnt in total_removed.items():
            print(f"  - {tbl}: {cnt}")

    print("Done. Проверьте данные в PostgreSQL.")


if __name__ == "__main__":
    main()
