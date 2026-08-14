from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class ApiModel(BaseModel):
    """Base comun para los modelos de request/response de la API."""

    model_config = ConfigDict(from_attributes=True)
