"""Vector store layer.

Two implementations behind one interface:

- `PineconeVectorStore` — real Pinecone serverless index. Auto-creates the index
  on first run with the right dimension (matches MiniLM = 384) and cosine metric.
- `InMemoryVectorStore` — Python dict + brute-force cosine. Used when
  `PINECONE_API_KEY` isn't set so the demo still runs without a Pinecone account.

`get_store()` picks one based on settings. Same upsert/query/delete signature so
nothing else in the codebase needs to know which is active.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..config import get_settings
from . import embeddings as emb

log = logging.getLogger(__name__)


@dataclass
class VectorMatch:
    id: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)


class VectorStore(Protocol):
    def upsert(self, id: str, vector: list[float], metadata: dict[str, Any] | None = None) -> None: ...
    def upsert_text(self, id: str, text: str, metadata: dict[str, Any] | None = None) -> None: ...
    def delete(self, id: str) -> None: ...
    def query(self, vector: list[float], top_k: int = 5, filter: dict[str, Any] | None = None) -> list[VectorMatch]: ...
    def query_text(self, text: str, top_k: int = 5, filter: dict[str, Any] | None = None) -> list[VectorMatch]: ...
    def size(self) -> int: ...


# ---------- In-memory implementation (fallback) ----------

class InMemoryVectorStore:
    def __init__(self) -> None:
        self._vectors: dict[str, list[float]] = {}
        self._metadata: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def upsert(self, id: str, vector: list[float], metadata: dict[str, Any] | None = None) -> None:
        with self._lock:
            self._vectors[id] = vector
            self._metadata[id] = metadata or {}

    def upsert_text(self, id: str, text: str, metadata: dict[str, Any] | None = None) -> None:
        vector = emb.embed_one(text, input_type="document")
        self.upsert(id, vector, metadata)

    def delete(self, id: str) -> None:
        with self._lock:
            self._vectors.pop(id, None)
            self._metadata.pop(id, None)

    def query(
        self,
        vector: list[float],
        top_k: int = 5,
        filter: dict[str, Any] | None = None,
    ) -> list[VectorMatch]:
        with self._lock:
            items = list(self._vectors.items())
            metadata_snapshot = dict(self._metadata)

        results: list[VectorMatch] = []
        for vid, vec in items:
            meta = metadata_snapshot.get(vid, {})
            if filter and not _matches_filter(meta, filter):
                continue
            score = emb.cosine(vector, vec)
            results.append(VectorMatch(id=vid, score=score, metadata=meta))
        results.sort(key=lambda m: m.score, reverse=True)
        return results[:top_k]

    def query_text(self, text: str, top_k: int = 5, filter: dict[str, Any] | None = None) -> list[VectorMatch]:
        vector = emb.embed_one(text, input_type="query")
        return self.query(vector, top_k=top_k, filter=filter)

    def size(self) -> int:
        return len(self._vectors)


def _matches_filter(meta: dict[str, Any], filter: dict[str, Any]) -> bool:
    for k, v in filter.items():
        if isinstance(v, dict) and "$in" in v:
            if meta.get(k) not in v["$in"]:
                return False
        elif meta.get(k) != v:
            return False
    return True


# ---------- Pinecone implementation ----------

class PineconeVectorStore:
    """Wraps a Pinecone serverless index. The MiniLM model emits 384-dim vectors;
    the index is auto-created with that dimension and cosine metric the first time."""

    DIMENSION = 384  # matches sentence-transformers/all-MiniLM-L6-v2

    def __init__(self) -> None:
        from pinecone import Pinecone, ServerlessSpec

        settings = get_settings()
        self._pc = Pinecone(api_key=settings.pinecone_api_key)
        self._index_name = settings.pinecone_index

        existing = {ix["name"]: ix for ix in self._pc.list_indexes()}
        if self._index_name not in existing:
            log.info("Pinecone: creating index %s (dim=%d, metric=cosine, %s/%s)",
                     self._index_name, self.DIMENSION, settings.pinecone_cloud, settings.pinecone_region)
            self._pc.create_index(
                name=self._index_name,
                dimension=self.DIMENSION,
                metric="cosine",
                spec=ServerlessSpec(cloud=settings.pinecone_cloud, region=settings.pinecone_region),
            )
        else:
            # Validate the pre-existing index matches our embedding dimension. Otherwise
            # every upsert will 400 with "Vector dimension X does not match the dimension
            # of the index Y" — better to fail fast at startup with a clear message.
            ix_dim = existing[self._index_name].get("dimension")
            if ix_dim and int(ix_dim) != self.DIMENSION:
                raise RuntimeError(
                    f"Pinecone index '{self._index_name}' has dimension {ix_dim}, but "
                    f"this app embeds at dimension {self.DIMENSION} (MiniLM). "
                    f"Either delete the index in the Pinecone console and let the app "
                    f"recreate it, or set PINECONE_INDEX to a fresh name in .env."
                )
        self._index = self._pc.Index(self._index_name)
        log.info("Pinecone: connected to index %s", self._index_name)

    @staticmethod
    def _clean_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
        """Pinecone metadata values must be string, number, bool, or list[str].
        Drop None values; coerce others where useful."""
        if not metadata:
            return {}
        out: dict[str, Any] = {}
        for k, v in metadata.items():
            if v is None:
                continue
            if isinstance(v, (str, int, float, bool)):
                out[k] = v
            elif isinstance(v, list) and all(isinstance(x, str) for x in v):
                out[k] = v
            else:
                out[k] = str(v)
        return out

    def upsert(self, id: str, vector: list[float], metadata: dict[str, Any] | None = None) -> None:
        self._index.upsert(vectors=[{
            "id": id,
            "values": vector,
            "metadata": self._clean_metadata(metadata),
        }])

    def upsert_text(self, id: str, text: str, metadata: dict[str, Any] | None = None) -> None:
        vector = emb.embed_one(text, input_type="document")
        self.upsert(id, vector, metadata)

    def delete(self, id: str) -> None:
        self._index.delete(ids=[id])

    def query(
        self,
        vector: list[float],
        top_k: int = 5,
        filter: dict[str, Any] | None = None,
    ) -> list[VectorMatch]:
        resp = self._index.query(
            vector=vector,
            top_k=top_k,
            include_metadata=True,
            filter=filter or None,
        )
        matches = []
        for m in resp.matches:
            matches.append(VectorMatch(
                id=m.id,
                score=float(m.score),
                metadata=dict(m.metadata) if m.metadata else {},
            ))
        return matches

    def query_text(self, text: str, top_k: int = 5, filter: dict[str, Any] | None = None) -> list[VectorMatch]:
        vector = emb.embed_one(text, input_type="query")
        return self.query(vector, top_k=top_k, filter=filter)

    def size(self) -> int:
        stats = self._index.describe_index_stats()
        return int(stats.total_vector_count or 0)


# ---------- factory ----------

_store: VectorStore | None = None


def get_store() -> VectorStore:
    global _store
    if _store is not None:
        return _store
    settings = get_settings()
    if settings.has_pinecone:
        try:
            _store = PineconeVectorStore()
            return _store
        except Exception as exc:
            log.warning("Pinecone init failed (%s) — falling back to in-memory store", exc)
    _store = InMemoryVectorStore()
    return _store


def is_pinecone_active() -> bool:
    """Distinguishes 'asked for Pinecone and got it' from 'fell back to in-memory'."""
    store = get_store()
    return isinstance(store, PineconeVectorStore)
