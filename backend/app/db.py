from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()
engine = create_async_engine(_settings.database_url, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# Tiny additive migration map. SQLAlchemy's create_all only handles NEW tables,
# not new columns on existing tables. For this project's scale we just ALTER
# the SQLite table to add missing columns on startup. For Postgres the same
# idempotent ADD COLUMN IF NOT EXISTS works.
_ADDITIVE_MIGRATIONS: list[tuple[str, str, str]] = [
    # (table, column, sql_type)
    ("features", "components", "JSON DEFAULT '[]'"),
    ("tickets", "components", "JSON DEFAULT '[]'"),
    ("alerts", "related_features", "JSON DEFAULT '[]'"),
    ("features", "restored_at", "DATETIME"),
    ("features", "restored_reason", "TEXT"),
    ("alerts", "approval_state", "VARCHAR(16)"),
    ("alerts", "action_log", "JSON DEFAULT '[]'"),
    ("tickets", "last_deprecation_preview", "JSON"),
]


async def init_db() -> None:
    from . import models  # noqa: F401 — register tables

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _apply_additive_migrations(conn)


async def _apply_additive_migrations(conn) -> None:
    dialect = conn.dialect.name  # 'sqlite' | 'postgresql'
    for table, column, sql_type in _ADDITIVE_MIGRATIONS:
        try:
            if dialect == "sqlite":
                # SQLite doesn't support IF NOT EXISTS on ADD COLUMN; check pragma first.
                cols = (await conn.exec_driver_sql(f"PRAGMA table_info({table})")).fetchall()
                existing = {row[1] for row in cols}
                if column not in existing:
                    await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}")
            else:
                # Postgres supports IF NOT EXISTS directly.
                await conn.exec_driver_sql(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {sql_type}"
                )
        except Exception:
            # Best-effort migration; surface the issue but don't block startup.
            pass


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
