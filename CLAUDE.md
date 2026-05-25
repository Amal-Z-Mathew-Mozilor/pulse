# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Pulse** — multi-agent organizational memory platform. Claude-powered agents watch Jira workflows, detect duplicate work across teams, track deprecations, generate documentation, and proactively warn teams about overlap. FastAPI backend + React/Vite frontend. Postgres (was SQLite; see the migration script). Real Anthropic API and real Jira Cloud integration (with deterministic stub fallbacks if keys are absent).

See `README.md` for the user-facing setup walkthrough, including Atlassian token + ngrok configuration.

## Repo layout — three independent git repos (read this first)

This working directory looks like a monorepo but isn't. There are **three separate git repositories**, each with its own GitHub remote, and committing to one does not move the others:

| Path | Remote | Deploys to |
|---|---|---|
| `Pulse/` (outer) | (snapshot tracker; not auto-deployed) | nothing |
| `Pulse/backend/` | `github.com/Amal-Z-Mathew-Mozilor/pulse-backend.git` | **Railway** (web + worker services) |
| `Pulse/frontend/` | `github.com/Amal-Z-Mathew-Mozilor/pulse-frontend.git` | **Vercel** |

The outer monorepo's `git status` will look clean even when `backend/` has uncommitted changes — the nested `.git` directories hide each other. **Before believing a fix is deployed, `cd backend && git status && git log --oneline -1` (and same in `frontend/`).** A backend-only change must be committed and pushed from inside `backend/`; same for frontend.

Railway has two services from the backend repo's `Procfile`: `web` (uvicorn) and `worker` (procrastinate). A push triggers both, but they redeploy independently — expect ~2-3 minutes for `web` and another 3-5 min for `worker`. While the worker is on the old code, freshly-dispatched jobs run with stale agent/tool code even though the API serves the new code.

## Commands

```bash
# Backend (in backend/)
source .venv/bin/activate
pip install -r requirements.txt              # picks up asyncpg + cryptography + procrastinate
python -m seed                                # load example features
uvicorn app.main:app --reload --port 8000

# Procrastinate worker (second terminal, also from backend/ with the venv active).
# Required for the production dispatch path. If procrastinate can't connect
# (DB unreachable, missing schema), the API silently falls back to FastAPI
# BackgroundTasks and you don't need this.
PYTHONPATH=. procrastinate --app=app.worker.app worker

# Frontend (in frontend/)
npm install
npm run dev                                   # http://localhost:5173

# Sanity checks
python -m py_compile <file>                   # backend syntax
cd frontend && npx tsc --noEmit               # frontend type check

# SQLite → Postgres migration (one-shot)
python backend/migrate_sqlite_to_postgres.py \
  --source sqlite+aiosqlite:///./backend/pulse.db \
  --target postgresql+asyncpg://USER:PASS@HOST:5432/DBNAME
```

There is no formal test suite. Verify changes by running uvicorn and exercising the relevant endpoint with `curl` or via the frontend. For UI work, start the dev server and use the feature in a browser — TS type checks and a clean compile are not a substitute.

## High-level architecture

```
   Jira Cloud
     │  webhook
     ▼
   /jira-webhook/{account_id}        ◄── per-account, preferred (Phase 3)
   /jira/webhook                     ◄── legacy alias (resolved by secret)
     │  normalize_event()
     ▼
   Orchestrator (app/agents/orchestrator.py)
     │  ┌── Duplicate Agent       (issue_created)
     ├──┤   Documentation Agent   (issue_updated → Done)
     │  └── Deprecation Agent     (deprecation-flagged tickets)
     ▼
   Tool registry (app/tools/registry.py)
     │  search_similar_features · store_feature · list_features
     │  get_feature · add_jira_comment · create_alert · ...
     ▼
   Vector store (Pinecone OR in-memory) + Postgres
```

The four agents (`duplicate`, `documentation`, `deprecation`, `query`) all share the same skeleton:
1. System prompt declared at module top with `cache_control: ephemeral`.
2. `TOOLS` list — `ToolSpec` instances from `app/tools/registry.py`.
3. `run(...)` calls `app/agents/base.run_and_log()` which drives the Claude tool-calling loop and logs every tool call into the `agent_runs` table.

The "query" agent powers `POST /api/ask` (the chatbot) and runs the same loop with a different system prompt + tool subset.

## Multi-account architecture (load-bearing)

Pulse can connect to N Jira workspaces. Each is a `JiraAccount` row with encrypted credentials. **Don't bypass the account-aware code paths** — see `app/services/jira_accounts.py` and the `jira_account_id` columns on `Project`, `Ticket`, `Feature`.

Phase 1 (schema), Phase 2 (admin UI), Phase 3 (per-account webhook routing) all shipped. Open work documented inline:
- **`Project.key` is still the PK** — two accounts sharing the same project key will currently collide. Migrate to `UNIQUE(jira_account_id, key)` when a second workspace is actually added (deferred Phase 1.5).
- **Product groups are global across accounts** — `CookieYes` in account A and in account B are the same memory bucket. Intentional; do not scope per-account without explicit user direction.

### How an event flows through the system

1. **Webhook arrives** at `/jira-webhook/{account_id}?token=<secret>` (or legacy `/jira/webhook`). Handler in `app/routes/webhooks.py` validates both the path account_id and the secret, then stamps `event["jira_account_id"]` and dispatches `orchestrator.handle_event` as a FastAPI BackgroundTask. Idempotency hash includes account_id.
2. **Orchestrator** (`app/agents/orchestrator.py`) calls `project_registry.get_or_register(project_key, jira_account_id=...)`. The classifier in `_infer_product_group()` is **deterministic** — word-boundary prefix matching, no LLM. Anything beyond that pattern proposes a new product group.
3. **Project + product_group resolved.** Ticket is upserted into the local cache with `jira_account_id` set. Then the orchestrator routes to the right agent(s) based on event type.
4. **Agents use tools** to search the vector store, fetch ticket data, post Jira comments, create alerts, mark features deprecated, etc. Every tool call is persisted to `agent_runs`.

### Default-account fallback

`services/jira_accounts.get_default_account()` returns the row flagged `is_default=True`, falling back to the first active account. Callers that pre-date the multi-account refactor (the legacy webhook URL, some admin tooling) use this fallback. New code should accept and thread through an explicit account.

## Job queue (webhook dispatch)

Webhook handlers don't run agents inline — they enqueue them.

```
POST /jira-webhook/{account_id}    (FastAPI, returns 200 immediately)
       │
       │  services/dispatcher.dispatch_event(event, request, background_tasks)
       ▼
   ┌── Procrastinate (Postgres LISTEN/NOTIFY) ──► Worker process
   │                                                  │  procrastinate --app=app.worker.app worker
   │                                                  ▼
   │                                              orchestrator.handle_event(event)
   │                                                  │
   │                                                  ▼
   │                                              agents + tools
   │
   └── (fallback) FastAPI BackgroundTasks if procrastinate init failed
```

`app/services/dispatcher.py` is the single decision point — webhook handlers
call `dispatch_event()` and don't care which backend is wired up. The procrastinate
`App` is opened in `main.lifespan` and attached to `app.state.queue`. Procrastinate
uses Postgres (`procrastinate_jobs` table + LISTEN/NOTIFY) — no Redis. The session
pooler is required for LISTEN/NOTIFY (set `PROCRASTINATE_DATABASE_URL` to the
port-5432 URL; the main app can stay on the transaction pooler at 6543).

The worker is a long-running process that imports the same modules as the API
(`app/worker.py`). On Railway it's a **separate service** from the API — both
deploy from the same git push but redeploy independently, so a fresh push may
have new API code running against old worker code for a few minutes.

When debugging a stuck event, check three things in order:
1. The webhook handler's response had `"dispatch": {"mode": "procrastinate", "job_id": ...}`.
2. The worker terminal shows the job being picked up.
3. The `agent_runs` table shows the agent execution.

If `mode` is `background_tasks` instead of `procrastinate`, the queue pool failed
to open — check the API process boot log for the procrastinate init warning.

## Critical conventions

**Never log or return Jira API tokens.** They're stored as Fernet ciphertext (`api_token` column on `JiraAccount`). The `JiraAccountOut` schema exposes only `has_token: bool` — never the value. `decrypt_token()` only runs server-side to build the auth tuple for httpx. Same rule for `webhook_secret`.

**The encryption key lives in `.pulse_encryption_key`** (gitignored) next to the SQLite DB, OR in `PULSE_ENCRYPTION_KEY` env var. Losing it makes stored tokens unreadable.

**`processed_events.payload_timestamp` is `BigInteger`.** Jira sends ms-epoch timestamps that exceed int32. SQLite silently allowed `Integer`; Postgres rejected them. Don't downgrade.

**`set_product_group()` cascades.** When a project's group label changes, every Ticket and Feature under the project (matched by `Ticket.project == key` / `Feature.ticket_key LIKE "{key}-%"`) is updated AND re-upserted into the vector store with corrected metadata. Don't manually update `Project.product_group` outside this function.

**The classifier is deterministic word-boundary matching, not an LLM call.** `_infer_product_group()` in `project_registry.py`. This replaced an LLM-based classifier that over-merged (e.g. "CookieEat" → "CookieYes"). Keep it deterministic.

**Sync deletion is fully driven by Jira state.** `sync_from_jira()` removes a project from Pulse if it disappears from Jira's `/rest/api/3/project/search` response. There's no manual "Delete project" UI; the user explicitly didn't want one. Features under a deleted project are preserved (`ON DELETE SET NULL` on `Feature.jira_account_id`) — they represent org memory worth keeping.

**Features survive account deletion.** `JiraAccount` deletion cascades to `Project` and `Ticket` (CASCADE), but Features get `jira_account_id` set to NULL (SET NULL). The `_existing_product_groups()` helper unions labels from both `projects` and `features` tables so the chatbot can still find historical groups after their project disappears. Historical groups are surfaced with a `(historical)` tag in the query agent's prompt.

**Webhook secret routing.** Each account has a unique `webhook_secret`. The Phase 3 route at `/jira-webhook/{account_id}` validates both path AND token. The legacy `/jira/webhook` is a back-compat alias that reverse-looks-up the account by secret and falls back to the default account.

**Optimistic concurrency on state changes.** Functions that flip a feature's lifecycle (`_mark_feature_deprecated`, `restore_feature`) use conditional `UPDATE ... WHERE status = :original_status` rather than ORM attribute mutation. If the row was modified by a concurrent writer between read and write, the UPDATE matches zero rows and the function returns `concurrent_modification` (tool) or 409 (HTTP) instead of silently clobbering. Don't downgrade these to plain ORM mutation — the race was real, not theoretical.

**Request-scoped state lives in context vars.** `org_id_var` and `jira_account_id_var` in `app/context.py` are set by `agents/base.run_and_log()` so tool handlers can stamp the right tenant + Jira account on writes without threading the IDs through every call site. When adding a tool that creates a row owned by an org/account (e.g. `_store_feature`), read both vars and write them to the row's foreign keys; otherwise the row ends up orphaned and the "features survive account deletion" semantics break in reverse (features are born orphaned).

**Additive migrations are a hand-curated list, not Alembic.** `_ADDITIVE_MIGRATIONS` in `app/db.py` only ALTERs the columns explicitly listed. `Base.metadata.create_all` builds new tables but won't add a new column to an existing one. When adding a column to an existing model, **also add the (table, column, sql_type) tuple to that list**, or fresh Postgres deployments will boot with the column missing and the relevant UPDATE will throw at runtime. (Today the `jira_accounts.last_sync_*` columns happen to exist in deployed Supabase from a clean `create_all`, but they aren't in the migration list — latent risk.)

## Adding new endpoints

- Public (no auth): mount under `/auth/*` or `/jira-webhook/*`.
- Authenticated users: mount under `/api/*` — `app/main.py` applies `Depends(get_current_user)` to every router added with `dependencies=_api_auth`.
- Admin-only: add `_admin: User = Depends(get_current_admin)` to each handler. See `app/routes/jira_accounts.py` for the pattern.

## Adding new agent tools

1. Implement an async handler in `app/tools/registry.py` taking `args: dict[str, Any]` and returning a JSON-serializable dict.
2. Wrap it in a `ToolSpec(name, description, input_schema, handler)`.
3. Add the spec to the relevant agent's `TOOLS` list (e.g. `app/agents/duplicate.py`).
4. The agent's system prompt should reference the tool by name — write the prompt assuming the exact tool name is stable.
5. If the tool **persists a row scoped to an org or Jira account**, read `org_id_var` and `jira_account_id_var` from `app/context.py` and stamp the values on the row (and on vector store metadata). Use `_store_feature` as the reference implementation. Forgetting either leaves the row orphaned and cross-tenant queries miss it.
6. If you add an agent that should propagate the Jira account context (because its tools eventually call account-scoped writes), update the agent's `run(...)` signature to accept `jira_account_id` and forward it to `run_and_log(...)`. Same pattern as `organization_id`. The orchestrator already has the value on `event["jira_account_id"]`.

## Frontend conventions

- TS strict mode is on. Run `npx tsc --noEmit` after changes.
- `frontend/src/api.ts` is the single typed client — every endpoint goes through `http<T>()` which handles auth headers and 401 redirects.
- `frontend/src/App.tsx` is the sidebar + tab router. Admin-only tabs use `adminOnly: true` and are filtered via `user.is_admin`.
- Components do their own polling (4s for Jira & Agents, 8s for notifications, 10s for status). No global state library.

## When in doubt

- The `README.md` is the user-facing setup guide; this file is the developer-facing handover.
- Re-read the system-of-systems diagram above before refactoring orchestrator / agent flow.
- Migration is non-trivial — `backend/migrate_sqlite_to_postgres.py` is the canonical example for table-by-table copy with sequence reset.
- Trust the deterministic classifier over the LLM for product-group decisions. The LLM was the source of an over-merging bug that took multiple sessions to fully eradicate.
