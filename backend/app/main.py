import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routes import alerts, features, projects, search, webhooks
from .services.jira_client import close_jira_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    from sqlalchemy import select

    from .db import session_scope
    from .models import Feature
    from .services.vector_store import get_store, is_pinecone_active

    store = get_store()
    if is_pinecone_active():
        # Pinecone is durable — don't rehydrate every restart. Existing index
        # already has the vectors. Newly-stored features will be upserted on the fly.
        logging.getLogger(__name__).info("Pinecone active — skipping rehydration")
    else:
        # In-memory store is ephemeral, so rebuild it from SQLite on every boot.
        async with session_scope() as db:
            rows = (await db.execute(select(Feature))).scalars().all()
            for f in rows:
                text = f"{f.name}\n{f.summary}"
                if f.status == "deprecated" and f.deprecation_reason:
                    text += f"\n[DEPRECATED] {f.deprecation_reason}"
                store.upsert_text(
                    id=f"feature:{f.id}",
                    text=text,
                    metadata={
                        "feature_id": f.id,
                        "name": f.name,
                        "summary": f.summary,
                        "team": f.team,
                        "product_group": f.product_group,
                        "status": f.status,
                        "deprecation_reason": f.deprecation_reason,
                        "ticket_key": f.ticket_key,
                    },
                )
        logging.getLogger(__name__).info("in-memory vector store hydrated with %d features", store.size())
    try:
        yield
    finally:
        await close_jira_client()


settings = get_settings()

app = FastAPI(title="Pulse — Organizational Memory", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _status_payload():
    from .services.embeddings import is_local_model_available
    from .services.vector_store import is_pinecone_active

    return {
        "name": "pulse",
        "anthropic_configured": settings.has_anthropic,
        "local_embeddings_available": is_local_model_available(),
        "vector_store": "pinecone" if is_pinecone_active() else "in-memory",
        "jira_configured": settings.has_jira,
        "jira_webhook_secured": bool(settings.jira_webhook_secret),
        # Just the URL — never the credentials. Frontend uses this to build
        # /browse/<key> deep-links into Jira.
        "jira_base_url": settings.jira_base_url or None,
        "model": settings.claude_model,
    }


@app.get("/")
async def root():
    """Kept for direct backend checks (curl etc.) — same payload as /api/status."""
    return _status_payload()


@app.get("/api/status")
async def api_status():
    """Same payload as `/`, exposed under /api/* so the Vite dev-server proxy
    picks it up — avoids cross-origin CORS issues from the React frontend."""
    return _status_payload()


app.include_router(webhooks.router, prefix="", tags=["webhooks"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(features.router, prefix="/api", tags=["features"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
