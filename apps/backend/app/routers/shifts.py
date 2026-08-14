"""Turnos y recomendaciones de turno (Figura 2 del diagrama de arquitectura).

El job semanal que calcula shift_recommendations vive fuera de este proceso
web (corre como un nodo cron de n8n o un script standalone en
scripts/generar_turnos.py) y escribe directamente en la tabla
shift_recommendations. Este router solo expone lectura/escritura CRUD.
"""

from fastapi import APIRouter

from app.db import get_pool
from app.models.turno import TurnoCreate

router = APIRouter(prefix="/turnos", tags=["turnos"])


@router.post("", status_code=201)
async def crear_turno(turno: TurnoCreate) -> dict:
    pool = await get_pool()
    turno_id = await pool.fetchval(
        """
        insert into turnos (empleado_id, sede_id, fecha, hora_inicio, hora_fin, origen)
        values ($1, $2, $3, $4, $5, $6)
        returning id
        """,
        turno.empleado_id,
        turno.sede_id,
        turno.fecha,
        turno.hora_inicio,
        turno.hora_fin,
        turno.origen.value,
    )
    return {"id": str(turno_id)}


@router.get("")
async def listar_turnos(sede_id: str | None = None) -> list[dict]:
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            "select * from turnos where sede_id = $1 order by fecha", sede_id
        )
    else:
        rows = await pool.fetch("select * from turnos order by fecha")
    return [{**dict(row), "id": str(row["id"])} for row in rows]


@router.get("/recomendaciones")
async def listar_recomendaciones(sede_id: str | None = None) -> list[dict]:
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            "select * from shift_recommendations where sede_id = $1 order by semana_iso desc",
            sede_id,
        )
    else:
        rows = await pool.fetch("select * from shift_recommendations order by semana_iso desc")
    return [{**dict(row), "id": str(row["id"])} for row in rows]
