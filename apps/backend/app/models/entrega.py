from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class EstadoEntrega(StrEnum):
    PROCESADA = "procesada"
    PENDIENTE_REVISION = "pendiente_revision"
    DUPLICADO_BLOQUEADO = "duplicado_bloqueado"


class TipoDocumento(StrEnum):
    """Factura (FEI), traslado entre bodegas (TB) o remision (RM3/RM2)."""

    FEI = "FEI"
    TB = "TB"
    RM3 = "RM3"
    RM2 = "RM2"


class EntregaCreate(BaseModel):
    """Payload que envia la app movil tras subir la foto a Storage."""

    evidencia_url: str
    hash_evidencia: str
    sede_origen_id: str
    operador_id: str
    capturado_at: datetime
    # La ingresa el bodeguero a mano al momento de la captura — manda sobre
    # lo que la IA de vision llegue a leer en el documento para este campo
    # (ver app/routers/entregas.py: procesar_entrega). cantidad_entregada en
    # cambio sigue saliendo de la extraccion por IA.
    cantidad_pendiente: int


class EntregaRevision(BaseModel):
    """Payload para corregir/aprobar una entrega en 'pendiente_revision' desde
    el dashboard. Solo se envian los campos que un supervisor corrigio."""

    tipo: TipoDocumento | None = None
    indicativo_numero: str | None = None
    cantidad_entregada: int | None = None
    cantidad_pendiente: int | None = None
    revisado_por: str = "supervisor"
