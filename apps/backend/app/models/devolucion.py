"""Devolucion de un producto ya entregado (ver app/services/devoluciones.py).
Un documento puede recibir mas de una devolucion en el tiempo -- cada una
queda como su propia fila, con motivo/resolucion/quien la registro."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class MotivoDevolucion(StrEnum):
    """Lista fija -- mas facil de reportar/filtrar despues que texto libre."""

    DANADO = "danado"
    EQUIVOCADO = "equivocado"
    VENCIDO = "vencido"
    NO_ERA_LO_PEDIDO = "no_era_lo_pedido"
    OTRO = "otro"


class ResolucionDevolucion(StrEnum):
    """reposicion: esa cantidad vuelve a quedar pendiente (se debe
    re-entregar el producto correcto). reembolso: se devuelve el dinero en
    vez de reponer -- la cantidad queda finalizada, no vuelve a pendiente.
    no_lo_lleva: el cliente no se lleva el producto -- mismo efecto en
    cantidades que reembolso (queda cerrada, no vuelve a pendiente)."""

    REPOSICION = "reposicion"
    REEMBOLSO = "reembolso"
    NO_LO_LLEVA = "no_lo_lleva"


class DevolucionCreate(BaseModel):
    """Payload de POST /entregas/{entrega_id}/devoluciones."""

    item_id: str
    cantidad: int = Field(gt=0)
    motivo: MotivoDevolucion
    resolucion: ResolucionDevolucion
    # Texto libre: solo se exige (y se conserva) cuando motivo == "otro".
    motivo_detalle: str | None = None
    operador_id: str
    sede_id: str

    @model_validator(mode="after")
    def _validar_motivo_detalle(self) -> "DevolucionCreate":
        detalle = (self.motivo_detalle or "").strip()
        if self.motivo == MotivoDevolucion.OTRO:
            if not detalle:
                raise ValueError("motivo_detalle es obligatorio cuando el motivo es 'otro'")
            self.motivo_detalle = detalle
        else:
            self.motivo_detalle = None
        return self


class Devolucion(BaseModel):
    id: str
    entrega_id: str
    item_id: str
    cantidad: int
    motivo: MotivoDevolucion
    resolucion: ResolucionDevolucion
    motivo_detalle: str | None = None
    operador_id: str
    sede_id: str
    creado_at: datetime
