from __future__ import annotations

from datetime import datetime, timezone

from ..db import session_scope
from ..models import AgentRun
from ..services.claude_client import AgentResult, ToolSpec, run_agent


async def run_and_log(
    *,
    agent_name: str,
    ticket_key: str | None,
    system: str,
    user_message: str,
    tools: list[ToolSpec],
    max_iterations: int = 6,
) -> AgentResult:
    async with session_scope() as db:
        log = AgentRun(
            agent=agent_name,
            ticket_key=ticket_key,
            input_summary=user_message[:2000],
        )
        db.add(log)
        await db.flush()
        log_id = log.id

    result = await run_agent(
        system=system,
        user_message=user_message,
        tools=tools,
        max_iterations=max_iterations,
    )

    async with session_scope() as db:
        log = await db.get(AgentRun, log_id)
        if log:
            log.output_summary = result.text[:4000] if result.text else ""
            log.tool_calls = result.tool_calls
            log.finished_at = datetime.now(timezone.utc)

    return result
