"""Tipos de documento que se le muestran a la IA de vision como ejemplos
(tabla tipos_documento, administrada desde /creador). Son guia del prompt, no
una lista cerrada: el schema de extraccion no tiene enum (ver vision.py).

La frase de ejemplos del prompt se arma con los tipos activos y se cachea en
memoria unos segundos para no consultar la DB en cada foto; si la tabla esta
vacia o la consulta falla, se usa la lista que antes estaba fija en el prompt.
"""

import logging
import time

import asyncpg

from app.db import get_pool
from app.models.tipo_documento import TipoDocumentoActualizar, TipoDocumentoCrear
from app.services.usuarios import DatoInvalido, RegistroNoEncontrado, registrar_cambio, serializar

logger = logging.getLogger("app")

# Lista de respaldo: la misma que estaba fija en el prompt de vision.py.
_FRASE_RESPALDO = (
    "FEI o FV1 (factura), EDP o EDV, TB9 (traslado entre bodegas), o RM3/RM2/RSF (remision)"
)

_TTL_SEGUNDOS = 60.0
_cache: tuple[float, str] | None = None


def invalidar_cache() -> None:
    global _cache
    _cache = None


def _armar_frase(filas: list[asyncpg.Record]) -> str:
    """Agrupa los codigos por descripcion (conservando el orden de aparicion)
    y los une con "o": 'FEI o FV1 (factura), EDP o EDV, TB9 (traslado...)'."""
    grupos: dict[str, list[str]] = {}
    for fila in filas:
        grupos.setdefault((fila["descripcion"] or "").strip(), []).append(fila["codigo"])
    partes = []
    for descripcion, codigos in grupos.items():
        texto = " o ".join(codigos)
        partes.append(f"{texto} ({descripcion})" if descripcion else texto)
    if len(partes) > 1:
        return ", ".join(partes[:-1]) + ", o " + partes[-1]
    return partes[0]


async def frase_ejemplos() -> str:
    """Frase de ejemplos para el prompt -- con cache y fallback (ver arriba)."""
    global _cache
    ahora = time.monotonic()
    if _cache is not None and ahora - _cache[0] < _TTL_SEGUNDOS:
        return _cache[1]
    try:
        pool = await get_pool()
        filas = await pool.fetch(
            "select codigo, descripcion from tipos_documento where activo = true order by created_at, codigo"
        )
        frase = _armar_frase(filas) if filas else _FRASE_RESPALDO
    except Exception:  # noqa: BLE001 - la lectura de tipos nunca debe tumbar la extraccion
        logger.exception("No se pudieron leer los tipos de documento; se usa la lista de respaldo")
        frase = _FRASE_RESPALDO
    _cache = (ahora, frase)
    return frase


async def listar(incluir_inactivos: bool = False) -> list[dict]:
    pool = await get_pool()
    condicion = "" if incluir_inactivos else "where activo = true"
    filas = await pool.fetch(f"select * from tipos_documento {condicion} order by created_at, codigo")
    return [serializar(f) for f in filas]


async def crear(payload: TipoDocumentoCrear) -> dict:
    pool = await get_pool()
    try:
        fila = await pool.fetchrow(
            "insert into tipos_documento (codigo, descripcion) values ($1, $2) returning *",
            payload.codigo,
            payload.descripcion,
        )
    except asyncpg.UniqueViolationError as exc:
        raise DatoInvalido("Ya existe un tipo de documento con ese codigo") from exc
    invalidar_cache()
    await registrar_cambio(
        "tipos_documento", fila["codigo"], "creado", {"codigo": fila["codigo"], "descripcion": fila["descripcion"]}
    )
    return serializar(fila)


async def actualizar(codigo: str, payload: TipoDocumentoActualizar) -> dict:
    cambios = payload.model_dump(exclude_none=True)
    pool = await get_pool()
    if not cambios:
        fila = await pool.fetchrow("select * from tipos_documento where codigo = $1", codigo)
    else:
        asignaciones = ", ".join(f"{col} = ${i}" for i, col in enumerate(cambios, start=2))
        fila = await pool.fetchrow(
            f"update tipos_documento set {asignaciones} where codigo = $1 returning *",
            codigo,
            *cambios.values(),
        )
    if fila is None:
        raise RegistroNoEncontrado()
    if cambios:
        invalidar_cache()
        await registrar_cambio("tipos_documento", codigo, "actualizado", cambios)
    return serializar(fila)
