from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base, WorkspaceSession
from backend.app.orm_models import UserORM
from backend.app.services.workspaces import (
    WorkspaceRole,
    WorkspaceKind,
    accept_workspace_invite,
    can_assign_role,
    create_workspace,
    create_workspace_invite,
    ensure_membership,
    list_workspace_members,
    remove_workspace_member,
    update_membership_role,
)
from backend.app.workspace_scoping import setup_workspace_events


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


def _make_user(session, email: str, *, role: str = "manager") -> UserORM:
    user = UserORM(
        email=email,
        full_name=email,
        role=role,
        password_hash="stub",
    )
    session.add(user)
    session.flush()
    return user


@pytest.fixture()
def owner(session):
    return _make_user(session, "owner@example.com", role="admin")


@pytest.fixture()
def workspace(session, owner):
    return create_workspace(
        session,
        owner=owner,
        name="Tenant Workspace",
        kind=WorkspaceKind.tenant,
    )


def test_create_invite_reuses_pending_record(session, workspace, owner):
    invite = create_workspace_invite(
        session,
        workspace,
        email="member@example.com",
        role=WorkspaceRole.member,
        inviter=owner,
    )
    assert invite.role == WorkspaceRole.member.value

    refreshed = create_workspace_invite(
        session,
        workspace,
        email="member@example.com",
        role=WorkspaceRole.admin,
        inviter=owner,
    )
    assert refreshed.id == invite.id
    assert refreshed.role == WorkspaceRole.admin.value


def test_create_invite_rejects_existing_member(session, workspace, owner):
    member = _make_user(session, "member@example.com")
    ensure_membership(session, user=member, workspace=workspace, role=WorkspaceRole.member.value)

    with pytest.raises(ValueError):
        create_workspace_invite(
            session,
            workspace,
            email="member@example.com",
            role=WorkspaceRole.member,
            inviter=owner,
        )


def test_cannot_downgrade_last_owner(session, workspace, owner):
    membership = ensure_membership(session, user=owner, workspace=workspace, role=WorkspaceRole.owner.value)

    with pytest.raises(ValueError):
        update_membership_role(session, membership, WorkspaceRole.member)

    with pytest.raises(ValueError):
        remove_workspace_member(session, membership)


def test_accept_invite_assigns_membership(session, workspace, owner):
    guest = _make_user(session, "guest@example.com")
    invite = create_workspace_invite(
        session,
        workspace,
        email="guest@example.com",
        role=WorkspaceRole.admin,
        inviter=owner,
    )

    membership = accept_workspace_invite(session, token=invite.token, user=guest)
    assert membership.workspace_id == workspace.id
    assert membership.user_id == guest.id
    assert membership.role == WorkspaceRole.admin.value

    members = list_workspace_members(session, workspace.id)
    assert any(m.user_id == guest.id for m in members)


@pytest.mark.parametrize(
    ("actor", "target", "expected"),
    [
        (WorkspaceRole.owner, WorkspaceRole.admin, True),
        (WorkspaceRole.admin, WorkspaceRole.owner, False),
        (WorkspaceRole.admin, WorkspaceRole.member, True),
        (WorkspaceRole.viewer, WorkspaceRole.member, False),
    ],
)
def test_can_assign_role_rules(actor, target, expected):
    assert can_assign_role(actor, target) is expected
