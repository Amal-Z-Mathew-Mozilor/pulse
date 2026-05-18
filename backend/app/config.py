from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    database_url: str = "sqlite+aiosqlite:///./pulse.db"
    claude_model: str = "claude-opus-4-7"
    cors_origins: str = "http://localhost:5173"

    # Pinecone — if PINECONE_API_KEY is set we use real Pinecone, else in-memory.
    pinecone_api_key: str = ""
    pinecone_index: str = "pulse-features"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"

    # Jira Cloud integration. Projects are discovered dynamically from incoming
    # webhooks — there is no hardcoded allowlist. The first time we see a project,
    # we fetch its metadata from Jira and ask Claude to assign a product group.
    jira_base_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""
    jira_webhook_secret: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def has_pinecone(self) -> bool:
        return bool(self.pinecone_api_key)

    @property
    def has_jira(self) -> bool:
        return bool(self.jira_base_url and self.jira_email and self.jira_api_token)


@lru_cache
def get_settings() -> Settings:
    return Settings()
