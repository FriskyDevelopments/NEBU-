"""
Database models using SQLAlchemy 2.x ORM.

Mirrors the schema defined in infrastructure/db/migrations/001_initial.sql.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class GitHubInstallationModel(Base):
    __tablename__ = "github_installations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    github_installation_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    account_login: Mapped[str] = mapped_column(Text, nullable=False)
    account_type: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    repositories: Mapped[list["RepositoryModel"]] = relationship(back_populates="installation")


class RepositoryModel(Base):
    __tablename__ = "repositories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    installation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("github_installations.id"), nullable=False
    )
    github_repo_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    owner: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    default_branch: Mapped[Optional[str]] = mapped_column(Text)
    is_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    language_summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    installation: Mapped["GitHubInstallationModel"] = relationship(back_populates="repositories")
    snapshots: Mapped[list["RepositorySnapshotModel"]] = relationship(back_populates="repository")
    tasks: Mapped[list["TaskModel"]] = relationship(back_populates="repository")


class RepositorySnapshotModel(Base):
    __tablename__ = "repository_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id"), nullable=False
    )
    commit_sha: Mapped[str] = mapped_column(Text, nullable=False)
    tree_sha: Mapped[Optional[str]] = mapped_column(Text)
    snapshot_status: Mapped[str] = mapped_column(Text, nullable=False, default="queued")
    file_count: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    repository: Mapped["RepositoryModel"] = relationship(back_populates="snapshots")
    files: Mapped[list["RepositoryFileModel"]] = relationship(back_populates="snapshot")
    facts: Mapped[list["ArchitectureFactModel"]] = relationship(back_populates="snapshot")


class RepositoryFileModel(Base):
    __tablename__ = "repository_files"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "path", name="uq_repo_file_snapshot_path"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repository_snapshots.id"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    file_type: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[Optional[str]] = mapped_column(Text)
    size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger)
    content_ref: Mapped[Optional[str]] = mapped_column(Text)
    hash_sha256: Mapped[str] = mapped_column(Text, nullable=False)

    snapshot: Mapped["RepositorySnapshotModel"] = relationship(back_populates="files")
    chunks: Mapped[list["CodeChunkModel"]] = relationship(back_populates="file")


class ArchitectureFactModel(Base):
    __tablename__ = "architecture_facts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repository_snapshots.id"), nullable=False
    )
    fact_type: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    object: Mapped[Optional[str]] = mapped_column(Text)
    attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_file_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repository_files.id")
    )
    confidence: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)

    snapshot: Mapped["RepositorySnapshotModel"] = relationship(back_populates="facts")


class CodeChunkModel(Base):
    __tablename__ = "code_chunks"
    __table_args__ = (
        UniqueConstraint("file_id", "chunk_index", name="uq_code_chunk_file_idx"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repository_files.id"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_ref: Mapped[Optional[str]] = mapped_column(Text)
    tokens: Mapped[Optional[int]] = mapped_column(Integer)

    file: Mapped["RepositoryFileModel"] = relationship(back_populates="chunks")


class TaskModel(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id"), nullable=False
    )
    snapshot_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repository_snapshots.id")
    )
    task_type: Mapped[str] = mapped_column(Text, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="queued")
    requested_by: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    repository: Mapped["RepositoryModel"] = relationship(back_populates="tasks")
    reports: Mapped[list["ReportModel"]] = relationship(back_populates="task")


class ReportModel(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False
    )
    report_type: Mapped[str] = mapped_column(Text, nullable=False)
    markdown_content: Mapped[str] = mapped_column(Text, nullable=False)
    artifact_ref: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    task: Mapped["TaskModel"] = relationship(back_populates="reports")


class WebhookEventModel(Base):
    __tablename__ = "webhook_events"
    __table_args__ = (
        UniqueConstraint("delivery_id", name="uq_webhook_delivery_id"),
        UniqueConstraint("raw_body_sha256", name="uq_webhook_raw_body_sha256"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    installation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("github_installations.id")
    )
    event_name: Mapped[str] = mapped_column(Text, nullable=False)
    delivery_id: Mapped[str] = mapped_column(Text, nullable=False)
    raw_body_sha256: Mapped[Optional[str]] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
