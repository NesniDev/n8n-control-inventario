"""Login por PIN para la app movil — sin correo/contrasena. El PIN por si
solo no indexa al empleado (la sal es distinta por fila), asi que se
verifica contra cada empleado activo; a esta escala (pocos operadores por
sede) es trivial en costo y evita el problema de que dos empleados elijan
el mismo PIN y choquen.
"""

from fastapi import APIRouter, HTTPException, status

from app.db import get_pool
from app.models.empleado import PinLogin
from app.services.auth_pin import verificar_pin

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/pin")
async def login_pin(payload: PinLogin) -> dict:
    pool = await get_pool()
    candidatos = await pool.fetch(
        "select * from empleados where estado = 'activo' and pin_hash is not null"
    )

    for candidato in candidatos:
        if verificar_pin(payload.pin, candidato["pin_salt"], candidato["pin_hash"]):
            return {
                "id": str(candidato["id"]),
                "nombre": candidato["nombre"],
                "sede_id": candidato["sede_id"],
                "rol": candidato["rol"],
            }

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="PIN incorrecto")
