"""CRUD de empleados. El PIN nunca se expone ni se acepta en texto plano
fuera de la creacion y el reset (se hashea antes de guardar) — ver
app/services/auth_pin.py. El login real por PIN vive en app/routers/auth.py.
Alta, edicion y reset de PIN exigen X-Admin-Token (pantalla /creador).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException

from app.db import get_pool
from app.models.empleado import EmpleadoActualizar, EmpleadoCreate, PinNuevo
from app.services.admin_auth import verificar_token_admin
from app.services.usuarios import (
    DatoInvalido,
    RegistroNoEncontrado,
    actualizar_fila,
    crear_con_pin,
    resetear_pin,
    sede_existe,
    serializar,
)

router = APIRouter(prefix="/empleados", tags=["empleados"])


@router.post("", status_code=201, dependencies=[Depends(verificar_token_admin)])
async def crear_empleado(empleado: EmpleadoCreate) -> dict:
    if not await sede_existe(empleado.sede_id):
        raise HTTPException(status_code=400, detail="La sede indicada no existe")
    try:
        return await crear_con_pin(
            "empleados",
            {"nombre": empleado.nombre, "sede_id": empleado.sede_id, "rol": empleado.rol.value},
            empleado.pin,
            sede_id=empleado.sede_id,
        )
    except DatoInvalido as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
async def listar_empleados(
    sede_id: str | None = None,
    incluir_inactivos: bool = False,
    x_admin_token: str | None = Header(default=None),
) -> list[dict]:
    """Publico solo con empleados activos (lo usa el login movil); con
    incluir_inactivos=true exige X-Admin-Token (pantalla /creador)."""
    if incluir_inactivos:
        verificar_token_admin(x_admin_token)
    condiciones: list[str] = [] if incluir_inactivos else ["estado = 'activo'"]
    parametros: list[object] = []
    if sede_id:
        parametros.append(sede_id)
        condiciones.append(f"sede_id = ${len(parametros)}")
    where = f" where {' and '.join(condiciones)}" if condiciones else ""
    pool = await get_pool()
    rows = await pool.fetch(f"select * from empleados{where} order by estado, nombre", *parametros)
    return [serializar(row) for row in rows]


@router.patch("/{empleado_id}", dependencies=[Depends(verificar_token_admin)])
async def actualizar_empleado(empleado_id: UUID, payload: EmpleadoActualizar) -> dict:
    cambios = payload.model_dump(mode="json", exclude_none=True)
    if "sede_id" in cambios and not await sede_existe(cambios["sede_id"]):
        raise HTTPException(status_code=400, detail="La sede indicada no existe")
    try:
        return await actualizar_fila("empleados", str(empleado_id), cambios)
    except RegistroNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="Empleado no encontrado") from exc
    except DatoInvalido as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{empleado_id}/pin", dependencies=[Depends(verificar_token_admin)])
async def resetear_pin_empleado(empleado_id: UUID, payload: PinNuevo) -> dict:
    try:
        await resetear_pin("empleados", str(empleado_id), payload.pin)
    except RegistroNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="Empleado no encontrado") from exc
    return {"ok": True}
