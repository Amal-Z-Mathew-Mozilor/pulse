"""Conversational query endpoint + legacy raw vector search.

The dashboard uses /api/ask — Claude decides which tools to call and writes a
prose response. /api/search is kept for backward compatibility / programmatic
use and returns raw vector matches.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents import query as query_agent
from ..db import get_session
from ..models import Feature
from ..schemas import FeatureOut, FeatureSearchHit, SearchRequest
from ..services.vector_store import get_store

router = APIRouter()


class AskRequest(BaseModel):
    message: str


class AskResponse(BaseModel):
    response: str
    tool_calls: list[dict]


@router.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest):
    result = await query_agent.run(body.message)
    return AskResponse(response=result.text or "(no response)", tool_calls=result.tool_calls)


@router.post("/search", response_model=list[FeatureSearchHit])
async def semantic_search(body: SearchRequest, db: AsyncSession = Depends(get_session)):
    """Raw vector search — for programmatic callers. The UI uses /api/ask instead."""
    filters = {k: v for k, v in (body.filters or {}).items() if v}

    if not body.query.strip():
        stmt = select(Feature).order_by(Feature.updated_at.desc())
        if "status" in filters:
            stmt = stmt.where(Feature.status == filters["status"])
        if "product_group" in filters:
            stmt = stmt.where(Feature.product_group == filters["product_group"])
        if "team" in filters:
            stmt = stmt.where(Feature.team == filters["team"])
        rows = (await db.execute(stmt.limit(body.top_k))).scalars().all()
        return [FeatureSearchHit(feature=FeatureOut.model_validate(r), score=1.0) for r in rows]

    matches = get_store().query_text(body.query, top_k=body.top_k, filter=filters or None)
    if not matches:
        return []
    feature_ids = [int(m.metadata["feature_id"]) for m in matches if "feature_id" in m.metadata]
    rows = (await db.execute(select(Feature).where(Feature.id.in_(feature_ids)))).scalars().all()
    by_id = {f.id: f for f in rows}
    hits: list[FeatureSearchHit] = []
    for m in matches:
        fid = m.metadata.get("feature_id")
        if fid is None:
            continue
        feature = by_id.get(int(fid))
        if feature is None:
            continue
        hits.append(FeatureSearchHit(feature=FeatureOut.model_validate(feature), score=m.score))
    return hits
