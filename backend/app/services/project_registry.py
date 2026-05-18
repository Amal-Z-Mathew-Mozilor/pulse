"""Dynamic Jira project registry.

When a webhook for a new project arrives, we:
  1. Fetch the project's metadata from Jira (name, description, lead, etc.)
  2. Ask Claude to assign it a `product_group` — either an existing one or a new
     short label inferred from the project name/description.
  3. Persist the mapping in the `projects` table so we never re-pay this cost.

Failure modes:
  - Jira not configured / project not found → fall back to the project key as
    both name and product_group.
  - Claude not configured → use the project name (or key) as product_group.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select

from ..config import get_settings
from ..db import session_scope
from ..models import Project
from . import jira_client

log = logging.getLogger(__name__)


async def get_or_register(project_key: str) -> Project:
    """Return the Project row for `project_key`, creating it (and inferring a
    product group) on first sighting."""
    project_key = project_key.upper()
    async with session_scope() as db:
        existing = (
            await db.execute(select(Project).where(Project.key == project_key))
        ).scalar_one_or_none()
        if existing:
            return existing

    log.info("project registry: first sighting of '%s' — registering", project_key)

    jira_data = await _fetch_jira_project_meta(project_key)
    name = (jira_data or {}).get("name") or project_key
    description = (jira_data or {}).get("description") or ""

    existing_groups = await _existing_product_groups()
    product_group = await _infer_product_group(project_key, name, description, existing_groups)

    async with session_scope() as db:
        # Double-check in case a concurrent webhook beat us to it.
        existing = (
            await db.execute(select(Project).where(Project.key == project_key))
        ).scalar_one_or_none()
        if existing:
            return existing
        row = Project(
            key=project_key,
            name=name,
            description=description[:4000] if description else "",
            product_group=product_group,
            is_inferred=True,
        )
        db.add(row)
        await db.flush()
        await db.refresh(row)
        log.info(
            "project registry: registered %s → %s (existing groups=%s)",
            project_key, product_group, existing_groups,
        )
        return row


async def list_projects() -> list[Project]:
    async with session_scope() as db:
        rows = (await db.execute(select(Project).order_by(Project.key))).scalars().all()
        return list(rows)


async def set_product_group(project_key: str, product_group: str) -> Project | None:
    """Manual override — flips `is_inferred` to False so we don't try to re-infer."""
    project_key = project_key.upper()
    async with session_scope() as db:
        row = (
            await db.execute(select(Project).where(Project.key == project_key))
        ).scalar_one_or_none()
        if row is None:
            return None
        row.product_group = product_group
        row.is_inferred = False
        await db.flush()
        await db.refresh(row)
        return row


# ----------------- internals -----------------

async def _fetch_jira_project_meta(project_key: str) -> dict[str, Any] | None:
    """Hit Jira's /rest/api/3/project/{key}. Returns None on any failure."""
    client = jira_client.get_jira_client()
    if client is None:
        log.warning("project registry: Jira not configured — skipping metadata fetch for %s", project_key)
        return None
    try:
        # The Jira client only exposes get_issue + add_comment + search today.
        # Inline the project call here rather than expanding the public surface
        # for one consumer.
        import httpx
        settings = get_settings()
        async with httpx.AsyncClient(
            auth=(settings.jira_email, settings.jira_api_token),
            timeout=15.0,
            headers={"Accept": "application/json"},
        ) as h:
            r = await h.get(f"{settings.jira_base_url.rstrip('/')}/rest/api/3/project/{project_key}")
            if r.status_code != 200:
                log.warning("project registry: Jira returned %d for %s", r.status_code, project_key)
                return None
            return r.json()
    except Exception as exc:
        log.warning("project registry: Jira fetch failed for %s: %s", project_key, exc)
        return None


async def _existing_product_groups() -> list[str]:
    """Distinct product groups currently in use across the projects table."""
    async with session_scope() as db:
        rows = (
            await db.execute(select(Project.product_group).where(Project.product_group != ""))
        ).all()
        return sorted({r[0] for r in rows if r[0]})


async def _infer_product_group(
    project_key: str,
    name: str,
    description: str,
    existing_groups: list[str],
) -> str:
    """Ask Claude to assign a product group, falling back to a heuristic if Claude
    isn't configured."""
    settings = get_settings()
    if not settings.has_anthropic:
        return _heuristic_product_group(project_key, name)

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    system = (
        "You classify Jira projects into product groups for an organizational memory platform. "
        "A product group is the human-readable umbrella a project belongs to (e.g. 'WebToffee', "
        "'CookieYes', 'WebYes', 'Platform Infrastructure'). "
        "Given a project's key, display name, and description, "
        "either pick an EXISTING product group from the list (preferred when there's an obvious match) "
        "or propose a SHORT new one (1–3 words). "
        "Reply with ONLY a single JSON object matching this exact shape: "
        '{"product_group": "<label>", "is_new": <true|false>, "rationale": "<one short sentence>"}. '
        "Do NOT wrap in markdown code fences or include any prose."
    )
    user = (
        f"Project to classify:\n"
        f"  key:         {project_key}\n"
        f"  name:        {name}\n"
        f"  description: {description[:1500] or '(none)'}\n\n"
        f"Existing product groups: {existing_groups or '(none yet)'}"
    )

    try:
        resp = await client.messages.create(
            model=settings.claude_model,
            max_tokens=300,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = next((b.text for b in resp.content if b.type == "text"), "").strip()
        data = _parse_classification_json(text)
        chosen = (data.get("product_group") or "").strip()
        if not chosen:
            raise ValueError("empty product_group")
        log.info(
            "Claude classified %s as '%s' (is_new=%s): %s",
            project_key, chosen, data.get("is_new"), str(data.get("rationale", ""))[:120],
        )
        return chosen
    except Exception as exc:
        log.warning("Claude classification failed for %s: %s — using heuristic", project_key, exc)
        return _heuristic_product_group(project_key, name)


def _parse_classification_json(text: str) -> dict[str, Any]:
    """Tolerate a stray markdown fence around the JSON, since some prompts produce one."""
    t = text.strip()
    if t.startswith("```"):
        # Strip ```json ... ``` or ``` ... ```
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[: -3]
    return json.loads(t.strip())


def _heuristic_product_group(project_key: str, name: str) -> str:
    """Cheap fallback: use the project name's first word, title-cased."""
    if name:
        first = name.split()[0]
        return first[:64].title() if first else project_key
    return project_key
