from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, WorkspaceSession
from app.orm_models import (
    WorkspaceORM,
    UserORM,
    LegalEntityORM,
    IndividualORM,
    ContractORM,
    WorkPackageORM,
    DocumentRecordORM,
)
from app.services.documents import (
    list_documents,
    revoke_document_share,
    share_document_with_parent,
)
from app.workspace_scoping import setup_workspace_events


def _make_session_factory():
    engine = create_engine("sqlite:///:memory:", future=True)
    TestingSession = type("TestingSession", (WorkspaceSession,), {})
    setup_workspace_events(TestingSession)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False,
        future=True,
        class_=TestingSession,
    )


@pytest.fixture()
def session():
    factory = _make_session_factory()
    with factory() as session:
        yield session


@pytest.fixture()
def document_ctx(session):
    parent = WorkspaceORM(id="ws-parent", key="parent", name="Parent", kind="tenant")
    child = WorkspaceORM(id="ws-child", key="child", name="Child", kind="contractor", parent=parent)
    session.add_all([parent, child])

    user = UserORM(id="user-owner", email="owner@example.com", full_name="Owner", role="admin", password_hash="stub")
    session.add(user)

    legal = LegalEntityORM(
        id="client-1",
        workspace_id=child.id,
        name="Client",
        inn="1234567890",
        kpp="098765432",
        signatory="Signer",
        basis="Basis",
        status="complete",
    )
    contractor = IndividualORM(
        id="individual-1",
        workspace_id=child.id,
        name="Performer",
        inn="112233445566",
        passport="0000 111111",
        address="Earth",
        email="perf@example.com",
        status="complete",
    )

    contract = ContractORM(
        id="contract-1",
        workspace_id=child.id,
        number="CTR-1",
        client_id=legal.id,
        contractor_id=contractor.id,
        rate=100.0,
        rate_type="hour",
        currency="RUB",
        status="complete",
    )

    session.add_all([legal, contractor, contract])
    session.flush()

    def create_document(*, suffix: str = "1", status: str = "manager_approved") -> DocumentRecordORM:
        package = WorkPackageORM(
            id=f"wp-{suffix}",
            workspace_id=child.id,
            period="2024-01",
            project_key="PRJ",
            project_name="Project",
            contract_id=contract.id,
            client_id=legal.id,
            contractor_id=contractor.id,
            total_hours=10.0,
            total_amount=1000.0,
            hourly_rate=100.0,
            base_rate=100.0,
            rate_type="hour",
            include_timesheet=False,
            currency="RUB",
            performer_type="individual",
            vat_included=False,
            vat_percent=0.0,
            vat_amount=0.0,
            metadata_json={"taskSnapshots": []},
            task_snapshots=[],
        )
        session.add(package)

        document = DocumentRecordORM(
            id=f"doc-{suffix}",
            workspace_id=child.id,
            period="2024-01",
            type="Акт",
            format="pdf",
            status="Готов",
            include_timesheet=False,
            files=[],
            work_package_id=package.id,
            project_key="PRJ",
            project_name="Project",
            contract_id=contract.id,
            client_id=legal.id,
            contractor_id=contractor.id,
            total_hours=10.0,
            total_amount=1000.0,
            hourly_rate=100.0,
            base_rate=100.0,
            rate_type="hour",
            task_count=1,
            notes="",
            metadata_json={"taskSnapshots": []},
            performer_type="individual",
            vat_included=False,
            vat_percent=0.0,
            vat_amount=0.0,
            approval_status=status,
        )
        session.add(document)
        session.flush()
        return document

    session.flush()

    return SimpleNamespace(
        parent=parent,
        child=child,
        user=user,
        create_document=create_document,
    )


def test_share_document_makes_it_visible_for_parent(session, document_ctx):
    document = document_ctx.create_document()

    session.info["workspace_id"] = document_ctx.child.id
    session.info["workspace_scope"] = (document_ctx.child.id,)

    shared = share_document_with_parent(session, document.id, user=document_ctx.user)
    assert shared.sharedWithParent is True
    assert shared.sharedParentId == document_ctx.parent.id

    session.info["workspace_id"] = document_ctx.parent.id
    session.info["workspace_scope"] = (document_ctx.parent.id, document_ctx.child.id)

    visible = list_documents(session)
    assert any(item.id == document.id for item in visible)

    session.info["workspace_id"] = document_ctx.child.id
    session.info["workspace_scope"] = (document_ctx.child.id,)

    revoke_document_share(session, document.id)

    session.info["workspace_id"] = document_ctx.parent.id
    session.info["workspace_scope"] = (document_ctx.parent.id, document_ctx.child.id)
    visible_after = list_documents(session)
    assert all(item.id != document.id for item in visible_after)


def test_share_requires_approved_status(session, document_ctx):
    draft_document = document_ctx.create_document(suffix="draft", status="draft")

    session.info["workspace_id"] = document_ctx.child.id
    session.info["workspace_scope"] = (document_ctx.child.id,)

    with pytest.raises(ValueError):
        share_document_with_parent(session, draft_document.id, user=document_ctx.user)
