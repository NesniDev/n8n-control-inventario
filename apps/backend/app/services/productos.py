import re

import asyncpg

# Las descripciones de item vienen tal como las lee la IA de vision del
# documento (columna DETALLE) -- por convencion del negocio suelen arrancar
# con el codigo interno del producto seguido del nombre (ej.
# "75936  SAL BLANCA * 40 KILOS"), pero no hay ningun separador garantizado
# ni campo estructurado en el pipeline (ver vision.py). 3+ digitos evita
# confundir una cantidad suelta al inicio del texto ("2 CAJAS...") con un
# codigo real.
_PATRON_CODIGO_NOMBRE = re.compile(r"^(\d{3,})[\s\-:]+(.+)$")


def extraer_codigo_nombre(descripcion: str) -> tuple[str, str] | None:
    match = _PATRON_CODIGO_NOMBRE.match(descripcion.strip())
    if not match:
        return None
    codigo, nombre = match.groups()
    nombre = nombre.strip()
    if not nombre:
        return None
    return codigo, nombre


async def sincronizar_producto(conn: asyncpg.Connection, descripcion: str) -> None:
    """Completa el catalogo de productos a partir de una descripcion de item ya
    escrita en entrega_items -- se llama con la misma conexion/transaccion que
    ya esta insertando o corrigiendo esa fila (ver duplicates.py). No hace
    nada si la descripcion no trae un codigo reconocible. `on conflict do
    nothing` es lo que garantiza que el codigo no se repita: la primera
    descripcion que lo trajo gana, no se pisa despues.
    """
    resultado = extraer_codigo_nombre(descripcion)
    if resultado is None:
        return
    codigo, nombre = resultado
    await conn.execute(
        "insert into productos (codigo, nombre) values ($1, $2) on conflict (codigo) do nothing",
        codigo,
        nombre,
    )
