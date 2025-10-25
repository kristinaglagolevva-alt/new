from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import orm_models
from ..document_rules import (
    DOCUMENT_GROUPING_RULES,
    DOCUMENT_MASTER_VISIBILITY,
    RATE_EDIT_RULE,
)
from ..schemas import (
    Company,
    CompanyCreate,
    CompanyUpdate,
    ContractStatus,
    ContractUiProfile,
    ContractV2,
    ContractV2Create,
    ContractV2Update,
    PartyType,
    PerformerRuleConfig,
    RateType,
    VATMode,
)


@dataclass
class ServiceError(Exception):
    code: str
    message: str
    details: dict | None = None

    def to_dict(self) -> dict:
        payload = {
            "code": self.code,
            "message": self.message,
        }
        if self.details:
            payload["details"] = self.details
        return payload


# === Helpers ================================================================

def _normalize_inn(inn: str | None) -> Optional[str]:
    if not inn:
        return None
    digits = ''.join(ch for ch in inn if ch.isdigit())
    return digits or None


def _compute_contract_status(valid_from: date, valid_to: date) -> ContractStatus:
    today = date.today()
    if valid_to < today:
        return ContractStatus.EXPIRED
    if valid_from > today:
        return ContractStatus.DRAFT
    return ContractStatus.ACTIVE


def _validate_contract_payload(payload: ContractV2Create | ContractV2Update) -> None:
    errors = {}
    if payload.valid_from > payload.valid_to:
        errors["valid_from"] = "valid_from must be on or before valid_to"
    if payload.contract_date > payload.valid_to:
        errors["contract_date"] = "contract_date cannot exceed valid_to"
    if payload.rate_value <= 0:
        errors["rate_value"] = "rate_value must be positive"
    if payload.rate_type == RateType.MONTH and payload.meta:
        norm_hours = payload.meta.get("norm_hours") if isinstance(payload.meta, dict) else None
        if norm_hours is not None:
            try:
                norm = float(norm_hours)
                if norm <= 0:
                    errors["meta.norm_hours"] = "norm_hours must be positive"
            except (TypeError, ValueError):
                errors["meta.norm_hours"] = "norm_hours must be a number"
    if errors:
        raise ServiceError(code="validation_failed", message="Contract validation failed", details=errors)


def _log_audit(
    session: Session,
    *,
    actor_id: str | None,
    action: str,
    entity: str,
    entity_id: str | None,
    payload: dict | None,
    error_code: str | None = None,
) -> None:
    audit = orm_models.AuditLogORM(
        actor_id=actor_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        payload=payload,
        error_code=error_code,
    )
    session.add(audit)


def _company_to_schema(model: orm_models.CompanyORM) -> Company:
    return Company.from_orm(model)


def _contract_to_schema(model: orm_models.ContractV2ORM) -> ContractV2:
    return ContractV2(
        id=model.id,
        party_type=PartyType(model.party_type),
        party_id=model.party_id,
        performer_id=model.performer_id,
        contract_number=model.contract_number,
        contract_date=model.contract_date,
        valid_from=model.valid_from,
        valid_to=model.valid_to,
        vat_mode=VATMode(model.vat_mode),
        rate_type=RateType(model.rate_type),
        rate_value=float(model.rate_value or 0),
        currency=model.currency,
        act_by_projects=model.act_by_projects,
        ip_transfer_mode=model.ip_transfer_mode,
        meta=model.meta or {},
        status=ContractStatus(model.status),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


# === Company operations =====================================================

def lookup_company_by_inn(session: Session, inn: str) -> Company | None:
    normalized = _normalize_inn(inn)
    if not normalized:
        return None
    record = (
        session.query(orm_models.CompanyORM)
        .filter(orm_models.CompanyORM.inn == normalized)
        .one_or_none()
    )
    return _company_to_schema(record) if record else None


def get_company(session: Session, company_id: int) -> Company:
    record = session.get(orm_models.CompanyORM, company_id)
    if not record:
        raise ServiceError("not_found", "Компания не найдена")
    return _company_to_schema(record)


def upsert_company(
    session: Session,
    payload: CompanyCreate | CompanyUpdate,
    *,
    existing: orm_models.CompanyORM | None = None,
    actor_id: str | None = None,
) -> Company:
    normalized_inn = _normalize_inn(payload.inn)
    if not normalized_inn:
        raise ServiceError("validation_failed", "ИНН обязателен", {"inn": "ИНН обязателен"})

    model = existing or orm_models.CompanyORM()
    model.name = payload.name.strip()
    model.inn = normalized_inn
    model.kpp = payload.kpp.strip() if payload.kpp else None
    model.is_ip = bool(payload.is_ip)
    model.default_vat_mode = payload.default_vat_mode.value if isinstance(payload.default_vat_mode, VATMode) else payload.default_vat_mode
    model.act_by_projects = bool(payload.act_by_projects)

    session.add(model)
    session.flush()

    _log_audit(
        session,
        actor_id=actor_id,
        action="company.saved",
        entity="company",
        entity_id=str(model.id),
        payload={
            "name": model.name,
            "inn": model.inn,
        },
        error_code=None,
    )

    return _company_to_schema(model)


# === Contract operations ====================================================

def create_contract(
    session: Session,
    payload: ContractV2Create,
    *,
    actor_id: str | None = None,
) -> ContractV2:
    _validate_contract_payload(payload)

    status = _compute_contract_status(payload.valid_from, payload.valid_to)

    model = orm_models.ContractV2ORM(
        party_type=payload.party_type.value,
        party_id=payload.party_id,
        performer_id=payload.performer_id,
        contract_number=payload.contract_number.strip(),
        contract_date=payload.contract_date,
        valid_from=payload.valid_from,
        valid_to=payload.valid_to,
        vat_mode=payload.vat_mode.value,
        rate_type=payload.rate_type.value,
        rate_value=payload.rate_value,
        currency=payload.currency,
        act_by_projects=payload.act_by_projects,
        ip_transfer_mode=payload.ip_transfer_mode.value,
        status=status.value,
        meta=payload.meta or {},
    )

    if payload.party_type == PartyType.COMPANY:
        try:
            model.company_id = int(payload.party_id)
        except ValueError:
            raise ServiceError("validation_failed", "party_id must be numeric for companies")

    try:
        with session.begin_nested():
            session.add(model)
            session.flush()
    except IntegrityError as exc:
        session.rollback()
        _log_audit(
            session,
            actor_id=actor_id,
            action="contract.create",
            entity="contract",
            entity_id=None,
            payload=payload.dict(by_alias=True, exclude_unset=True, use_enum_values=True),
            error_code="unique_violation",
        )
        raise ServiceError("unique_violation", "Контракт с таким номером уже существует", {"contract_number": payload.contract_number}) from exc

    _log_audit(
        session,
        actor_id=actor_id,
        action="contract.create",
        entity="contract",
        entity_id=str(model.id),
        payload=payload.dict(by_alias=True, exclude_unset=True, use_enum_values=True),
        error_code=None,
    )

    return _contract_to_schema(model)


def update_contract(
    session: Session,
    contract_id: int,
    payload: ContractV2Update,
    *,
    actor_id: str | None = None,
) -> ContractV2:
    _validate_contract_payload(payload)

    model = session.get(orm_models.ContractV2ORM, contract_id)
    if not model:
        raise ServiceError("not_found", "Контракт не найден")

    model.party_type = payload.party_type.value
    model.party_id = payload.party_id
    model.performer_id = payload.performer_id
    model.contract_number = payload.contract_number.strip()
    model.contract_date = payload.contract_date
    model.valid_from = payload.valid_from
    model.valid_to = payload.valid_to
    model.vat_mode = payload.vat_mode.value
    model.rate_type = payload.rate_type.value
    model.rate_value = payload.rate_value
    model.currency = payload.currency
    model.act_by_projects = payload.act_by_projects
    model.ip_transfer_mode = payload.ip_transfer_mode.value
    model.meta = payload.meta or {}
    model.status = payload.status.value

    if payload.party_type == PartyType.COMPANY:
        try:
            model.company_id = int(payload.party_id)
        except ValueError:
            raise ServiceError("validation_failed", "party_id must be numeric for companies")
    else:
        model.company_id = None

    try:
        with session.begin_nested():
            session.add(model)
            session.flush()
    except IntegrityError as exc:
        session.rollback()
        _log_audit(
            session,
            actor_id=actor_id,
            action="contract.update",
            entity="contract",
            entity_id=str(contract_id),
            payload=payload.dict(by_alias=True, exclude_unset=True, use_enum_values=True),
            error_code="unique_violation",
        )
        raise ServiceError("unique_violation", "Контракт с таким номером уже существует", {"contract_number": payload.contract_number}) from exc

    _log_audit(
        session,
        actor_id=actor_id,
        action="contract.update",
        entity="contract",
        entity_id=str(model.id),
        payload=payload.dict(by_alias=True, exclude_unset=True, use_enum_values=True),
        error_code=None,
    )

    session.refresh(model)
    return _contract_to_schema(model)


def list_contracts(
    session: Session,
    *,
    party_type: PartyType | None = None,
    party_inn: str | None = None,
    status: Iterable[ContractStatus] | None = None,
) -> list[ContractV2]:
    query = session.query(orm_models.ContractV2ORM)
    if party_type:
        query = query.filter(orm_models.ContractV2ORM.party_type == party_type.value)
    if party_inn:
        normalized = _normalize_inn(party_inn)
        if normalized and party_type == PartyType.COMPANY:
            query = query.join(orm_models.CompanyORM, orm_models.ContractV2ORM.company_id == orm_models.CompanyORM.id)
            query = query.filter(orm_models.CompanyORM.inn == normalized)
    if status:
        values = [s.value for s in status]
        query = query.filter(orm_models.ContractV2ORM.status.in_(values))

    query = query.order_by(orm_models.ContractV2ORM.contract_number.asc())

    return [_contract_to_schema(item) for item in query.all()]


def _detect_performer_type(contract: orm_models.ContractV2ORM) -> str:
    performer = contract.performer
    if performer and performer.type:
        return performer.type
    if contract.party_type == PartyType.COMPANY.value:
        if contract.company and contract.company.is_ip:
            return "ip"
        return "company"
    if contract.party_type == PartyType.INDIVIDUAL.value:
        return "gph"
    return "gph"


def _base_vat_modes() -> list[VATMode]:
    return [VATMode.NO_VAT, VATMode.VAT_0, VATMode.VAT_10, VATMode.VAT_20]


def get_contract_ui_profile(session: Session, contract_id: int) -> ContractUiProfile:
    contract = session.get(orm_models.ContractV2ORM, contract_id)
    if not contract:
        raise ServiceError("not_found", "Контракт не найден")

    performer_type = _detect_performer_type(contract)
    has_ip_transfer = contract.ip_transfer_mode == "separate"

    available_documents: list[str]
    default_documents: list[str]
    hidden_sections: list[str] = []
    required_fields: list[str] = []
    show_vat_selector = False
    vat_modes: list[VATMode] = []
    default_vat_mode = VATMode(contract.vat_mode)
    include_timesheet_by_default = False
    timesheet_toggle_locked = False
    helper_texts: dict[str, str] = {}

    if performer_type == "employee":
        available_documents = ["SERVICE_ASSIGN"]
        if has_ip_transfer:
            available_documents.append("APP")
            helper_texts["pair_docs"] = "У служебных заданий автоматически формируется акт передачи прав, если в ТЗ есть ИС."
        default_documents = [available_documents[0]]
        hidden_sections = ["act", "vat"]
        include_timesheet_by_default = True
        timesheet_toggle_locked = True
        helper_texts["timesheet"] = "Для штатных сотрудников отчёт по часам формируется всегда."
    elif performer_type in {"gph", "individual"}:
        available_documents = ["AVR"]
        if has_ip_transfer:
            available_documents.append("APP")
        default_documents = ["AVR"]
        hidden_sections = ["vat"]
        include_timesheet_by_default = True
        helper_texts["vat"] = "Для физических лиц НДС не применяется."
        helper_texts["timesheet"] = "Таймшит добавляется в пакет автоматически."
    elif performer_type == "selfemployed":
        available_documents = ["AVR"]
        if has_ip_transfer:
            available_documents.append("APP")
        default_documents = ["AVR"]
        hidden_sections = ["vat"]
        include_timesheet_by_default = True
        required_fields.append("npd_receipt_confirmed")
        helper_texts["receipt"] = "Без подтверждения чека «Мой налог» акт не будет сформирован."
    else:  # ip / company
        available_documents = ["AVR"]
        if has_ip_transfer:
            available_documents.append("APP")
        default_documents = ["AVR"]
        show_vat_selector = True
        vat_modes = _base_vat_modes()
        include_timesheet_by_default = False
        helper_texts["vat"] = "Выберите ставку НДС: при 10% или 20% счёт-фактура добавится автоматически."

    if contract.vat_mode in {VATMode.VAT_10.value, VATMode.VAT_20.value} and "INVOICE" not in available_documents:
        available_documents.append("INVOICE")
        helper_texts["invoice"] = "Для выбранного режима НДС сформируется счёт-фактура."

    performer_rules = {
        key: PerformerRuleConfig(**value) for key, value in DOCUMENT_MASTER_VISIBILITY.items()
    }

    return ContractUiProfile(
        contract_id=contract.id,
        performer_type=performer_type,
        available_documents=available_documents,
        default_documents=default_documents,
        hidden_sections=hidden_sections,
        required_fields=required_fields,
        show_vat_selector=show_vat_selector,
        vat_modes=vat_modes,
        default_vat_mode=default_vat_mode,
        include_timesheet_by_default=include_timesheet_by_default,
        timesheet_toggle_locked=timesheet_toggle_locked,
        helper_texts=helper_texts,
        document_rules=performer_rules,
        current_rules=performer_rules.get(performer_type),
        rate_edit_rule=RATE_EDIT_RULE,
        grouping_rules=DOCUMENT_GROUPING_RULES,
    )
