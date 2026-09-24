"""Alta de puntos y usuarios de punto sin pasar por el dashboard -- todavia no
hay una pantalla de admin para esto (fuera de alcance del plan
"traslados-entre-puntos"), se cargan a mano por aca o via POST /puntos /
POST /puntos/{id}/usuarios (con X-Admin-Token).

Uso:
    python -m scripts.crear_punto --punto "Bodega Norte" --usuario "Juan" --pin 1234
    python -m scripts.crear_punto --borrar-prueba   # borra puntos "PRUEBA*" y su cascada
"""

import argparse
import asyncio

import asyncpg

from app.config import get_settings
from app.services.auth_pin import generar_sal, hashear_pin


async def crear_punto(conn: asyncpg.Connection, nombre: str) -> str:
    # on conflict: reintentar con un nombre ya cargado no falla, solo
    # devuelve el punto existente -- comodo para correr el comando dos veces
    # sin acordarse si ya se habia creado.
    fila = await conn.fetchrow(
        """
        insert into puntos (nombre) values ($1)
        on conflict (nombre) do update set nombre = excluded.nombre
        returning id
        """,
        nombre,
    )
    return str(fila["id"])


async def crear_usuario(conn: asyncpg.Connection, punto_id: str, nombre: str, pin: str) -> str:
    sal = generar_sal()
    pin_hash = hashear_pin(pin, sal)
    fila = await conn.fetchrow(
        """
        insert into usuarios_punto (nombre, punto_id, pin_hash, pin_salt)
        values ($1, $2::uuid, $3, $4)
        returning id
        """,
        nombre,
        punto_id,
        pin_hash,
        sal,
    )
    return str(fila["id"])


async def borrar_prueba(conn: asyncpg.Connection) -> None:
    puntos = await conn.fetch("select id, nombre from puntos where nombre like 'PRUEBA%'")
    if not puntos:
        print("No hay puntos de prueba para borrar.")
        return
    ids = [p["id"] for p in puntos]
    # traslado_punto_items se va solo por "on delete cascade" al borrar
    # traslados_puntos -- no hace falta borrarlo aparte.
    await conn.execute(
        "delete from traslados_puntos where punto_origen_id = any($1::uuid[]) or punto_destino_id = any($1::uuid[])",
        ids,
    )
    await conn.execute("delete from usuarios_punto where punto_id = any($1::uuid[])", ids)
    await conn.execute("delete from puntos where id = any($1::uuid[])", ids)
    nombres = ", ".join(p["nombre"] for p in puntos)
    print(f"Borrados {len(puntos)} puntos de prueba (con sus usuarios/traslados/items): {nombres}")

    # Si no quedo ningun traslado real, el consecutivo vuelve a arrancar en 1
    # -- asi el primer traslado de verdad es TP-000001 y no hereda el numero
    # de las pruebas. Con traslados reales en la tabla no se toca nunca.
    if await conn.fetchval("select count(*) from traslados_puntos") == 0:
        secuencia = await conn.fetchval("select pg_get_serial_sequence('traslados_puntos', 'consecutivo')")
        await conn.execute(f"alter sequence {secuencia} restart with 1")
        print("Consecutivo de traslados reiniciado (el proximo es TP-000001).")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--punto", help="Nombre del punto a crear (o reusar si ya existe)")
    parser.add_argument("--usuario", help="Nombre del usuario a crear en ese punto")
    parser.add_argument("--pin", help="PIN del usuario (4 a 6 digitos)")
    parser.add_argument(
        "--borrar-prueba",
        action="store_true",
        help="Borra los puntos cuyo nombre empieza con 'PRUEBA' junto con sus usuarios/traslados/items",
    )
    args = parser.parse_args()

    settings = get_settings()
    conn = await asyncpg.connect(settings.database_url)
    try:
        if args.borrar_prueba:
            await borrar_prueba(conn)
            return

        if not (args.punto and args.usuario and args.pin):
            parser.error("--punto, --usuario y --pin son obligatorios (o usa --borrar-prueba)")

        punto_id = await crear_punto(conn, args.punto)
        usuario_id = await crear_usuario(conn, punto_id, args.usuario, args.pin)
        print(f"Punto '{args.punto}' ({punto_id}) con usuario '{args.usuario}' ({usuario_id})")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
