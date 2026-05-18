from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FeatureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    summary: str
    team: str
    product_group: str
    components: list[str] = Field(default_factory=list)
    status: str
    deprecation_reason: str | None = None
    ticket_key: str | None = None
    dependencies: list[str] = Field(default_factory=list)
    changelog: str | None = None
    restored_at: datetime | None = None
    restored_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class FeatureSearchHit(BaseModel):
    feature: FeatureOut
    score: float


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    project: str
    summary: str
    description: str
    status: str
    team: str
    product_group: str
    components: list[str] = Field(default_factory=list)
    comments: list[dict] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: str
    severity: str
    title: str
    message: str
    ticket_key: str | None = None
    related_feature_id: int | None = None
    related_features: list[dict] = Field(default_factory=list)
    approval_state: str | None = None
    action_log: list[dict] = Field(default_factory=list)
    created_at: datetime
    read_at: datetime | None = None


class RelatedFeatureOut(BaseModel):
    feature: FeatureOut
    similarity_score: float | None = None
    open_in_jira_url: str | None = None


class AgentRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    agent: str
    ticket_key: str | None = None
    input_summary: str
    output_summary: str
    tool_calls: list[dict] = Field(default_factory=list)
    started_at: datetime
    finished_at: datetime | None = None


class SearchRequest(BaseModel):
    query: str = ""
    top_k: int = 5
    # Optional metadata filters applied to the vector-store results.
    # Example: {"product_group": "WebYes", "status": "active"}
    filters: dict[str, str] | None = None


