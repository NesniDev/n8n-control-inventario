"""Autenticacion simple por PIN (sin correo/contrasena) para operadores de la
app movil. El PIN nunca se guarda en texto plano: se deriva con PBKDF2-HMAC
(stdlib, sin dependencia nueva) + una sal aleatoria por empleado.
"""

import hashlib
import hmac
import secrets

_ITERACIONES = 200_000


def generar_sal() -> str:
    return secrets.token_hex(16)


def hashear_pin(pin: str, sal: str) -> str:
    derivado = hashlib.pbkdf2_hmac("sha256", pin.encode(), sal.encode(), _ITERACIONES)
    return derivado.hex()


def verificar_pin(pin: str, sal: str, hash_esperado: str) -> bool:
    return hmac.compare_digest(hashear_pin(pin, sal), hash_esperado)
