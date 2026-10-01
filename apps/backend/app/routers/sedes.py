from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException

from app.db import get_pool
from app.models.sede import SedeActualizar, SedeCreate
from app.services.permisos_dashboard import autorizar_admin, requiere_admin
from app.services.usuarios import DatoInvalido, RegistroNoEncontrado, actualizar_fila, crear_fila, serializar

router = APIRouter(prefix="/sedes", tags=["sedes"])


@router.post("", status_code=201, dependencies=[Depends(requiere_admin)])
async def crear_sede(sede: SedeCreate) -> dict:
    try:
        fila = await crear_fila(
            "sedes",
            {"nombre": sede.nombre, "codigo": sede.codigo, "direccion": sede.direccion, "timezone": sede.timezone},
        )
    except DatoInvalido as exc:
        raise HTTPException(status_code=409, detail=f"No se pudo crear la sede: {exc}") from exc
    return {"id": fila["id"]}


@router.get("")
async def listar_sedes(
    incluir_inactivas: bool = False,
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> list[dict]:
    """Publico solo con sedes activas (lo usa el login movil); con
    incluir_inactivas=true exige sesion admin (o X-Admin-Token legacy) (es para la pantalla /creador)."""
    pool = await get_pool()
    if incluir_inactivas:
        await autorizar_admin(authorization, x_admin_token)
        rows = await pool.fetch("select * from sedes order by activa desc, nombre")
    else:
        rows = await pool.fetch("select * from sedes where activa = true order by nombre")
    return [serializar(row) for row in rows]


@router.patch("/{sede_id}", dependencies=[Depends(requiere_admin)])
async def actualizar_sede(sede_id: UUID, payload: SedeActualizar) -> dict:
    try:
        return await actualizar_fila("sedes", str(sede_id), payload.model_dump(exclude_none=True))
    except RegistroNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="Sede no encontrada") from exc
    except DatoInvalido as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
