"""Modelos del reporte de facturas faltantes: bodega avisa que una factura no
fue subida todavia por el mostrador (punto_venta) de la sede duena del tipo. Ver
app/services/facturas_faltantes.py.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, field_validator


class EstadoFacturaFaltante(StrEnum):
    PENDIENTE = "pendiente"
    RESUELTA = "resuelta"
    DESCARTADA = "descartada"


def _no_vacio(v: str) -> str:
    texto = v.strip()
    if not texto:
        raise ValueError("no puede estar vacio")
    return texto


class ReportarFacturaFaltante(BaseModel):
    tipo: str
    indicativo_numero: str
    empleado_id: str
    sede_id: str

    @field_validator("tipo", "indicativo_numero", "empleado_id", "sede_id")
    @classmethod
    def _campo_no_vacio(cls, v: str) -> str:
        return _no_vacio(v)


class DescartarFacturaFaltante(BaseModel):
    empleado_id: str

    @field_validator("empleado_id")
    @classmethod
    def _empleado_no_vacio(cls, v: str) -> str:
        return _no_vacio(v)


class FacturaFaltante(BaseModel):
    id: str
    tipo: str
    indicativo_numero: str
    sede_id: str  # sede destino (cuyo mostrador debe subirla)
    sede_reporta_id: str | None = None  # sede de quien reporto
    sede_nombre: str | None = None
    sede_reporta_nombre: str | None = None
    reportado_por: str
    reportado_por_nombre: str | None = None
    reportado_at: datetime
    estado: EstadoFacturaFaltante
    entrega_id: str | None = None
    cerrada_at: datetime | None = None
    cerrada_por: str | None = None
