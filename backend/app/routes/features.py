from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session, session_scope
from ..models import AgentRun, Feature
from ..schemas import AgentRunOut, FeatureOut
from ..services.vector_store import get_store

router = APIRouter()


@router.get("/features", response_model=list[FeatureOut])
async def list_features(status: str | None = None, db: AsyncSession = Depends(get_session)):
    stmt = select(Feature).order_by(Feature.updated_at.desc())
    if status:
        stmt = stmt.where(Feature.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    return [FeatureOut.model_validate(r) for r in rows]


@router.get("/changelog", response_model=list[FeatureOut])
async def changelog(db: AsyncSession = Depends(get_session)):
    stmt = (
        select(Feature)
        .where(Feature.changelog.is_not(None))
        .order_by(Feature.updated_at.desc())
        .limit(50)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [FeatureOut.model_validate(r) for r in rows]


@router.get("/agent-runs", response_model=list[AgentRunOut])
async def list_agent_runs(limit: int = 20, db: AsyncSession = Depends(get_session)):
    stmt = select(AgentRun).order_by(AgentRun.started_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [AgentRunOut.model_validate(r) for r in rows]


class RestoreBody(BaseModel):
    reason: str | None = None


@router.post("/features/{feature_id}/restore", response_model=FeatureOut)
async def restore_feature(feature_id: int, body: RestoreBody | None = None):
    """Undo a deprecation. Sets status back to 'active', records the audit trail
    (restored_at + restored_reason), appends a line to the feature's changelog,
    and re-upserts the Pinecone vector with the active text (no [DEPRECATED] tag)."""
    reason = (body.reason if body else None) or "Manual restore via dashboard."
    async with session_scope() as db:
        feature = await db.get(Feature, feature_id)
        if feature is None:
            raise HTTPException(404, f"feature {feature_id} not found")
        if feature.status != "deprecated":
            raise HTTPException(
                409,
                f"feature {feature_id} is not deprecated (status='{feature.status}')",
            )

        now = datetime.now(timezone.utc)
        feature.status = "active"
        feature.deprecation_reason = None
        feature.restored_at = now
        feature.restored_reason = reason
        # Append a line to the feature's changelog so the Changelog tab reflects the restore.
        restore_line = f"- Restored {now.date().isoformat()} — {reason}"
        feature.changelog = (
            f"{feature.changelog}\n{restore_line}" if feature.changelog else restore_line
        )
        await db.flush()
        await db.refresh(feature)

        # Re-index in Pinecone with the active text (overwrite — no stale [DEPRECATED] vector)
        get_store().upsert_text(
            id=f"feature:{feature.id}",
            text=f"{feature.name}\n{feature.summary}",
            metadata={
                "feature_id": feature.id,
                "name": feature.name,
                "summary": feature.summary,
                "team": feature.team,
                "product_group": feature.product_group,
                "status": "active",
                "deprecation_reason": None,
                "ticket_key": feature.ticket_key,
            },
        )
        return FeatureOut.model_validate(feature)
