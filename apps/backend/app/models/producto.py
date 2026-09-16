from datetime import datetime

from pydantic import Field

from app.models.common import ApiModel, now_utc


class ProductoCreate(ApiModel):
    codigo: str
    nombre: str


class Producto(ProductoCreate):
    id: str
    creado_at: datetime = Field(default_factory=now_utc)


class ProductoActualizar(ApiModel):
    nombre: str
