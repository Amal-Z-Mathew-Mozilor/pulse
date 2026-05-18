"""Admin endpoint for the dynamic project registry."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from ..services import project_registry

router = APIRouter()


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    name: str
    description: str
    product_group: str
    is_inferred: bool
    created_at: datetime
    updated_at: datetime


class ProductGroupUpdate(BaseModel):
    product_group: str


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects():
    """All projects we've seen via webhooks (auto-registered)."""
    rows = await project_registry.list_projects()
    return [ProjectOut.model_validate(r) for r in rows]


@router.post("/projects/{project_key}/product-group", response_model=ProjectOut)
async def override_product_group(project_key: str, body: ProductGroupUpdate):
    """Manually override Claude's classification. Sets is_inferred=False so future
    bookkeeping knows the group was set by a human."""
    row = await project_registry.set_product_group(project_key, body.product_group)
    if row is None:
        raise HTTPException(404, f"project {project_key} not found — Pulse hasn't received a webhook for it yet")
    return ProjectOut.model_validate(row)
