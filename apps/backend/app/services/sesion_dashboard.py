"""Tokens de sesion del dashboard (login con usuario y contrasena).

Formato (estilo JWT minimo, sin dependencia nueva):

    base64url(json({"sub": usuario_id, "iat": ..., "exp": ...})) + "." + base64url(HMAC-SHA256(secreto, payload_b64))

Este modulo NO toca la base ni importa app.db: firmar/verificar reciben el
secreto como argumento, asi se pueden probar sin entorno. Quien lee el
usuario de la DB (y por eso reacciona al instante a una baja o cambio de rol)
es app/services/permisos_dashboard.py.
"""

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException

TTL_SEGUNDOS = 8 * 60 * 60  # 8 horas


def _b64(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()


def _desb64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def _firma(payload_b64: str, secreto: str) -> str:
    return _b64(hmac.new(secreto.encode(), payload_b64.encode(), hashlib.sha256).digest())


def firmar(payload: dict, secreto: str) -> str:
    payload_b64 = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{payload_b64}.{_firma(payload_b64, secreto)}"


def verificar(token: str, secreto: str, ahora: float | None = None) -> dict | None:
    """Devuelve el payload si la firma es valida y no expiro; None en
    cualquier otro caso (formato roto, firma alterada, vencido). Nunca lanza."""
    try:
        payload_b64, firma = token.split(".")
        if not hmac.compare_digest(firma.encode(), _firma(payload_b64, secreto).encode()):
            return None
        payload = json.loads(_desb64(payload_b64))
        if not isinstance(payload, dict) or not isinstance(payload.get("sub"), str):
            return None
        exp = payload.get("exp")
        if not isinstance(exp, (int, float)) or exp <= (time.time() if ahora is None else ahora):
            return None
        return payload
    except (ValueError, TypeError, UnicodeError):
        return None


def crear_token(usuario_id: str, secreto: str, ahora: float | None = None) -> tuple[str, int]:
    """Devuelve (token, exp como unix timestamp)."""
    iat = int(time.time() if ahora is None else ahora)
    exp = iat + TTL_SEGUNDOS
    return firmar({"sub": usuario_id, "iat": iat, "exp": exp}, secreto), exp


def obtener_secreto() -> str:
    """Secreto de firma. Si no hay DASHBOARD_SESSION_SECRET se DERIVA de
    ADMIN_DELETE_TOKEN (HMAC con una etiqueta fija) para que desplegar el login
    no obligue a agregar una variable de entorno nueva; derivarlo (en vez de
    usar el token tal cual) evita que el valor del header X-Admin-Token y la
    clave de firma sean el mismo secreto. Falla cerrado (503) si no hay ninguno,
    igual que verificar_token_admin."""
    from app.config import get_settings  # import tardio: el resto del modulo no necesita settings

    settings = get_settings()
    if settings.dashboard_session_secret:
        return settings.dashboard_session_secret
    if settings.admin_delete_token:
        return hmac.new(settings.admin_delete_token.encode(), b"dashboard-session-v1", hashlib.sha256).hexdigest()
    raise HTTPException(
        status_code=503,
        detail="Sesiones deshabilitadas: falta configurar DASHBOARD_SESSION_SECRET o ADMIN_DELETE_TOKEN",
    )
