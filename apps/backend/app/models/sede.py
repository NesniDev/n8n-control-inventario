from datetime import datetime

from pydantic import Field

from app.models.common import ApiModel, now_utc


class SedeCreate(ApiModel):
    nombre: str
    codigo: str
    direccion: str = ""
    timezone: str = "America/Bogota"


class Sede(SedeCreate):
    id: str
    activa: bool = True
    created_at: datetime = Field(default_factory=now_utc)
