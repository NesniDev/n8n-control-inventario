"""Carga (o actualiza) la lista oficial de puntos que usan la tab de
Traslados de la app movil. Idempotente: se puede correr de nuevo cuando
cambie la lista -- los puntos ya existentes (mismo codigo) se actualizan de
nombre y se reactivan; no borra puntos que ya no esten en la lista (quedarian
colgados sus traslados), para eso marcarlos activo = false a mano.

En Traslados no se elige persona: se entra como el punto. Cada punto tiene
una unica "cuenta" en usuarios_punto, con el mismo nombre del punto, y es la
que queda como creado_por/recibido_por del traslado. Con --pin se crea (o se
le cambia el PIN a) la cuenta de cada punto -- por ahora el mismo PIN para
todos.

Uso:
    python -m scripts.cargar_puntos              # solo carga/actualiza puntos
    python -m scripts.cargar_puntos --pin 4821   # + cuenta de cada punto con ese PIN
"""

import argparse
import asyncio

import asyncpg

from app.config import get_settings
from app.services.auth_pin import generar_sal, hashear_pin

# (codigo, nombre) -- el nombre se guarda como "CODIGO — Nombre", que es como
# se reconocen los puntos en bodega.
PUNTOS: list[tuple[str, str]] = [
    ("CFC", "La Cumbre"),
    ("CPG", "Capellanía"),
    ("CUB", "Cucaita"),
    ("E21", "Buenavista"),
    ("EDS", "Imperio Polo Sur"),
    ("MFE", "Muzo"),
    ("NBR", "Briceño"),
    ("NFL", "Florián"),
    ("NPT", "Puente de Tierra"),
    ("NT9", "Merchán"),
    ("NTI", "Tinjacá"),
    ("NVL", "Villa de Leyva"),
    ("PFE", "Paipa"),
    ("SFC", "Samacá"),
    ("TB2", "Saboyá"),
    ("TB4", "Susa"),
    ("TB9", "Estación (Salidas)"),
    ("TBE", "Agroquímicos Polo Sur"),
    ("TF1", "Simijaca"),
    ("TF2", "La Belleza"),
    ("TF3", "Sutamarchán"),
    ("TFE", "Tuta"),
    ("VET", "Veterinaria"),
]


async def asegurar_cuenta(conn: asyncpg.Connection, punto_id, nombre: str, pin: str) -> None:
    # Una sola cuenta activa por punto: si ya existe se le actualiza nombre y
    # PIN (sal nueva), si no se crea.
    sal = generar_sal()
    pin_hash = hashear_pin(pin, sal)
    actualizada = await conn.fetchval(
        """
        update usuarios_punto set nombre = $2, pin_hash = $3, pin_salt = $4
        where id = (
            select id from usuarios_punto
            where punto_id = $1 and estado = 'activo'
            order by created_at limit 1
        )
        returning id
        """,
        punto_id,
        nombre,
        pin_hash,
        sal,
    )
    if actualizada is None:
        await conn.execute(
            "insert into usuarios_punto (nombre, punto_id, pin_hash, pin_salt) values ($1, $2, $3, $4)",
            nombre,
            punto_id,
            pin_hash,
            sal,
        )


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pin", help="PIN (4 a 6 digitos) para la cuenta de cada punto")
    args = parser.parse_args()
    if args.pin is not None and not (args.pin.isdigit() and 4 <= len(args.pin) <= 6):
        parser.error("--pin debe tener entre 4 y 6 digitos")

    conn = await asyncpg.connect(get_settings().database_url)
    try:
        async with conn.transaction():
            for codigo, nombre in PUNTOS:
                punto_id = await conn.fetchval(
                    """
                    insert into puntos (codigo, nombre) values ($1, $2)
                    on conflict (codigo) do update
                        set nombre = excluded.nombre, activo = true
                    returning id
                    """,
                    codigo,
                    f"{codigo} — {nombre}",
                )
                if args.pin:
                    await asegurar_cuenta(conn, punto_id, f"{codigo} — {nombre}", args.pin)
        total = await conn.fetchval("select count(*) from puntos where activo = true")
        print(f"Cargados {len(PUNTOS)} puntos. Puntos activos en total: {total}")
        if args.pin:
            cuentas = await conn.fetchval("select count(*) from usuarios_punto where estado = 'activo'")
            print(f"Cuentas de punto activas: {cuentas} (todas con el PIN indicado)")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
