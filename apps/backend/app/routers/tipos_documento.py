"""Tipos de documento que la IA de vision recibe como ejemplos en el prompt
(ver app/services/tipos_documento.py). GET es publico (lo pueden usar las
apps para mostrar opciones); alta y edicion exigen X-Admin-Token. No se
borra: un tipo se desactiva y deja de aparecer en el prompt.
"""

from fastapi import APIRouter, Depends, Header, HTTPException

from app.models.tipo_documento import TipoDocumentoActualizar, TipoDocumentoCrear, normalizar_codigo
from app.services import tipos_documento as servicio
from app.services.admin_auth import verificar_token_admin
from app.services.usuarios import DatoInvalido, RegistroNoEncontrado

router = APIRouter(prefix="/tipos-documento", tags=["tipos-documento"])


@router.get("")
async def listar_tipos_documento(
    incluir_inactivos: bool = False, x_admin_token: str | None = Header(default=None)
) -> list[dict]:
    if incluir_inactivos:
        verificar_token_admin(x_admin_token)
    return await servicio.listar(incluir_inactivos)


@router.post("", status_code=201, dependencies=[Depends(verificar_token_admin)])
async def crear_tipo_documento(payload: TipoDocumentoCrear) -> dict:
    try:
        return await servicio.crear(payload)
    except DatoInvalido as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/{codigo}", dependencies=[Depends(verificar_token_admin)])
async def actualizar_tipo_documento(codigo: str, payload: TipoDocumentoActualizar) -> dict:
    try:
        return await servicio.actualizar(normalizar_codigo(codigo), payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RegistroNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="Tipo de documento no encontrado") from exc
