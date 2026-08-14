from fastapi import APIRouter

from app.db import get_pool
from app.models.sede import SedeCreate

router = APIRouter(prefix="/sedes", tags=["sedes"])


@router.post("", status_code=201)
async def crear_sede(sede: SedeCreate) -> dict:
    pool = await get_pool()
    sede_id = await pool.fetchval(
        """
        insert into sedes (nombre, codigo, direccion, timezone)
        values ($1, $2, $3, $4)
        returning id
        """,
        sede.nombre,
        sede.codigo,
        sede.direccion,
        sede.timezone,
    )
    return {"id": str(sede_id)}


@router.get("")
async def listar_sedes() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("select * from sedes where activa = true order by nombre")
    return [{**dict(row), "id": str(row["id"])} for row in rows]
