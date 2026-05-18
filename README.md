# Pulse — AI Organizational Memory Platform

A multi-agent organizational memory platform. Claude-powered agents watch Jira
workflows, semantically understand company knowledge across product groups, detect
duplicate implementations, track deprecations, generate documentation, and proactively
warn teams about overlapping work.

```
Jira webhook
    │
    ▼
FastAPI ─► Orchestrator (router)
              │
              ├─► Duplicate Agent      (Claude + tools)
              ├─► Documentation Agent  (Claude + tools)
              └─► Deprecation Agent    (Claude + tools)
                                │
                                ▼
                   Pinecone-shaped vector store
                   SQLite (Postgres-ready) DB
                   Mocked Jira API
```

## What's mocked vs. real

| Component | Mode |
|---|---|
| Claude reasoning (Anthropic API) | **Real** — `claude-opus-4-7` with adaptive thinking, tool-calling. Falls back to a deterministic stub if `ANTHROPIC_API_KEY` is missing. |
| Embeddings | **Local** — `sentence-transformers/all-MiniLM-L6-v2` runs on your machine, no API key needed. First run downloads ~90MB to `~/.cache/`. Hash-based bag-of-words is the last-resort fallback if the local model can't load. |
| Pinecone | **Real Pinecone** if `PINECONE_API_KEY` is set (serverless index auto-created with dim=384, cosine). Falls back to an in-memory store with the same interface if the key is missing. |
| Jira REST API | **Real Jira Cloud.** Webhook payloads from `POST /jira/webhook` are normalized (ADF → text) and routed by the orchestrator. Comments are posted back via the Jira v3 REST API authenticated with `JIRA_EMAIL` + `JIRA_API_TOKEN`. |
| PostgreSQL | **SQLite by default**, swap `DATABASE_URL` to use Postgres. |

## Quick start

```bash
# ─── Backend ───────────────────────────────────────────
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY. Embeddings run locally; no other key needed.

python -m seed                                 # load example features
uvicorn app.main:app --reload --port 8000

# ─── Frontend (in a second terminal) ───────────────────
cd frontend
npm install
npm run dev                                    # http://localhost:5173
```

Open http://localhost:5173 — the **Simulator** tab is the demo entry point. Hit
one of the preset buttons (e.g. "Duplicate test — Failed payment recovery") and
watch the agent run land in the panel below, plus a comment on the mocked Jira
ticket, plus an alert in the Alerts tab.

## What each agent does

- **Duplicate Detection Agent** — On `issue_created`, semantically searches the
  vector store, reasons about whether matches are real duplicates (vs.
  superficially-similar work), and either posts a Jira comment + creates an
  alert, or asks a clarifying question, or does nothing if the new work is
  genuinely novel.
- **Documentation Agent** — On `issue_updated` → Done, reads the ticket,
  distills a 2–4 sentence feature summary, generates a changelog entry, and
  stores it in organizational memory (DB + vector store).
- **Deprecation Agent** — On a deprecation-flagged ticket, finds the matching
  feature(s), marks them deprecated with a reason, and surfaces a high-severity
  alert. Future duplicate searches will see the deprecation and flag
  reuse attempts.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/jira/webhook?token=…` | Real Jira Cloud webhook entrypoint (secret-validated) |
| `POST` | `/api/ask` | Conversational query agent (Claude + tools) |
| `POST` | `/api/search` | Raw vector search (programmatic) |
| `GET` | `/api/features?status=…` | List features |
| `GET` | `/api/changelog` | Auto-generated changelog |
| `GET` | `/api/alerts` | Alert feed |
| `GET` | `/api/agent-runs` | Agent execution log |
| `GET` | `/api/projects` | Auto-discovered Jira project registry |
| `POST` | `/api/projects/{KEY}/product-group` | Manually override Claude's classification |

## Setting up real Jira Cloud + ngrok

You'll need:

1. **An Atlassian API token.** Go to
   [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   → *Create API token*. Copy it now — Atlassian doesn't show it again.
2. **Three projects** with the keys `WEBT`, `COOK`, `WEBY` (or adjust
   `JIRA_PROJECT_KEYS` in `.env` to whatever keys you use).
3. **A random shared secret** for the webhook. Something like:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

Add to `backend/.env`:
```
JIRA_BASE_URL=https://yourdomain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=ATATT3xF...
JIRA_WEBHOOK_SECRET=<the random secret>
```

No `JIRA_PROJECT_KEYS` env var — Pulse processes webhooks from every project and
auto-registers each one on first sighting (Claude infers the product group from
the project's name and description).

Start the backend, then expose it with ngrok:

```bash
# Terminal 1
.venv/bin/uvicorn app.main:app --port 8000

# Terminal 2
ngrok http 8000
```

ngrok will print a public HTTPS URL like `https://abc-123.ngrok-free.app`.

**Configure the webhook in Jira:**

1. Jira → *Settings* (gear icon) → *System* → *WebHooks* → *Create a WebHook*
2. URL:
   ```
   https://abc-123.ngrok-free.app/jira/webhook?token=<your JIRA_WEBHOOK_SECRET>
   ```
3. JQL scope (optional but recommended):
   ```
   project in (WEBT, COOK, WEBY)
   ```
4. Events: tick **Issue created**, **Issue updated**, **Issue deleted**
5. Save.

**Verify it's wired up:**

- Create a test ticket in WEBT. The backend log should show
  `webhook jira:issue_created on WEBT-N (WEBT) — '...'` and the *Jira & Agents*
  tab should show a new agent run for the Duplicate Detection Agent.
- Move the ticket to *Done*. The Documentation Agent should fire, persist a
  feature record, and the new entry should appear in *Changelog*.
- Open the ticket in Jira — a bot comment from `pulse-bot` should be there if
  the agent decided to post one.

**Common gotchas:**

- ngrok free tier gives you a new URL on every restart. Update the Jira webhook
  config when the URL changes.
- `JIRA_WEBHOOK_SECRET` must be in the URL exactly as `?token=<secret>`.
  Mismatches return `401 invalid webhook secret`.
- Projects are auto-discovered — no allowlist. New projects are registered on
  their first webhook with a Claude-inferred product group. Visit the Jira &
  Agents tab to view or override the classification.

## Stub-mode caveats

When `ANTHROPIC_API_KEY` is missing, the system falls back to a deterministic
stub LLM so the whole pipeline runs end-to-end. The stub follows a few hardcoded
heuristics (search → threshold → comment + alert) instead of doing real
reasoning. Set the key for the production-fidelity experience.

Embeddings run locally regardless, so retrieval quality is consistent whether
or not Claude is configured.

## Project → Product Group mapping (dynamic)

There is no hardcoded allowlist or static map. The first time a webhook fires
for an unseen project, Pulse:

1. Fetches the project's metadata from Jira (`GET /rest/api/3/project/{key}`).
2. Calls Claude with the project name + description + the set of product groups
   already in use, asking it to pick an existing label or propose a new one.
3. Persists the answer in the `projects` table.

The mapping is visible (and editable) in the **Jira & Agents** tab and via:

```
GET  /api/projects
POST /api/projects/{KEY}/product-group   { "product_group": "WebToffee" }
```

Manual overrides flip `is_inferred=false` so the registry never re-classifies
human-set values.

Each ticket's **components** (e.g. `stripe-plugin`, `auth-platform`) flow into
both the cached ticket record and any feature the Documentation Agent creates,
so cross-team duplicate detection works at the module level too.

## Production swap-outs

- **Real Pinecone:** Already wired up — set `PINECONE_API_KEY` in `.env`. The index
  is auto-created on first run (configurable via `PINECONE_INDEX`, `PINECONE_CLOUD`,
  `PINECONE_REGION`). When active, `app.main.lifespan` skips the in-memory
  rehydration step (Pinecone persists across restarts).
- **Real Jira:** Already wired up — see *Setting up real Jira Cloud + ngrok*
  above. The client is in `backend/app/services/jira_client.py`; webhook
  normalization is in `backend/app/services/jira_event.py`.
- **Postgres:** Set `DATABASE_URL=postgresql+asyncpg://user:pass@host/db` in
  `.env` and add `asyncpg` to `requirements.txt`. No schema changes needed.

## Notes on the Claude integration

- Model: `claude-opus-4-7`.
- `thinking: {type: "adaptive"}` is on for every agent so Claude decides when to
  reason longer.
- The agent system prompts are cached (`cache_control: ephemeral`) — agents reuse
  the same role/instructions across many ticket events, so prompt caching pays
  for itself within the first few invocations.
- The tool-calling loop is implemented manually in
  `app/services/claude_client.py` so every tool call is logged to the
  `agent_runs` table (visible in the Simulator panel for transparency).
- Tool implementations live in `app/tools/registry.py`. Add a new tool by
  defining a `ToolSpec` there and including it in the relevant agent's
  `TOOLS` list.
