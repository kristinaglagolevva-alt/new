from __future__ import annotations

from datetime import date, datetime
from secrets import token_urlsafe
from typing import List, Optional

from sqlalchemy.orm import Session, selectinload, object_session

from .. import orm_models
from pydantic import ValidationError

from ..schemas import (
    Contract,
    ContractCreate,
    ContractUpdate,
    Individual,
    IndividualCreate,
    IndividualUpdate,
    LegalEntity,
    LegalEntityCreate,
    LegalEntityUpdate,
    VatSettings,
)
from ..services.auth import create_user, ensure_user_workspace_membership, get_user_by_email
from ..orm_models import DocumentRecordORM
from .workspaces import resolve_workspace_id


def _legal_status(entity: orm_models.LegalEntityORM) -> str:
    required = [entity.name, entity.inn, entity.kpp, entity.signatory, entity.basis]
    if not all(isinstance(value, str) and value.strip() for value in required):
        return "incomplete"
    basis_normalized = (entity.basis or "").strip().lower()
    if "довер" in basis_normalized:
        number_value = entity.powerOfAttorneyNumber if hasattr(entity, "powerOfAttorneyNumber") else getattr(entity, "power_of_attorney_number", None)
        if isinstance(number_value, str):
            number_value = number_value.strip()
        has_number = bool(number_value)
        date_value = entity.powerOfAttorneyDate if hasattr(entity, "powerOfAttorneyDate") else getattr(entity, "power_of_attorney_date", None)
        if isinstance(date_value, str):
            has_date = bool(date_value.strip())
        elif isinstance(date_value, datetime):
            has_date = True
        elif isinstance(date_value, date):
            has_date = True
        else:
            has_date = False
        if not has_number or not has_date:
            return "incomplete"
    return "complete"


def _individual_status(individual: orm_models.IndividualORM) -> str:
    required = [individual.name, individual.inn, individual.passport, individual.address]
    return "complete" if all(value.strip() for value in required) else "incomplete"


def _individual_role(individual: orm_models.IndividualORM) -> str:
    return (
        orm_models.UserRole.MANAGER.value
        if getattr(individual, "is_approval_manager", False)
        else orm_models.UserRole.PERFORMER.value
    )


def _sync_individual_account(
    session: Session,
    individual: orm_models.IndividualORM,
    *,
    create_missing: bool = True,
    allow_email_reassign: bool = False,
) -> tuple[orm_models.UserORM | None, str | None]:
    if object_session(individual) is None:
        individual = session.merge(individual, load=False)

    workspace = session.get(orm_models.WorkspaceORM, individual.workspace_id) if individual.workspace_id else None
    if individual.workspace_id and workspace is None:
        raise ValueError(f"Рабочее пространство '{individual.workspace_id}' не найдено")

    email = (individual.email or "").strip().lower()
    if not email:
        individual.user = None
        individual.user_id = None
        return None, None

    desired_role = orm_models.UserRole.PERFORMER.value
    generated_password: str | None = None

    user = individual.user
    if user and user.email.strip().lower() != email:
        conflict = get_user_by_email(session, email)
        if conflict and conflict.id != user.id:
            if allow_email_reassign:
                existing_link = (
                    session.query(orm_models.IndividualORM)
                    .filter(orm_models.IndividualORM.user_id == conflict.id)
                    .first()
                )
                if existing_link is None:
                    conflict.email = f"legacy+{conflict.id}@invalid.local"
                else:
                    user = conflict
            if conflict and conflict.id != (user.id if user else None) and not allow_email_reassign:
                raise ValueError("Пользователь с таким email уже существует")
        if user:
            user.email = email
    elif not user:
        existing = get_user_by_email(session, email)
        if existing:
            user = existing
        elif create_missing:
            generated_password = token_urlsafe(10)
            user = create_user(
                session,
                email=email,
                password=generated_password,
                full_name=individual.name.strip() or email,
                role=desired_role,
                workspace_id=individual.workspace_id,
            )
        else:
            individual.user = None
            individual.user_id = None
            return None, None

    if user:
        full_name = individual.name.strip()
        if full_name and user.full_name != full_name:
            user.full_name = full_name
        if workspace:
            ensure_user_workspace_membership(
                session,
                user=user,
                workspace=workspace,
                user_role=desired_role,
            )
        individual.user = user
        individual.user_id = user.id
    else:
        individual.user = None
        individual.user_id = None

    return user, generated_password


def ensure_individual_account(
    session: Session,
    individual: orm_models.IndividualORM,
    *,
    create_missing: bool = True,
    allow_email_reassign: bool = True,
) -> tuple[orm_models.UserORM | None, str | None]:
    return _sync_individual_account(
        session,
        individual,
        create_missing=create_missing,
        allow_email_reassign=allow_email_reassign,
    )


def _backfill_document_assignees(session: Session, performer: orm_models.IndividualORM) -> None:
    performer_user, _ = ensure_individual_account(
        session,
        performer,
        create_missing=False,
        allow_email_reassign=True,
    )

    manager_user = None
    if performer.default_manager_id:
        manager = session.get(orm_models.IndividualORM, performer.default_manager_id)
        if manager is not None:
            manager_user, _ = ensure_individual_account(
                session,
                manager,
                create_missing=False,
                allow_email_reassign=True,
            )

    candidates: list[DocumentRecordORM] = (
        session.query(DocumentRecordORM)
        .filter(DocumentRecordORM.contractor_id == performer.id)
        .filter(DocumentRecordORM.workspace_id == performer.workspace_id)
        .all()
    )

    for record in candidates:
        changed = False
        if performer_user and record.performer_assignee_id != performer_user.id:
            record.performer_assignee = performer_user
            record.performer_assignee_id = performer_user.id
            changed = True

        if manager_user and record.manager_assignee_id is None:
            record.manager_assignee = manager_user
            record.manager_assignee_id = manager_user.id
            changed = True

        if not manager_user and performer.default_manager_id is None and record.manager_assignee_id is None:
            # nothing to do
            pass

        if changed:
            record.updated_at = datetime.utcnow()


def _individual_to_schema(
    individual: orm_models.IndividualORM,
    *,
    generated_password: str | None = None,
) -> Individual:
    base = Individual.from_orm(individual)
    if individual.user:
        base.userEmail = individual.user.email
        base.userFullName = individual.user.full_name
        base.userRole = individual.user.role
        base.userActive = individual.user.is_active
    if generated_password:
        base.generatedPassword = generated_password
    return base


def _contract_status(contract: orm_models.ContractORM) -> str:
    if not contract.number.strip():
        return "incomplete"
    if not contract.client_id or not contract.contractor_id:
        return "incomplete"
    if contract.rate <= 0:
        return "incomplete"
    return "complete"


VAT_SETTINGS_EXTRA_KEY = "vat_settings"


def _fallback_vat_settings(settings: orm_models.ContractSettingsORM | None) -> VatSettings:
    mode = settings.vat_mode if settings else "no_vat"
    if mode == "vat_20":
        return VatSettings(status="payer", rate=20.0, exempt=False)
    if mode == "vat_10":
        return VatSettings(status="payer", rate=10.0, exempt=False)
    if mode == "vat_0":
        return VatSettings(status="payer", rate=0.0, exempt=False)
    return VatSettings(status="non_payer", rate=None, exempt=False)


def _resolve_vat_settings(settings: orm_models.ContractSettingsORM | None, extra: dict | None) -> VatSettings:
    if extra and isinstance(extra, dict):
        candidate = extra.get(VAT_SETTINGS_EXTRA_KEY)
        if isinstance(candidate, dict):
            try:
                return VatSettings.parse_obj(candidate)
            except ValidationError:
                pass
    return _fallback_vat_settings(settings)


def list_legal_entities(session: Session, workspace_id: str | None = None) -> List[LegalEntity]:
    workspace = resolve_workspace_id(session, workspace_id)
    items = (
        session.query(orm_models.LegalEntityORM)
        .filter(orm_models.LegalEntityORM.workspace_id == workspace)
        .order_by(orm_models.LegalEntityORM.name.asc())
        .all()
    )
    return [LegalEntity.from_orm(item) for item in items]


def upsert_legal_entity(
    session: Session,
    payload: LegalEntityCreate | LegalEntityUpdate,
    *,
    workspace_id: str | None = None,
    entity_id: Optional[str] = None,
) -> LegalEntity:
    workspace = resolve_workspace_id(session, workspace_id)
    if entity_id:
        entity = session.get(orm_models.LegalEntityORM, entity_id)
        if not entity or entity.workspace_id != workspace:
            raise ValueError("Legal entity not found")
    else:
        entity = orm_models.LegalEntityORM(workspace_id=workspace)
        session.add(entity)

    entity.name = payload.name.strip()
    entity.inn = payload.inn.strip()
    entity.kpp = payload.kpp.strip()
    entity.signatory = payload.signatory.strip()
    entity.basis = payload.basis.strip()
    entity.powerOfAttorneyNumber = payload.powerOfAttorneyNumber
    entity.powerOfAttorneyDate = payload.powerOfAttorneyDate
    entity.status = _legal_status(entity)
    session.flush()
    return LegalEntity.from_orm(entity)


def delete_legal_entity(session: Session, entity_id: str, *, workspace_id: str | None = None) -> None:
    workspace = resolve_workspace_id(session, workspace_id)
    entity = session.get(orm_models.LegalEntityORM, entity_id)
    if entity and entity.workspace_id == workspace:
        session.delete(entity)


def list_individuals(session: Session, workspace_id: str | None = None) -> List[Individual]:
    workspace = resolve_workspace_id(session, workspace_id)
    items = (
        session.query(orm_models.IndividualORM)
        .options(
            selectinload(orm_models.IndividualORM.user),
            selectinload(orm_models.IndividualORM.default_manager),
        )
        .filter(orm_models.IndividualORM.workspace_id == workspace)
        .order_by(orm_models.IndividualORM.name.asc())
        .all()
    )
    results: List[Individual] = []
    pending_flush = False
    for item in items:
        email = (item.email or '').strip().lower()
        generated_password = None
        if email:
            existing_user = get_user_by_email(session, email)
            if existing_user and item.user_id != existing_user.id:
                item.user = existing_user
                item.user_id = existing_user.id
                pending_flush = True
                _backfill_document_assignees(session, item)
            elif not existing_user and not item.user_id:
                linked_user, generated_password = ensure_individual_account(
                    session,
                    item,
                    create_missing=False,
                    allow_email_reassign=True,
                )
                if linked_user is not None:
                    pending_flush = True
                    _backfill_document_assignees(session, item)
            elif item.user_id:
                _backfill_document_assignees(session, item)
        results.append(_individual_to_schema(item, generated_password=generated_password))

    if pending_flush:
        session.flush()

    return results


def upsert_individual(
    session: Session,
    payload: IndividualCreate | IndividualUpdate,
    *,
    workspace_id: str | None = None,
    individual_id: Optional[str] = None,
) -> Individual:
    workspace = resolve_workspace_id(session, workspace_id)
    if individual_id:
        entity = session.get(orm_models.IndividualORM, individual_id)
        if not entity or entity.workspace_id != workspace:
            raise ValueError("Individual not found")
    else:
        entity = orm_models.IndividualORM(workspace_id=workspace)
        session.add(entity)

    entity.name = payload.name.strip()
    entity.inn = payload.inn.strip()
    entity.passport = payload.passport.strip()
    entity.address = payload.address.strip()
    entity.email = payload.email.strip()
    if getattr(payload, "externalId", None) is not None:
        entity.external_id = payload.externalId or None
    if getattr(payload, "source", None):
        entity.source = payload.source
    entity.is_approval_manager = bool(getattr(payload, "isApprovalManager", entity.is_approval_manager))

    manager_id = getattr(payload, "approvalManagerId", None)
    if manager_id:
        manager = session.get(orm_models.IndividualORM, manager_id)
        if not manager or manager.workspace_id != workspace:
            raise ValueError("Не удалось найти выбранного менеджера")
        entity.default_manager_id = manager.id
    else:
        entity.default_manager_id = None

    _, generated_password = ensure_individual_account(session, entity)
    _backfill_document_assignees(session, entity)
    entity.status = _individual_status(entity)
    session.flush()
    return _individual_to_schema(entity, generated_password=generated_password)


def delete_individual(session: Session, individual_id: str, *, workspace_id: str | None = None) -> None:
    workspace = resolve_workspace_id(session, workspace_id)
    entity = session.get(orm_models.IndividualORM, individual_id)
    if entity and entity.workspace_id == workspace:
        session.delete(entity)


def _contract_to_schema(entity: orm_models.ContractORM) -> Contract:
    settings = entity.settings
    extra = dict(settings.extra or {}) if settings and settings.extra else {}

    valid_from_value = extra.get("valid_from")
    valid_to_value = extra.get("valid_to")
    expiration_enabled_value = extra.get("expiration_reminder_enabled")
    expiration_days_value = extra.get("expiration_reminder_days")
    require_is_document_value = extra.get("require_is_document")
    allowed_templates_value = extra.get("allowed_template_ids")
    continuation_of_value = extra.get("continuation_of_id")

    def _parse_date(value: object) -> date | None:
        if isinstance(value, str) and value:
            try:
                return date.fromisoformat(value)
            except ValueError:  # pragma: no cover - defensive
                return None
        if isinstance(value, date):
            return value
        return None

    valid_from_date = _parse_date(valid_from_value)
    valid_to_date = _parse_date(valid_to_value)

    allowed_templates_list: list[str] | None = None
    if isinstance(allowed_templates_value, list):
        allowed_templates_list = [str(item) for item in allowed_templates_value if isinstance(item, str)]

    continuation_of_id = None
    if isinstance(continuation_of_value, str) and continuation_of_value:
        continuation_of_id = continuation_of_value

    expiration_enabled_bool = None
    if isinstance(expiration_enabled_value, bool):
        expiration_enabled_bool = expiration_enabled_value

    expiration_days_int = None
    if isinstance(expiration_days_value, int):
        expiration_days_int = expiration_days_value

    require_is_document_bool = None
    if isinstance(require_is_document_value, bool):
        require_is_document_bool = require_is_document_value

    vat_settings = _resolve_vat_settings(settings, extra)

    return Contract(
        id=entity.id,
        number=entity.number,
        clientId=entity.client_id,
        contractorId=entity.contractor_id,
        rate=float(entity.rate),
        rateType=entity.rate_type,
        currency=entity.currency,
        status=entity.status,
        performerType=settings.performer_type if settings else None,
        vatMode=settings.vat_mode if settings else None,
        includeTimesheetByDefault=settings.include_timesheet if settings else None,
        timesheetToggleLocked=settings.timesheet_locked if settings else None,
        requireNpdReceipt=settings.require_npd_receipt if settings else None,
        actByProjects=settings.act_by_projects if settings else None,
        normHours=float(settings.norm_hours) if settings and settings.norm_hours is not None else None,
        templateAvrId=settings.template_avr_id if settings else None,
        templateIprId=settings.template_ipr_id if settings else None,
        templateInvoiceId=settings.template_invoice_id if settings else None,
        validFrom=valid_from_date,
        validTo=valid_to_date,
        expirationReminderEnabled=expiration_enabled_bool,
        expirationReminderDays=expiration_days_int,
        requireIsDocument=require_is_document_bool,
        allowedTemplateIds=allowed_templates_list,
        continuationOfId=continuation_of_id,
        vatSettings=vat_settings,
    )


def list_contracts(session: Session, workspace_id: str | None = None) -> List[Contract]:
    workspace = resolve_workspace_id(session, workspace_id)
    items = (
        session.query(orm_models.ContractORM)
        .options(selectinload(orm_models.ContractORM.settings))
        .filter(orm_models.ContractORM.workspace_id == workspace)
        .order_by(orm_models.ContractORM.number.asc())
        .all()
    )
    return [_contract_to_schema(item) for item in items]


def upsert_contract(
    session: Session,
    payload: ContractCreate | ContractUpdate,
    *,
    workspace_id: str | None = None,
    contract_id: Optional[str] = None,
) -> Contract:
    workspace = resolve_workspace_id(session, workspace_id)
    if contract_id:
        entity = session.get(orm_models.ContractORM, contract_id)
        if not entity or entity.workspace_id != workspace:
            raise ValueError("Contract not found")
    else:
        entity = orm_models.ContractORM(workspace_id=workspace)
        session.add(entity)

    entity.number = payload.number.strip()
    entity.client_id = payload.clientId
    entity.contractor_id = payload.contractorId
    entity.rate = float(payload.rate)
    entity.rate_type = payload.rateType
    entity.currency = payload.currency
    entity.status = _contract_status(entity)

    if entity.client_id:
        client = session.get(orm_models.LegalEntityORM, entity.client_id)
        if client is None or client.workspace_id != workspace:
            raise ValueError("Указанный заказчик недоступен")

    if entity.contractor_id:
        contractor = session.get(orm_models.IndividualORM, entity.contractor_id)
        if contractor is None or contractor.workspace_id != workspace:
            raise ValueError("Указанный исполнитель недоступен")
    settings = entity.settings
    if not settings:
        settings = orm_models.ContractSettingsORM(contract=entity)
        session.add(settings)

    if payload.performerType is not None:
        settings.performer_type = payload.performerType
    if payload.vatMode is not None:
        settings.vat_mode = payload.vatMode
    if payload.includeTimesheetByDefault is not None:
        settings.include_timesheet = payload.includeTimesheetByDefault
    if payload.timesheetToggleLocked is not None:
        settings.timesheet_locked = payload.timesheetToggleLocked
    if payload.requireNpdReceipt is not None:
        settings.require_npd_receipt = payload.requireNpdReceipt
    if payload.actByProjects is not None:
        settings.act_by_projects = payload.actByProjects
    if payload.normHours is not None:
        settings.norm_hours = payload.normHours
    if payload.templateAvrId is not None:
        settings.template_avr_id = payload.templateAvrId or None
    if payload.templateIprId is not None:
        settings.template_ipr_id = payload.templateIprId or None
    if payload.templateInvoiceId is not None:
        settings.template_invoice_id = payload.templateInvoiceId or None

    extra = dict(settings.extra or {})
    fields_set = getattr(payload, "__fields_set__", set())

    if "validFrom" in fields_set:
        if payload.validFrom is None:
            extra.pop("valid_from", None)
        else:
            extra["valid_from"] = payload.validFrom.isoformat()

    if "validTo" in fields_set:
        if payload.validTo is None:
            extra.pop("valid_to", None)
        else:
            extra["valid_to"] = payload.validTo.isoformat()

    if "expirationReminderEnabled" in fields_set:
        if payload.expirationReminderEnabled is None:
            extra.pop("expiration_reminder_enabled", None)
        else:
            extra["expiration_reminder_enabled"] = bool(payload.expirationReminderEnabled)

    if "expirationReminderDays" in fields_set:
        if payload.expirationReminderDays is None:
            extra.pop("expiration_reminder_days", None)
        else:
            extra["expiration_reminder_days"] = int(payload.expirationReminderDays)

    if "requireIsDocument" in fields_set:
        if payload.requireIsDocument is None:
            extra.pop("require_is_document", None)
        else:
            extra["require_is_document"] = bool(payload.requireIsDocument)

    if "allowedTemplateIds" in fields_set:
        if payload.allowedTemplateIds:
            extra["allowed_template_ids"] = [str(item) for item in payload.allowedTemplateIds]
        else:
            extra.pop("allowed_template_ids", None)

    if "continuationOfId" in fields_set:
        if payload.continuationOfId:
            extra["continuation_of_id"] = str(payload.continuationOfId)
        else:
            extra.pop("continuation_of_id", None)

    if "vatSettings" in fields_set:
        if payload.vatSettings is None:
            extra.pop(VAT_SETTINGS_EXTRA_KEY, None)
        else:
            vat_settings_payload = payload.vatSettings
            if isinstance(vat_settings_payload, VatSettings):
                vat_settings_obj = vat_settings_payload
            else:
                vat_settings_obj = VatSettings.parse_obj(vat_settings_payload)
            extra[VAT_SETTINGS_EXTRA_KEY] = vat_settings_obj.dict()

    settings.extra = extra or None

    session.flush()
    return _contract_to_schema(entity)


def delete_contract(session: Session, contract_id: str, *, workspace_id: str | None = None) -> None:
    workspace = resolve_workspace_id(session, workspace_id)
    entity = session.get(orm_models.ContractORM, contract_id)
    if entity and entity.workspace_id == workspace:
        session.delete(entity)
