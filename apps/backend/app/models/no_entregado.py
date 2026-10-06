"""Unidades de un producto que NO se entregan (ver app/services/no_entregados.py).
Distinto de una devolucion: aqui nunca se entregaron (facturadas de mas o
equivocadas). Cada registro queda como su propia fila con motivo/quien."""

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class MotivoNoEntregado(StrEnum):
    """Lista fija -- mas facil de reportar/filtrar despues que texto libre."""

    FACTURADO_DE_MAS = "facturado_de_mas"
    PRODUCTO_EQUIVOCADO = "producto_equivocado"
    OTRO = "otro"


class NoEntregadoCreate(BaseModel):
    """Payload de POST /entregas/{entrega_id}/no-entregados."""

    item_id: str
    cantidad: int = Field(gt=0)
    motivo: MotivoNoEntregado
    # Texto libre: solo se exige (y se conserva) cuando motivo == "otro".
    motivo_detalle: str | None = None
    operador_id: str
    sede_id: str

    @model_validator(mode="after")
    def _validar_motivo_detalle(self) -> "NoEntregadoCreate":
        detalle = (self.motivo_detalle or "").strip()
        if self.motivo == MotivoNoEntregado.OTRO:
            if not detalle:
                raise ValueError("motivo_detalle es obligatorio cuando el motivo es 'otro'")
            self.motivo_detalle = detalle
        else:
            self.motivo_detalle = None
        return self
