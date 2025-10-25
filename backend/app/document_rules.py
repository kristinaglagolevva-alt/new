from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal, TypedDict

FieldMode = Literal["hidden", "readonly", "editable"]
FieldVisibility = Literal["hidden", "optional", "required"]


class FieldRule(TypedDict, total=False):
    mode: FieldMode
    visibility: FieldVisibility
    tooltip: str | None
    default: bool | None


class PerformerRule(TypedDict, total=False):
    docs: List[str]
    vatMode: FieldMode
    rate: FieldRule
    normHours: FieldRule
    timesheet: FieldRule
    extraFlags: Dict[str, bool]


DOCUMENT_MASTER_VISIBILITY: Dict[str, PerformerRule] = {
    "employee": {
        "docs": ["SERVICE_ASSIGN", "IPR"],
        "vatMode": "hidden",
        "rate": {
            "mode": "hidden",
            "tooltip": "Для трудовых отношений денежные акты не формируются. Доступны служебное задание и акт передачи прав.",
        },
        "normHours": {"mode": "hidden"},
        "timesheet": {
            "mode": "readonly",
            "visibility": "required",
            "tooltip": "Для штатных сотрудников таймшит формируется автоматически.",
            "default": True,
        },
        "extraFlags": {
            "allowMonetaryActs": False,
            "requireNpdReceipt": False,
        },
    },
    "gph": {
        "docs": ["AVR", "IPR"],
        "vatMode": "hidden",
        "rate": {
            "mode": "editable",
            "tooltip": "Редактирование доступно только когда выбран 1 исполнитель, 1 проект и 1 договор.",
        },
        "normHours": {
            "mode": "readonly",
            "visibility": "optional",
        },
        "timesheet": {
            "mode": "editable",
            "visibility": "optional",
            "default": True,
        },
        "extraFlags": {
            "allowMonetaryActs": True,
            "requireNpdReceipt": False,
        },
    },
    "selfemployed": {
        "docs": ["AVR", "IPR"],
        "vatMode": "hidden",
        "rate": {
            "mode": "editable",
            "tooltip": "Редактирование доступно только когда выбран 1 исполнитель, 1 проект и 1 договор.",
        },
        "normHours": {
            "mode": "readonly",
            "visibility": "optional",
        },
        "timesheet": {
            "mode": "editable",
            "visibility": "optional",
            "default": True,
        },
        "extraFlags": {
            "allowMonetaryActs": True,
            "requireNpdReceipt": True,
        },
    },
    "ip": {
        "docs": ["AVR", "IPR"],
        "vatMode": "readonly",
        "rate": {
            "mode": "editable",
            "tooltip": "Редактирование доступно только когда выбран 1 исполнитель, 1 проект и 1 договор.",
        },
        "normHours": {
            "mode": "readonly",
            "visibility": "optional",
        },
        "timesheet": {
            "mode": "editable",
            "visibility": "optional",
        },
        "extraFlags": {
            "allowMonetaryActs": True,
            "requireNpdReceipt": False,
        },
    },
    "company": {
        "docs": ["AVR", "IPR", "INVOICE"],
        "vatMode": "editable",
        "rate": {
            "mode": "editable",
            "tooltip": "Редактирование доступно только когда выбран 1 исполнитель, 1 проект и 1 договор.",
        },
        "normHours": {
            "mode": "readonly",
            "visibility": "optional",
        },
        "timesheet": {
            "mode": "editable",
            "visibility": "optional",
        },
        "extraFlags": {
            "allowMonetaryActs": True,
            "requireNpdReceipt": False,
        },
    },
}

RATE_EDIT_RULE = "singlePerson && singleProject && singleContract && type!='employee'"

RATE_LOCK_TOOLTIP = (
    "Редактирование доступно только когда выбран 1 исполнитель, 1 проект и 1 договор."
)

DOCUMENT_GROUPING_RULES = {
    "groupKey": [
        "performerId",
        "contractId",
        "period",
        "docType",
        "vatMode",
        "currency",
        "projectId?",
    ],
    "projectSplitRule": "contract.act_by_projects == True",
}

DOCUMENT_TOOLTIPS = {
    "vat": "Ставка НДС определяется договором. Изменение доступно только для юрлиц.",
    "npd": "Для оформления акта по НПД требуется чек приложения “Мой налог”.",
    "split": "Разный режим НДС/валюта/проект → документы будут сформированы раздельно.",
    "employee": "Для трудовых отношений денежные акты не формируются. Доступны служебное задание и акт передачи прав.",
}

VALIDATION_MESSAGES = {
    "multiple_individuals": "Акт для нескольких исполнителей запрещён. Выберите одного исполнителя.",
    "contract_expired": "Продлите договор перед формированием документов.",
    "missing_npd_receipt": "Без чека НПД акт не будет сформирован.",
    "mixed_vat": "Задачи с разным режимом НДС формируются в отдельных документах.",
    "employee_monetary": "Для штатников денежные акты не формируются.",
}


@dataclass(frozen=True)
class RateGuardContext:
    performer_type: str
    performers: int
    projects: int
    contracts: int

    def is_rate_editable(self) -> bool:
        if self.performer_type == "employee":
            return False
        return self.performers == 1 and self.projects == 1 and self.contracts == 1


__all__ = [
    "DOCUMENT_MASTER_VISIBILITY",
    "RATE_EDIT_RULE",
    "RATE_LOCK_TOOLTIP",
    "DOCUMENT_GROUPING_RULES",
    "DOCUMENT_TOOLTIPS",
    "VALIDATION_MESSAGES",
    "RateGuardContext",
]
