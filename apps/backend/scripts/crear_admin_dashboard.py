"""Crea el primer admin del dashboard (o resetea el de un usuario existente:
nueva contrasena, rol admin, activo y sin bloqueo). La contrasena se pide por
teclado (no se acepta por argumento para que no quede en el historial).

Uso:
    python -m scripts.crear_admin_dashboard --usuario neider --nombre "Neider"
"""

import argparse
import asyncio
import getpass
import sys

from app.db import close_pool, ensure_schema, get_pool
from app.models.usuario_dashboard import PASSWORD_MAX, PASSWORD_MIN, _usuario_valido
from app.services.usuarios_dashboard import crear_o_actualizar_admin


async def main() -> None:
    parser = argparse.ArgumentParser(description="Crea o resetea un admin del dashboard")
    parser.add_argument("--usuario", required=True)
    parser.add_argument("--nombre", required=True)
    args = parser.parse_args()

    try:
        usuario = _usuario_valido(args.usuario)
    except ValueError as exc:
        sys.exit(f"Usuario invalido: {exc}")
    nombre = args.nombre.strip()
    if not nombre:
        sys.exit("El nombre no puede quedar vacio")

    password = getpass.getpass("Contrasena: ")
    if password != getpass.getpass("Repetir contrasena: "):
        sys.exit("Las contrasenas no coinciden")
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        sys.exit(f"La contrasena debe tener entre {PASSWORD_MIN} y {PASSWORD_MAX} caracteres")

    await ensure_schema()  # idempotente: crea usuarios_dashboard si todavia no existe
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            resultado = await crear_o_actualizar_admin(conn, usuario, nombre, password)
    finally:
        await close_pool()
    print(f"[ok] admin '{usuario}' {resultado}.")


if __name__ == "__main__":
    asyncio.run(main())
