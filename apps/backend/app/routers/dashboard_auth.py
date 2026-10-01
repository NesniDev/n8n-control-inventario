"""Login del dashboard (usuario + contrasena, token firmado de 8 h) y
administracion de sus usuarios. Los usuarios se gestionan SOLO con una sesion
admin (sin token legacy); el primer admin se crea con
scripts/crear_admin_dashboard.py. Ver app/services/permisos_dashboard.py para
el header Authorization.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from app.models.usuario_dashboard import (
    CambiarPasswordRequest,
    LoginRequest,
    PasswordNueva,
    UsuarioDashboardActualizar,
    UsuarioDashboardCrear,
)
from app.services import usuarios_dashboard as servicio
from app.services.permisos_dashboard import requiere_rol, usuario_dashboard

router = APIRouter(tags=["dashboard-auth"])


@router.post("/dashboard/auth/login")
async def login(payload: LoginRequest) -> dict:
    try:
        token, expira_at, usuario = await servicio.autenticar(payload.usuario, payload.password)
    except servicio.CuentaBloqueada as exc:
        # 423 Locked: no es 401 para que el dashboard no lo confunda con
        # "credenciales mal" ni con "sesion vencida".
        raise HTTPException(
            status_code=423, detail=f"Demasiados intentos. Intenta de nuevo en {exc.minutos} minutos."
        ) from exc
    except servicio.CredencialesInvalidas as exc:
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos") from exc
    return {"token": token, "expira_at": expira_at.isoformat(), "usuario": usuario}


@router.get("/dashboard/auth/yo")
async def yo(usuario: dict = Depends(usuario_dashboard)) -> dict:
    return usuario


@router.post("/dashboard/auth/cambiar-password", status_code=204)
async def cambiar_password(payload: CambiarPasswordRequest, usuario: dict = Depends(usuario_dashboard)) -> Response:
    try:
        await servicio.cambiar_password(usuario, payload.actual, payload.nueva)
    except servicio.PasswordIncorrecta as exc:
        # 400 y no 401: un 401 haria que el dashboard crea que la sesion vencio.
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta") from exc
    except servicio.UsuarioNoEncontrado as exc:
        raise HTTPException(status_code=401, detail="Tu sesión expiró. Inicia sesión de nuevo.") from exc
    return Response(status_code=204)


@router.get("/dashboard/usuarios")
async def listar_usuarios(_: dict = Depends(requiere_rol("admin"))) -> list[dict]:
    return await servicio.listar()


@router.post("/dashboard/usuarios", status_code=201)
async def crear_usuario(payload: UsuarioDashboardCrear, admin: dict = Depends(requiere_rol("admin"))) -> dict:
    try:
        return await servicio.crear(admin, payload.usuario, payload.nombre, payload.rol, payload.password)
    except servicio.UsuarioDuplicado as exc:
        raise HTTPException(status_code=409, detail="Ese usuario ya existe") from exc


@router.patch("/dashboard/usuarios/{usuario_id}")
async def actualizar_usuario(
    usuario_id: UUID, payload: UsuarioDashboardActualizar, admin: dict = Depends(requiere_rol("admin"))
) -> dict:
    try:
        return await servicio.actualizar(admin, str(usuario_id), payload.model_dump(exclude_none=True))
    except servicio.UsuarioNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="Usuario no encontrado") from exc
    except servicio.ReglaAdmin as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/dashboard/usuarios/{usuario_id}/password")
async def resetear_password(
    usuario_id: UUID, payload: PasswordNueva, admin: dict = Depends(requiere_rol("admin"))
) -> dict:
    try:
        await servicio.resetear_password(admin, str(usuario_id), payload.password)
    except servicio.UsuarioNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="Usuario no encontrado") from exc
    return {"ok": True}
