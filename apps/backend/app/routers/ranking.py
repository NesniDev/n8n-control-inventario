"""Ranking de productos mas/menos vendidos en un rango de fechas -- agrega
en Python (ver app/services/ranking.py) a partir de las filas crudas de
entrega_items, sin agregacion en SQL.
"""

from datetime import datetime

from fastapi import APIRouter

from app.db import get_pool
from app.models.ranking import RankingProductosResponse
from app.services.ranking import calcular_ranking_productos

router = APIRouter(prefix="/ranking", tags=["ranking"])


@router.get("/productos", response_model=RankingProductosResponse)
async def ranking_productos(
    desde: datetime,
    hasta: datetime,
    sede_id: str | None = None,
    limit: int = 15,
) -> RankingProductosResponse:
    pool = await get_pool()
    consulta = """
        select i.descripcion, i.cantidad_entregada, i.entrega_id
        from entrega_items i
        join entregas e on e.id = i.entrega_id
        where e.capturado_at >= $1 and e.capturado_at <= $2
          and e.estado != 'duplicado_bloqueado'
    """
    parametros: list = [desde, hasta]
    if sede_id is not None:
        consulta += " and e.sede_origen_id = $3"
        parametros.append(sede_id)

    filas = await pool.fetch(consulta, *parametros)
    mas_vendidos, menos_vendidos = calcular_ranking_productos(filas, limit)

    return RankingProductosResponse(
        desde=desde,
        hasta=hasta,
        sede_id=sede_id,
        mas_vendidos=mas_vendidos,
        menos_vendidos=menos_vendidos,
    )
