from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Conexion directa (no pooler transaccional) — el backend mantiene su
    # propio pool de asyncpg de larga duracion, asi que no necesita PgBouncer
    # en modo transaction. Ver POSTGRES_URL_NON_POOLING en Supabase.
    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"

    openai_api_key: str = ""
    # GPT-5.6 Luna: mas barato/rapido de la familia 5.6, alcanza de sobra para
    # extraer campos estructurados de una guia legible. GPT-4o esta en retiro
    # por parte de OpenAI, dejo de ser el default seguro.
    vision_model: str = "gpt-5.6-luna"

    # Supabase Storage — solo la usa scripts/setup_storage.py (provisioning),
    # el backend web no toca Storage directamente. La app movil sube con la
    # anon key (ver apps/mobile/supabase.ts).
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Lista separada por comas — permite el dashboard en prod (Vercel) y el
    # dashboard local (localhost:3000) al mismo tiempo mientras se sigue
    # desarrollando contra el backend ya desplegado.
    dashboard_origin: str = "http://localhost:3000"

    @property
    def dashboard_origins(self) -> list[str]:
        return [o.strip() for o in self.dashboard_origin.split(",") if o.strip()]

    # Confianza minima por campo obligatorio antes de auto-aprobar una entrega.
    min_confidence: float = 0.75


@lru_cache
def get_settings() -> Settings:
    return Settings()
