from datetime import datetime

from app.models.common import ApiModel


class RankingProductoItem(ApiModel):
    codigo: str | None
    nombre: str
    cantidad_total: int
    entregas_count: int


class RankingProductosResponse(ApiModel):
    desde: datetime
    hasta: datetime
    sede_id: str | None
    mas_vendidos: list[RankingProductoItem]
    menos_vendidos: list[RankingProductoItem]
