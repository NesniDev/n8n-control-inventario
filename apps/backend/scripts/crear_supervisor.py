"""Alta (o actualizacion de PIN) de un supervisor -- todavia no hay pantalla
de admin para esto (mismo criterio que scripts/crear_punto.py), se carga a
mano por aca.

Uso:
    python -m scripts.crear_supervisor --nombre "Erika" --pin 1234
"""

import argparse
import asyncio

import asyncpg

from app.config import get_settings
from app.services.auth_pin import generar_sal, hashear_pin


async def crear_o_actualizar(conn: asyncpg.Connection, nombre: str, pin: str) -> str:
    # Si ya existe un supervisor con ese nombre se le cambia el PIN (sal
    # nueva) en vez de crear un duplicado -- comodo para rotar el PIN de
    # Erika sin acordarse el id.
    sal = generar_sal()
    pin_hash = hashear_pin(pin, sal)
    existente = await conn.fetchval("select id from supervisores where nombre = $1", nombre)
    if existente is not None:
        await conn.execute(
            "update supervisores set pin_hash = $2, pin_salt = $3, estado = 'activo' where id = $1",
            existente,
            pin_hash,
            sal,
        )
        return str(existente)
    fila = await conn.fetchrow(
        "insert into supervisores (nombre, pin_hash, pin_salt) values ($1, $2, $3) returning id",
        nombre,
        pin_hash,
        sal,
    )
    return str(fila["id"])


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nombre", required=True, help="Nombre del supervisor")
    parser.add_argument("--pin", required=True, help="PIN del supervisor (4 a 6 digitos)")
    args = parser.parse_args()
    if not (args.pin.isdigit() and 4 <= len(args.pin) <= 6):
        parser.error("--pin debe tener entre 4 y 6 digitos")

    settings = get_settings()
    conn = await asyncpg.connect(settings.database_url)
    try:
        supervisor_id = await crear_o_actualizar(conn, args.nombre, args.pin)
        print(f"Supervisor '{args.nombre}' ({supervisor_id})")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
