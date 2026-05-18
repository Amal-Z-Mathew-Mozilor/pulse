from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    """A Jira project we've seen at least once. Auto-registered on first webhook.

    `product_group` is set either by Claude (on first sighting) or manually via the
    admin endpoint. The hardcoded WebToffee/CookieYes/WebYes map is gone — this is
    now the single source of truth.
    """

    __tablename__ = "projects"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)  # e.g. "WEBT"
    name: Mapped[str] = mapped_column(String(256), default="")     # e.g. "WebToffee"
    description: Mapped[str] = mapped_column(Text, default="")
    product_group: Mapped[str] = mapped_column(String(128), default="", index=True)
    is_inferred: Mapped[bool] = mapped_column(Boolean, default=True)  # False if user overrode
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Feature(Base):
    """An organizational capability — a feature, plugin, or module that exists in the codebase."""

    __tablename__ = "features"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(256), index=True)
    summary: Mapped[str] = mapped_column(Text)
    team: Mapped[str] = mapped_column(String(128), index=True)
    product_group: Mapped[str] = mapped_column(String(64), index=True)  # CookieYes / WebToffee / WebYes
    components: Mapped[list[str]] = mapped_column(JSON, default=list)  # Jira components — sub-modules
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)  # active | deprecated
    deprecation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    ticket_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    dependencies: Mapped[list[str]] = mapped_column(JSON, default=list)
    changelog: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set when a deprecated feature is manually restored via /api/features/{id}/restore.
    # Audit trail — never cleared on subsequent state changes.
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Ticket(Base):
    """A Jira ticket we've observed via webhook. Mocked source in dev."""

    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    project: Mapped[str] = mapped_column(String(64), index=True)
    summary: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(64), default="To Do")
    team: Mapped[str] = mapped_column(String(128), default="")
    product_group: Mapped[str] = mapped_column(String(64), default="")
    components: Mapped[list[str]] = mapped_column(JSON, default=list)
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    comments: Mapped[list[dict]] = mapped_column(JSON, default=list)
    # Set by the deprecation agent's PREVIEW mode so APPLY mode can diff
    # candidate sets against what was previewed. Shape:
    # {"at": ISO, "same_product": [{"ticket_key":..., "similarity_score":...}],
    #  "cross_product": [...] }
    last_deprecation_preview: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Alert(Base):
    """A smart alert surfaced to the dashboard."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(32), index=True)  # duplicate | deprecation | dependency | info
    severity: Mapped[str] = mapped_column(String(16), default="medium")  # low | medium | high
    title: Mapped[str] = mapped_column(String(256))
    message: Mapped[str] = mapped_column(Text)
    ticket_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    related_feature_id: Mapped[int | None] = mapped_column(ForeignKey("features.id"), nullable=True)
    # Structured references to features mentioned in this alert. Each entry:
    # {"ticket_key": "WEBT-5", "similarity_score": 0.82} — score optional.
    # The /api/alerts/{id}/related-features endpoint uses this when populated;
    # otherwise it falls back to regex-scanning the message for ticket keys.
    related_features: Mapped[list[dict]] = mapped_column(JSON, default=list)
    # For action-requiring alert types (currently only `pending_deprecation`):
    # null = N/A, 'pending' = awaiting human decision, 'resolved' = action taken,
    # 'rejected' = explicitly declined.
    approval_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Audit log of human/agent actions on this alert. Each entry:
    # {"at": ISO, "action": "approve_partial"|"approve_all"|"reject"|..., "details": {...}}
    action_log: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    related_feature: Mapped[Feature | None] = relationship(Feature, lazy="selectin")


class ProcessedEvent(Base):
    """Webhook dedup table. Jira retries delivery if our endpoint doesn't 2xx
    fast enough (~10s timeout). The Jira payload's `timestamp` is stable across
    retries, so (ticket_key, event_type, timestamp) is a reliable dedup key."""

    __tablename__ = "processed_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ticket_key: Mapped[str] = mapped_column(String(64), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload_timestamp: Mapped[int] = mapped_column(Integer, default=0)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentRun(Base):
    """Audit log of every agent invocation — useful for the demo and debugging."""

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent: Mapped[str] = mapped_column(String(64), index=True)
    ticket_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    input_summary: Mapped[str] = mapped_column(Text)
    output_summary: Mapped[str] = mapped_column(Text, default="")
    tool_calls: Mapped[list[dict]] = mapped_column(JSON, default=list)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
