from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class EstadoEntrega(StrEnum):
    PROCESADA = "procesada"
    PENDIENTE_REVISION = "pendiente_revision"
    DUPLICADO_BLOQUEADO = "duplicado_bloqueado"


class ItemEntrega(BaseModel):
    descripcion: str
    cantidad: int = 1


class EntregaCreate(BaseModel):
    """Payload que envia la app movil tras subir la foto a Storage."""

    evidencia_url: str
    hash_evidencia: str
    sede_origen_id: str
    operador_id: str
    capturado_at: datetime
