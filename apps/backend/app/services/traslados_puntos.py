"""Logica de negocio del flujo de traslados entre puntos -- ver el plan
"traslados-entre-puntos". Flujo aparte del pipeline de despachos
(docs/architecture.md): tablas aditivas, no toca entregas/sedes/empleados.
"""

import asyncpg

from app.db import get_pool
from app.models.log import EventoLog
from app.models.traslado_punto import RecepcionTraslado, SolucionNovedad, TrasladoPuntoCrear
from app.services.logging_service import registrar_evento


class TrasladoInvalido(Exception):
    """Validacion de negocio fallida al crear o recibir un traslado (puntos
    invalidos, firmas faltantes, items que no pertenecen al traslado,
    cantidad recibida por encima de lo enviado, etc.) -- se traduce a 422 en
    el router."""


class TrasladoNoEncontrado(Exception):
    pass


class TrasladoYaRecibido(Exception):
    """El traslado ya no esta 'en_transito' -- alguien mas ya lo recibio
    (ver el update atomico en registrar_recepcion). Se traduce a 409."""


class NovedadNoEncontrada(Exception):
    """No existe un traslado con ese id -- se traduce a 404."""


class NovedadInvalida(Exception):
    """El traslado no tiene novedad para resolver, o el supervisor no existe
    / esta inactivo -- se traduce a 422."""


class NovedadYaResuelta(Exception):
    """La novedad ya estaba en 'resuelta' -- alguien mas (u otra pestaña de
    Erika) ya la resolvio antes (ver el update atomico en resolver_novedad).
    Se traduce a 409, mismo criterio que TrasladoYaRecibido."""


class ConsecutivoDuplicado(Exception):
    """Ya existe una novedad resuelta archivada bajo ese mismo consecutivo
    (indice unico parcial traslados_puntos_consecutivo_solucion_key, ver
    app/db.py) -- se traduce a 409, con un detail distinto del de
    NovedadYaResuelta para que el movil pueda distinguir los dos casos (ver
    esErrorConsecutivoDuplicado en apps/mobile/errorMessages.ts)."""


async def crear_traslado(payload: TrasladoPuntoCrear) -> dict:
    if payload.punto_origen_id == payload.punto_destino_id:
        raise TrasladoInvalido("El punto de origen y el de destino no pueden ser el mismo")
    if not payload.firma_despacha_url or not payload.firma_transporta_url:
        raise TrasladoInvalido("Faltan las firmas de quien despacha y/o de quien transporta")

    pool = await get_pool()
    origen = await pool.fetchrow(
        "select id from puntos where id = $1::uuid and activo = true", payload.punto_origen_id
    )
    if origen is None:
        raise TrasladoInvalido("El punto de origen no existe o esta inactivo")
    destino = await pool.fetchrow(
        "select id from puntos where id = $1::uuid and activo = true", payload.punto_destino_id
    )
    if destino is None:
        raise TrasladoInvalido("El punto de destino no existe o esta inactivo")
    creador = await pool.fetchrow(
        "select punto_id from usuarios_punto where id = $1::uuid and estado = 'activo'",
        payload.creado_por,
    )
    if creador is None or str(creador["punto_id"]) != payload.punto_origen_id:
        raise TrasladoInvalido("Quien despacha debe pertenecer al punto de origen")

    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                fila = await conn.fetchrow(
                    """
                    insert into traslados_puntos (
                        id, punto_origen_id, punto_destino_id, transportador_nombre,
                        fecha, observaciones, firma_despacha_url, firma_transporta_url, creado_por,
                        numero_talonario
                    )
                    values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid, $10)
                    returning *
                    """,
                    payload.id,
                    payload.punto_origen_id,
                    payload.punto_destino_id,
                    payload.transportador_nombre,
                    payload.fecha,
                    payload.observaciones,
                    payload.firma_despacha_url,
                    payload.firma_transporta_url,
                    payload.creado_por,
                    payload.numero_talonario,
                )
            except asyncpg.UniqueViolationError as exc:
                # id repetido (ya generado y enviado antes -- ej. reintento
                # tras un timeout de red) -- no deberia pasar en uso normal
                # (uuid del celular), pero falla con un mensaje claro en vez
                # de un 500 crudo.
                raise TrasladoInvalido("Ya existe un traslado con ese id") from exc

            items = []
            for item in payload.items:
                fila_item = await conn.fetchrow(
                    """
                    insert into traslado_punto_items (traslado_id, cantidad, producto, marca, presentacion)
                    values ($1::uuid, $2, $3, $4, $5)
                    returning *
                    """,
                    payload.id,
                    item.cantidad,
                    item.producto,
                    item.marca,
                    item.presentacion,
                )
                items.append(dict(fila_item))

    await registrar_evento(
        EventoLog.TRASLADO_PUNTO_CREADO,
        entidad_tipo="traslado_punto",
        entidad_id=payload.id,
        actor_id=payload.creado_por,
        sede_id=payload.punto_origen_id,
        resultado="ok",
        detalle={"punto_destino_id": payload.punto_destino_id, "cantidad_items": len(items)},
    )

    resultado = dict(fila)
    resultado["items"] = items
    return resultado


async def registrar_recepcion(traslado_id: str, payload: RecepcionTraslado) -> dict:
    pool = await get_pool()

    traslado = await pool.fetchrow("select * from traslados_puntos where id = $1::uuid", traslado_id)
    if traslado is None:
        raise TrasladoNoEncontrado("Traslado no encontrado")

    items_actuales = await pool.fetch(
        "select * from traslado_punto_items where traslado_id = $1::uuid", traslado_id
    )
    items_por_id = {str(i["id"]): i for i in items_actuales}

    for item_recibido in payload.items:
        actual = items_por_id.get(item_recibido.id)
        if actual is None:
            raise TrasladoInvalido(f"El item {item_recibido.id} no pertenece a este traslado")
        if item_recibido.cantidad_recibida > actual["cantidad"]:
            raise TrasladoInvalido(
                f"No se puede recibir mas de lo enviado ({actual['cantidad']}) de '{actual['producto']}'"
            )

    # Con novedad si falto cantidad en alguna linea, o si se cargo una
    # novedad (general o por item) -- ver EstadoTrasladoPunto.
    tiene_novedad = bool((payload.novedad or "").strip()) or any(
        item.cantidad_recibida < items_por_id[item.id]["cantidad"] or bool((item.novedad or "").strip())
        for item in payload.items
    )
    nuevo_estado = "recibido_con_novedad" if tiene_novedad else "recibido"

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Update atomico guardado por estado='en_transito': si dos
            # personas confirman la recepcion casi al mismo tiempo (o el
            # mismo dispositivo reintenta tras un timeout), solo la primera
            # actualiza algo -- la segunda no encuentra fila y cae al 409 de
            # abajo, sin tocar los items.
            actualizado = await conn.fetchrow(
                """
                update traslados_puntos
                set estado = $2, recibido_por = $3::uuid, recibido_at = now(),
                    novedad = $4, firma_recibe_url = $5,
                    novedad_estado = case when $2 = 'recibido_con_novedad' then 'pendiente' else novedad_estado end
                where id = $1::uuid and estado = 'en_transito'
                returning *
                """,
                traslado_id,
                nuevo_estado,
                payload.recibido_por,
                payload.novedad,
                payload.firma_recibe_url,
            )
            if actualizado is None:
                raise TrasladoYaRecibido("Este traslado ya fue recibido")

            items_actualizados = []
            for item_recibido in payload.items:
                fila_item = await conn.fetchrow(
                    """
                    update traslado_punto_items
                    set cantidad_recibida = $2, novedad = $3
                    where id = $1::uuid
                    returning *
                    """,
                    item_recibido.id,
                    item_recibido.cantidad_recibida,
                    item_recibido.novedad,
                )
                items_actualizados.append(dict(fila_item))

    await registrar_evento(
        EventoLog.TRASLADO_PUNTO_RECIBIDO,
        entidad_tipo="traslado_punto",
        entidad_id=traslado_id,
        actor_id=payload.recibido_por,
        sede_id=str(traslado["punto_destino_id"]),
        resultado=nuevo_estado,
    )
    if nuevo_estado == "recibido_con_novedad":
        await registrar_evento(
            EventoLog.TRASLADO_PUNTO_NOVEDAD,
            entidad_tipo="traslado_punto",
            entidad_id=traslado_id,
            actor_id=payload.recibido_por,
            sede_id=str(traslado["punto_destino_id"]),
            resultado="ok",
            detalle={"novedad": payload.novedad},
        )

    resultado = dict(actualizado)
    resultado["items"] = items_actualizados
    return resultado


async def resolver_novedad(traslado_id: str, payload: SolucionNovedad) -> dict:
    """Supervision (Erika) carga la solucion de una novedad ya registrada por
    registrar_recepcion. No valida contra los items -- la novedad puede ser
    tanto una diferencia de cantidad como algo cualitativo (ver
    registrar_recepcion), la solucion es texto libre en cualquier caso."""
    pool = await get_pool()

    traslado = await pool.fetchrow("select * from traslados_puntos where id = $1::uuid", traslado_id)
    if traslado is None:
        raise NovedadNoEncontrada("Traslado no encontrado")
    if traslado["novedad_estado"] is None:
        raise NovedadInvalida("Este traslado no tiene una novedad para resolver")

    supervisor = await pool.fetchrow(
        "select id from supervisores where id = $1::uuid and estado = 'activo'", payload.supervisor_id
    )
    if supervisor is None:
        raise NovedadInvalida("Supervisor invalido o inactivo")

    # El codigo ya viene normalizado a mayusculas (ver _consecutivo_codigo_valido
    # en SolucionNovedad) -- aca se valida que exista de verdad y este activo,
    # cosa que el validador de pydantic no puede hacer (no tiene el pool async).
    punto_consecutivo = await pool.fetchrow(
        "select id from puntos where codigo = $1 and activo = true", payload.consecutivo_codigo
    )
    if punto_consecutivo is None:
        raise NovedadInvalida("El código de punto del consecutivo no es válido")

    consecutivo_solucion = f"{payload.consecutivo_codigo}-{payload.consecutivo_numero}"

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Update atomico guardado por novedad_estado='pendiente' --
            # mismo criterio que el guard estado='en_transito' de
            # registrar_recepcion: si dos supervisores (o dos pestañas de la
            # misma) resuelven casi al mismo tiempo, solo la primera
            # actualiza algo, la segunda cae al 409 de abajo. El
            # UniqueViolationError del indice parcial sobre
            # consecutivo_solucion es un conflicto aparte (mismo consecutivo
            # ya usado por OTRA novedad) -- se traduce a un 409 distinto.
            try:
                actualizado = await conn.fetchrow(
                    """
                    update traslados_puntos
                    set novedad_estado = 'resuelta', solucion = $2, solucionado_por = $3::uuid,
                        solucionado_at = now(), consecutivo_solucion = $4
                    where id = $1::uuid and novedad_estado = 'pendiente'
                    returning *
                    """,
                    traslado_id,
                    payload.solucion,
                    payload.supervisor_id,
                    consecutivo_solucion,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ConsecutivoDuplicado("Ese consecutivo ya está registrado") from exc
            if actualizado is None:
                raise NovedadYaResuelta("Esta novedad ya fue resuelta")

            items = await conn.fetch(
                "select * from traslado_punto_items where traslado_id = $1::uuid order by id", traslado_id
            )

    await registrar_evento(
        EventoLog.TRASLADO_PUNTO_NOVEDAD_RESUELTA,
        entidad_tipo="traslado_punto",
        entidad_id=traslado_id,
        actor_id=payload.supervisor_id,
        sede_id=str(traslado["punto_destino_id"]),
        resultado="ok",
    )

    resultado = dict(actualizado)
    resultado["items"] = [dict(i) for i in items]
    return resultado
