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


class SedeActualizar(ApiModel):
    """Campos editables de una sede -- el codigo no se edita (lo usan otras
    partes como identificador estable). Solo se actualiza lo que viene."""

    nombre: str | None = None
    direccion: str | None = None
    activa: bool | None = None
