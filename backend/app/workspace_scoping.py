from __future__ import annotations

from typing import Iterable, Tuple, Type

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from . import orm_models

TARGET_MODELS: Tuple[Type[object], ...] = (
    orm_models.LegalEntityORM,
    orm_models.IndividualORM,
    orm_models.ContractORM,
    orm_models.ProjectORM,
    orm_models.ProjectPerformerORM,
    orm_models.TaskORM,
    orm_models.WorkPackageORM,
    orm_models.DocumentRecordORM,
    orm_models.ImportLogORM,
)


def setup_workspace_events(session_cls: Type[Session]) -> None:
    @event.listens_for(session_cls, "do_orm_execute")
    def _add_workspace_filter(execute_state):  # type: ignore[unused-variable]
        if not execute_state.is_select:
            return
        workspace_scope = execute_state.session.info.get("workspace_scope")
        workspace_id = execute_state.session.info.get("workspace_id")
        if not workspace_scope and not workspace_id:
            return

        statement = execute_state.statement
        if workspace_scope:
            scope_tuple = tuple(workspace_scope)
            for model in TARGET_MODELS:
                statement = statement.options(
                    with_loader_criteria(
                        model,
                        lambda cls, scope=scope_tuple: cls.workspace_id.in_(scope),
                        include_aliases=True,
                    )
                )
        elif workspace_id:
            for model in TARGET_MODELS:
                statement = statement.options(
                    with_loader_criteria(
                        model,
                        lambda cls, wid=workspace_id: cls.workspace_id == wid,
                        include_aliases=True,
                    )
                )
        execute_state.statement = statement

    @event.listens_for(session_cls, "before_flush")
    def _inject_workspace(session, flush_context, instances):  # type: ignore[unused-variable]
        workspace_id = session.info.get("workspace_id")
        if not workspace_id:
            return
        for obj in session.new:
            if hasattr(obj, "workspace_id"):
                current = getattr(obj, "workspace_id", None)
                if not current:
                    setattr(obj, "workspace_id", workspace_id)

    @event.listens_for(session_cls, "loaded_as_persistent")
    def _validate_workspace(session, obj):  # type: ignore[unused-variable]
        workspace_scope = session.info.get("workspace_scope")
        workspace_id = session.info.get("workspace_id")
        if (workspace_scope is None and workspace_id is None) or not hasattr(obj, "workspace_id"):
            return
        current = getattr(obj, "workspace_id", None)
        allowed = set(workspace_scope or [])
        if workspace_id:
            allowed.add(workspace_id)
        if current and current not in allowed:
            session.expunge(obj)
