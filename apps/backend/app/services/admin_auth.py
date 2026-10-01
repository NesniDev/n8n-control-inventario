"""Guardia compartida de los endpoints administrativos (X-Admin-Token)."""

import hmac

from fastapi import Header, HTTPException

from app.config import get_settings


def verificar_token_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Protege los endpoints de borrado y de administracion (alta/edicion de
    sedes, empleados, puntos, supervisores y tipos de documento) -- sin esto,
    cualquiera con la URL del backend podria vaciar la base o crear usuarios
    con un curl directo (no hay ningun otro tipo de autenticacion en este
    proyecto). Falla cerrado: si el operador no configuro ADMIN_DELETE_TOKEN,
    estos endpoints quedan deshabilitados en vez de quedar abiertos por
    accidente."""
    esperado = get_settings().admin_delete_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Administracion deshabilitada: falta configurar ADMIN_DELETE_TOKEN")
    if x_admin_token is None or not hmac.compare_digest(x_admin_token.encode(), esperado.encode()):
        raise HTTPException(status_code=401, detail="Token de administrador invalido")
