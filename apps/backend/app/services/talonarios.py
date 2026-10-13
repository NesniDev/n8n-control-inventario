"""Talonario por punto: cada punto trabaja con UN talonario activo a la vez (50
hojas fijas, letra + rango de numeros) y cada traslado consume la "siguiente
hoja" en orden -- ver el flujo de traslados en app/services/traslados_puntos.py.

Siguiente hoja = el menor numero del rango que no uso ningun traslado de ese
talonario y no esta anulado. Quedan = cuantas hojas del rango siguen asi.
Todas las escrituras van en transaccion y toman `select ... for update` sobre
la fila del talonario activo, asi crear un traslado, anular una hoja y cambiar
de talonario se serializan entre si.
"""

import re

import asyncpg

from app.db import get_pool
from app.models.log import EventoLog
from app.models.talonario import HOJAS_POR_TALONARIO, HojaAnular, TalonarioConfigurar
from app.services.logging_service import registrar_evento

# Con cuantas hojas restantes la app empieza a avisar "Pide un talonario".
UMBRAL_AVISO = 5


class TalonarioInvalido(Exception):
    """Dato o precondicion invalida al configurar/anular (usuario de otro
    punto, motivo faltante, sin talonario activo, etc.) -- se traduce a 422."""


class TalonarioNoDisponible(Exception):
    """El punto no tiene talonario activo o ya se agoto -- hay que
    configurar uno antes de seguir. Se traduce a 409."""


class TalonarioConflicto(Exception):
    """Choque de concurrencia o de hoja (otro usuario configuro/uso la hoja
    antes). Se traduce a 409."""


def formatear_hoja(letra: str, numero: int) -> str:
    return f"{letra} {numero}"


def parsear_referencia(texto: str | None) -> tuple[str, int] | None:
    """Normaliza una referencia de hoja leida o tipeada ("A6305", "a-6305",
    "A 6305") a (letra mayuscula, numero). None si no tiene ese formato."""
    coincidencia = re.fullmatch(r"\s*([A-Za-z]{1,3})[\s\-]*(\d{1,7})\s*", texto or "")
    if coincidencia is None:
        return None
    return coincidencia.group(1).upper(), int(coincidencia.group(2))


async def _estado(conn, talonario) -> dict:
    """Arma la vista de un talonario (fila de talonarios_punto) con la
    siguiente hoja, cuantas quedan y las usadas/anuladas."""
    letra = talonario["letra"]
    inicial = talonario["numero_inicial"]
    final = talonario["numero_final"]

    usadas: set[int] = set()
    filas = await conn.fetch(
        "select numero_talonario from traslados_puntos where talonario_id = $1::uuid", talonario["id"]
    )
    for fila in filas:
        referencia = parsear_referencia(fila["numero_talonario"])
        if referencia is not None and referencia[0] == letra:
            usadas.add(referencia[1])

    anuladas = {
        f["numero"]
        for f in await conn.fetch(
            "select numero from talonario_hojas_anuladas where talonario_id = $1::uuid", talonario["id"]
        )
    }

    pendientes = [n for n in range(inicial, final + 1) if n not in usadas and n not in anuladas]
    siguiente = pendientes[0] if pendientes else None
    return {
        "id": str(talonario["id"]),
        "punto_id": str(talonario["punto_id"]),
        "letra": letra,
        "numero_inicial": inicial,
        "numero_final": final,
        "rango": f"{formatear_hoja(letra, inicial)} – {formatear_hoja(letra, final)}",
        "estado": talonario["estado"],
        "siguiente_numero": siguiente,
        "siguiente_hoja": formatear_hoja(letra, siguiente) if siguiente is not None else None,
        "quedan": len(pendientes),
        "agotado": siguiente is None,
        "usadas": len(usadas),
        "anuladas": len(anuladas),
        "umbral_aviso": UMBRAL_AVISO,
    }


async def obtener_talonario_activo(punto_id: str) -> dict | None:
    """Talonario activo del punto con su estado, o None si no hay."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        talonario = await conn.fetchrow(
            "select * from talonarios_punto where punto_id = $1::uuid and estado = 'activo'", punto_id
        )
        if talonario is None:
            return None
        return await _estado(conn, talonario)


async def hoja_esperada(punto_id: str) -> dict:
    """Estado del talonario activo del punto, exigiendo que haya uno y que no
    este agotado. Lanza TalonarioNoDisponible con un mensaje listo para
    mostrar al usuario. Lectura sin lock (la usa extraer, que no escribe)."""
    estado = await obtener_talonario_activo(punto_id)
    if estado is None:
        raise TalonarioNoDisponible("Tu punto no tiene un talonario activo. Configura tu talonario antes de continuar.")
    if estado["agotado"]:
        raise TalonarioNoDisponible("Talonario agotado. Pide un talonario y configúralo.")
    return estado


async def validar_y_tomar_hoja(conn, punto_id: str, numero_talonario: str) -> tuple[str, str]:
    """Dentro de la transaccion de crear_traslado: toma el lock del talonario
    activo del punto, recalcula la siguiente hoja y exige que `numero_talonario`
    sea esa. Devuelve (talonario_id, referencia canonica "A 6305")."""
    talonario = await conn.fetchrow(
        "select * from talonarios_punto where punto_id = $1::uuid and estado = 'activo' for update", punto_id
    )
    if talonario is None:
        raise TalonarioNoDisponible("Tu punto no tiene un talonario activo. Configura tu talonario antes de continuar.")
    estado = await _estado(conn, talonario)
    if estado["agotado"]:
        raise TalonarioNoDisponible("Talonario agotado. Pide un talonario y configúralo.")

    esperada = estado["siguiente_hoja"]
    referencia = parsear_referencia(numero_talonario)
    if referencia is None or referencia != (estado["letra"], estado["siguiente_numero"]):
        raise TalonarioConflicto(
            f"Esa hoja ya se usó o no es la siguiente del talonario. Toma la foto de la hoja {esperada}."
        )
    return estado["id"], esperada


async def configurar_talonario(payload: TalonarioConfigurar) -> dict:
    """Configura (o cambia) el talonario activo del punto. Si el activo no se
    ha agotado, el motivo es obligatorio; las hojas que quedaban sin usar
    simplemente se dejan de usar."""
    punto_id = str(payload.punto_id)
    usuario_id = str(payload.usuario_id)
    pool = await get_pool()

    usuario = await pool.fetchrow(
        "select punto_id from usuarios_punto where id = $1::uuid and estado = 'activo'", usuario_id
    )
    if usuario is None or str(usuario["punto_id"]) != punto_id:
        raise TalonarioInvalido("Quien configura el talonario debe pertenecer a este punto")
    punto = await pool.fetchrow("select id from puntos where id = $1::uuid and activo = true", punto_id)
    if punto is None:
        raise TalonarioInvalido("El punto no existe o esta inactivo")

    anterior_estado: dict | None = None
    async with pool.acquire() as conn:
        async with conn.transaction():
            activo = await conn.fetchrow(
                "select * from talonarios_punto where punto_id = $1::uuid and estado = 'activo' for update",
                punto_id,
            )
            if activo is not None:
                anterior_estado = await _estado(conn, activo)
                if not anterior_estado["agotado"] and not payload.motivo:
                    raise TalonarioInvalido(
                        "Indica el motivo del cambio: el talonario actual todavía tiene hojas sin usar."
                    )
                await conn.execute(
                    """
                    update talonarios_punto
                    set estado = 'cerrado', cerrado_at = now(), motivo_cierre = $2
                    where id = $1::uuid
                    """,
                    activo["id"],
                    payload.motivo or "Talonario agotado",
                )
            try:
                nuevo = await conn.fetchrow(
                    """
                    insert into talonarios_punto (punto_id, letra, numero_inicial, numero_final, creado_por)
                    values ($1::uuid, $2, $3, $4, $5::uuid)
                    returning *
                    """,
                    punto_id,
                    payload.letra,
                    payload.numero_inicial,
                    payload.numero_inicial + HOJAS_POR_TALONARIO - 1,
                    usuario_id,
                )
            except asyncpg.UniqueViolationError as exc:
                # Indice parcial talonarios_punto_activo_key: otra persona
                # configuro el talonario del punto al mismo tiempo.
                raise TalonarioConflicto(
                    "Alguien más acaba de configurar el talonario de este punto. Revisa el talonario activo."
                ) from exc
            nuevo_estado = await _estado(conn, nuevo)

    await registrar_evento(
        EventoLog.TALONARIO_CONFIGURADO,
        entidad_tipo="talonario_punto",
        entidad_id=nuevo_estado["id"],
        actor_id=usuario_id,
        sede_id=punto_id,
        resultado="ok",
        detalle={
            "desde": (
                {
                    "talonario_id": anterior_estado["id"],
                    "rango": anterior_estado["rango"],
                    "quedaban": anterior_estado["quedan"],
                }
                if anterior_estado is not None
                else None
            ),
            "hacia": {"talonario_id": nuevo_estado["id"], "rango": nuevo_estado["rango"]},
            "motivo": payload.motivo,
        },
    )
    return nuevo_estado


async def anular_siguiente_hoja(payload: HojaAnular) -> dict:
    """Anula exactamente la siguiente hoja pendiente del talonario activo."""
    punto_id = str(payload.punto_id)
    usuario_id = str(payload.usuario_id)
    pool = await get_pool()

    usuario = await pool.fetchrow(
        "select punto_id from usuarios_punto where id = $1::uuid and estado = 'activo'", usuario_id
    )
    if usuario is None or str(usuario["punto_id"]) != punto_id:
        raise TalonarioInvalido("Quien anula la hoja debe pertenecer a este punto")

    async with pool.acquire() as conn:
        async with conn.transaction():
            talonario = await conn.fetchrow(
                "select * from talonarios_punto where punto_id = $1::uuid and estado = 'activo' for update",
                punto_id,
            )
            if talonario is None:
                raise TalonarioInvalido("Tu punto no tiene un talonario activo")
            antes = await _estado(conn, talonario)
            if antes["agotado"]:
                raise TalonarioInvalido("El talonario está agotado, no hay hoja para anular")
            await conn.execute(
                """
                insert into talonario_hojas_anuladas (talonario_id, numero, motivo, anulado_por)
                values ($1::uuid, $2, $3, $4::uuid)
                """,
                talonario["id"],
                antes["siguiente_numero"],
                payload.motivo,
                usuario_id,
            )
            despues = await _estado(conn, talonario)

    await registrar_evento(
        EventoLog.TALONARIO_HOJA_ANULADA,
        entidad_tipo="talonario_punto",
        entidad_id=antes["id"],
        actor_id=usuario_id,
        sede_id=punto_id,
        resultado="ok",
        detalle={"hoja": antes["siguiente_hoja"], "motivo": payload.motivo, "quedan": despues["quedan"]},
    )
    return {"hoja_anulada": antes["siguiente_hoja"], "talonario": despues}
