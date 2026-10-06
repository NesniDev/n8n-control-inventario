"""Unidades de un producto que NO se entregan (ver app/services/no_entregados.py).
Distinto de una devolucion: aqui nunca se entregaron (facturadas de mas o
equivocadas). Cada registro queda como su propia fila con motivo/quien."""

from enum import StrEnum

from pydantic import BaseModel, Field


class MotivoNoEntregado(StrEnum):
    """Lista fija -- mas facil de reportar/filtrar despues que texto libre."""

    FACTURADO_DE_MAS = "facturado_de_mas"
    PRODUCTO_EQUIVOCADO = "producto_equivocado"
    SIN_EXISTENCIA = "sin_existencia"
    OTRO = "otro"


class NoEntregadoCreate(BaseModel):
    """Payload de POST /entregas/{entrega_id}/no-entregados."""

    item_id: str
    cantidad: int = Field(gt=0)
    motivo: MotivoNoEntregado
    operador_id: str
    sede_id: str
