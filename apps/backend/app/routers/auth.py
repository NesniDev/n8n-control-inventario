"""Login por PIN para la app movil — sin correo/contrasena. El bodeguero ya
se eligio en el paso anterior (ver PantallaLogin), asi que aca el PIN no
busca a quien pertenece: solo confirma la identidad de esa fila puntual
(empleado_id).
"""

from fastapi import APIRouter, HTTPException, status

from app.db import get_pool
from app.models.empleado import PinLogin
from app.services.auth_pin import verificar_pin

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/pin")
async def login_pin(payload: PinLogin) -> dict:
    pool = await get_pool()
    candidato = await pool.fetchrow(
        "select * from empleados where id = $1::uuid and estado = 'activo' and pin_hash is not null",
        payload.empleado_id,
    )

    if candidato and verificar_pin(payload.pin, candidato["pin_salt"], candidato["pin_hash"]):
        return {
            "id": str(candidato["id"]),
            "nombre": candidato["nombre"],
            "sede_id": candidato["sede_id"],
            "rol": candidato["rol"],
        }

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="PIN incorrecto")
