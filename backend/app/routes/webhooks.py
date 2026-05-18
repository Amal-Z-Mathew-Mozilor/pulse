"""Real Jira Cloud webhook endpoint.

POST /jira/webhook?token=<JIRA_WEBHOOK_SECRET>

Two safeguards:

1. **Idempotency.** Jira retries delivery if our endpoint doesn't return 2xx
   within ~10 seconds. Agent runs take much longer (multiple Claude calls), so
   without dedup the same event fires the agents multiple times. We hash
   (ticket_key, event_type, payload_timestamp) into an event_id and persist it
   in `processed_events`. Subsequent deliveries of the same logical event
   short-circuit and return 200 immediately.

2. **Async dispatch.** Even with dedup, we don't want Jira's connection sitting
   open while Claude reasons. The orchestrator is fired off as a FastAPI
   BackgroundTask so the webhook returns within milliseconds.
"""

from __future__ import annotations

import hashlib
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import select

from ..agents import orchestrator
from ..config import get_settings
from ..db import session_scope
from ..models import ProcessedEvent
from ..services.jira_event import normalize_event

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/jira/webhook")
async def jira_webhook(request: Request, background_tasks: BackgroundTasks):
    settings = get_settings()

    # 1. Shared-secret validation.
    if settings.jira_webhook_secret:
        token = request.query_params.get("token", "")
        if token != settings.jira_webhook_secret:
            log.warning(
                "rejected webhook: bad/missing token from %s",
                request.client.host if request.client else "?",
            )
            raise HTTPException(status_code=401, detail="invalid webhook secret")
    else:
        log.warning("JIRA_WEBHOOK_SECRET is empty — webhook is open to anyone who finds the URL")

    # 2. Parse + normalize the payload.
    payload = await request.json()
    event = normalize_event(payload)
    if event is None:
        log.warning("rejected webhook: payload missing issue.key")
        raise HTTPException(status_code=400, detail="malformed Jira payload")

    # 3. Idempotency check. Jira's `timestamp` is stable across retries, so we
    # hash that together with the ticket key and event type. Different logical
    # events (e.g. two separate edits) get different timestamps and process
    # independently. Retries of the same delivery get deduped.
    payload_ts = int(payload.get("timestamp") or 0)
    basis = f"{event['ticket_key']}|{event['event_type']}|{payload_ts}"
    event_id = hashlib.sha256(basis.encode()).hexdigest()[:32]

    async with session_scope() as db:
        existing = (
            await db.execute(select(ProcessedEvent).where(ProcessedEvent.event_id == event_id))
        ).scalar_one_or_none()
        if existing:
            log.info(
                "dedup: %s %s ts=%s already processed at %s — skipping",
                event["event_type"], event["ticket_key"], payload_ts, existing.received_at.isoformat(),
            )
            return {"deduped": True, "event_id": event_id}
        db.add(
            ProcessedEvent(
                event_id=event_id,
                ticket_key=event["ticket_key"],
                event_type=event["event_type"],
                payload_timestamp=payload_ts,
            )
        )

    log.info(
        "webhook %s on %s (%s) — '%s'  [event_id=%s]",
        event["event_type"], event["ticket_key"], event["project"],
        (event["summary"] or "")[:80], event_id,
    )

    # 4. Hand off to the orchestrator in the background — Jira gets a fast 200.
    background_tasks.add_task(orchestrator.handle_event, event)

    return {"accepted": True, "event_id": event_id}
