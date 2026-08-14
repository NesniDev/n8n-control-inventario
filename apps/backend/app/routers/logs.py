"""Consulta de la tabla de auditoria (append-only). Ver Figura 1: cada paso
del pipeline escribe aqui; este router solo expone lectura para el
dashboard de trazabilidad.
"""

from fastapi import APIRouter

from app.db import get_pool

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("")
async def listar_logs(
    entidad_id: str | None = None,
    sede_id: str | None = None,
    limit: int = 100,
) -> list[dict]:
    pool = await get_pool()
    condiciones = []
    valores: list = []

    if entidad_id:
        valores.append(entidad_id)
        condiciones.append(f"entidad_id = ${len(valores)}")
    if sede_id:
        valores.append(sede_id)
        condiciones.append(f"sede_id = ${len(valores)}")

    where = f"where {' and '.join(condiciones)}" if condiciones else ""
    valores.append(limit)

    rows = await pool.fetch(
        f'select * from logs {where} order by "timestamp" desc limit ${len(valores)}',
        *valores,
    )
    return [{**dict(row), "id": str(row["id"])} for row in rows]
