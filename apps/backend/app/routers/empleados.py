"""CRUD de empleados. El PIN nunca se expone ni se acepta en texto plano
fuera de la creacion (se hashea antes de guardar) — ver app/services/auth_pin.py.
El login real por PIN vive en app/routers/auth.py.
"""

from fastapi import APIRouter, HTTPException

from app.db import get_pool
from app.models.empleado import EmpleadoCreate
from app.services.auth_pin import generar_sal, hashear_pin

router = APIRouter(prefix="/empleados", tags=["empleados"])


def _sin_pin(row: dict) -> dict:
    row = dict(row)
    row.pop("pin_hash", None)
    row.pop("pin_salt", None)
    row["id"] = str(row["id"])
    return row


@router.post("", status_code=201)
async def crear_empleado(empleado: EmpleadoCreate) -> dict:
    pool = await get_pool()
    sal = generar_sal()
    pin_hash = hashear_pin(empleado.pin, sal)
    try:
        row = await pool.fetchrow(
            """
            insert into empleados (nombre, sede_id, rol, pin_hash, pin_salt)
            values ($1, $2, $3, $4, $5)
            returning *
            """,
            empleado.nombre,
            empleado.sede_id,
            empleado.rol.value,
            pin_hash,
            sal,
        )
    except Exception as exc:  # noqa: BLE001 - traducido a 400 para el cliente
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _sin_pin(row)


@router.get("")
async def listar_empleados(sede_id: str | None = None) -> list[dict]:
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            "select * from empleados where estado = 'activo' and sede_id = $1 order by nombre",
            sede_id,
        )
    else:
        rows = await pool.fetch("select * from empleados where estado = 'activo' order by nombre")
    return [_sin_pin(row) for row in rows]
