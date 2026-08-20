"""Chequeo de duplicados entre sedes + flujo de items por entrega (ver plan en
docs/architecture.md): la barrera real sigue siendo el `unique (tipo,
indicativo_numero)` de la tabla `entregas` (ver app.db._SCHEMA) -- ej. no
puede haber dos "FEI 10254". Un documento puede traer varios productos
(`entrega_items`), y si al fotografiarlo de nuevo todavia le queda algo
pendiente en cualquier item, se devuelve para actualizar en vez de bloquear.
"""

from datetime import datetime

import asyncpg

from app.db import get_pool
from app.models.entrega import (
    EstadoEntrega,
    ItemActualizacion,
    ItemEntrega,
    SituacionEntrega,
    TipoDocumento,
)
from app.models.log import EventoLog
from app.services.logging_service import registrar_evento


def _identificador(tipo: str, indicativo_numero: str) -> str:
    """Ej: 'FEI 10254' -- como lo nombran en el documento fisico."""
    return f"{tipo or '?'} {indicativo_numero or 'sin numero'}"


class EntregaDuplicada(Exception):
    def __init__(self, identificador: str, mensaje: str | None = None):
        self.identificador = identificador
        super().__init__(mensaje or f"El documento {identificador} ya fue procesado por completo.")


class CantidadInvalida(Exception):
    """entregado_hoy pide mas de lo que queda pendiente, o el item no existe
    en esta entrega -- ver aplicar_actualizacion_items."""


def marcar_estado_por_confianza(confianza: dict[str, float], min_confidence: float) -> EstadoEntrega:
    # Las cantidades quedan afuera del gate: siempre las confirma el
    # bodeguero a mano en el paso 2 (ver procesar_extraccion), sin importar
    # que tan segura estuvo la IA al leerlas.
    campos_criticos = ("tipo", "indicativo_numero")
    if any(confianza.get(campo, 0.0) < min_confidence for campo in campos_criticos):
        return EstadoEntrega.PENDIENTE_REVISION
    return EstadoEntrega.PROCESADA


async def _items_de_entrega(conn: asyncpg.Connection, entrega_id) -> list[ItemEntrega]:
    rows = await conn.fetch(
        """
        select id, descripcion, cantidad_entregada, cantidad_pendiente
        from entrega_items where entrega_id = $1::uuid
        order by creado_at
        """,
        entrega_id,
    )
    return [
        ItemEntrega(
            id=str(r["id"]),
            descripcion=r["descripcion"],
            cantidad_entregada=r["cantidad_entregada"],
            cantidad_pendiente=r["cantidad_pendiente"],
        )
        for r in rows
    ]


async def procesar_extraccion(
    extraido: dict,
    *,
    hash_evidencia: str,
    sede_origen_id: str,
    operador_id: str,
    capturado_at: datetime,
    evidencia_url: str,
    min_confidence: float,
) -> tuple[SituacionEntrega, str, list[ItemEntrega], EstadoEntrega, str]:
    """Paso 1 del flujo (ver Figura 1 / docs/architecture.md):

    - No existia -> intenta insertarla (items = lo que leyo la IA, con
      cantidad_pendiente = cantidad_entregada hasta que el bodeguero confirme
      en el paso 2). El `unique(tipo, indicativo_numero)` de la tabla es la
      barrera real contra la carrera entre sedes -- se inserta primero y se
      atrapa la excepcion, no se pre-chequea con un select (mismo patron que
      ya usaba este modulo).
    - Ya existia y le queda algo pendiente en cualquier item -> "actualizable",
      no se escribe nada todavia, se devuelven los items tal cual estan.
    - Ya existia y todo esta en pendiente=0 -> EntregaDuplicada (409).
    """
    pool = await get_pool()
    tipo = (extraido.get("tipo") or "FEI").strip()
    indicativo_numero = (extraido.get("indicativo_numero") or "").strip()
    identificador = _identificador(tipo, indicativo_numero)
    estado = marcar_estado_por_confianza(extraido.get("confianza", {}), min_confidence)
    items_extraidos = extraido.get("items") or []

    async with pool.acquire() as conn:
        try:
            async with conn.transaction():
                entrega_id = await conn.fetchval(
                    """
                    insert into entregas (
                        tipo, indicativo_numero, hash_evidencia, sede_origen_id,
                        estado, confianza_ia, evidencia_url, operador_id, capturado_at, procesado_at
                    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
                    returning id
                    """,
                    tipo,
                    indicativo_numero,
                    hash_evidencia,
                    sede_origen_id,
                    estado.value,
                    extraido.get("confianza", {}),
                    evidencia_url,
                    operador_id,
                    capturado_at,
                )
                items: list[ItemEntrega] = []
                for it in items_extraidos:
                    cantidad = max(0, int(it.get("cantidad") or 0))
                    descripcion = str(it.get("descripcion") or "")
                    item_id = await conn.fetchval(
                        """
                        insert into entrega_items (entrega_id, descripcion, cantidad_entregada, cantidad_pendiente)
                        values ($1, $2, $3, $3)
                        returning id
                        """,
                        entrega_id,
                        descripcion,
                        cantidad,
                    )
                    items.append(
                        ItemEntrega(
                            id=str(item_id),
                            descripcion=descripcion,
                            cantidad_entregada=cantidad,
                            cantidad_pendiente=cantidad,
                        )
                    )
        except asyncpg.UniqueViolationError as exc:
            # "entregas" tiene DOS unique: (tipo, indicativo_numero) -- la
            # barrera real -- y hash_evidencia -- evita reprocesar la misma
            # foto. Hay que fijarse cual de los dos choco antes de buscar la
            # fila existente, si no la busqueda puede no encontrar nada
            # (ej. mismo hash_evidencia pero tipo/indicativo distintos, como
            # al reusar una foto de la galeria para otro documento) y
            # explotar con un TypeError en vez de responder algo coherente.
            if exc.constraint_name == "entregas_hash_evidencia_key":
                fila = await conn.fetchrow(
                    "select id, tipo from entregas where hash_evidencia = $1", hash_evidencia
                )
            else:
                fila = await conn.fetchrow(
                    "select id, tipo from entregas where tipo = $1 and indicativo_numero = $2",
                    tipo,
                    indicativo_numero,
                )
            if fila is None:
                raise
            items = await _items_de_entrega(conn, fila["id"])
            if all(item.cantidad_pendiente == 0 for item in items):
                await registrar_evento(
                    EventoLog.DUPLICADO_BLOQUEADO,
                    entidad_tipo="entrega",
                    entidad_id=identificador,
                    actor_id=operador_id,
                    sede_id=sede_origen_id,
                    resultado="bloqueado",
                    detalle={"tipo": tipo, "indicativo_numero": indicativo_numero},
                )
                raise EntregaDuplicada(identificador)
            return SituacionEntrega.ACTUALIZABLE, str(fila["id"]), items, estado, fila["tipo"]
        else:
            await registrar_evento(
                EventoLog.ENTREGA_INSERTADA,
                entidad_tipo="entrega",
                entidad_id=str(entrega_id),
                actor_id=operador_id,
                sede_id=sede_origen_id,
                resultado="ok",
            )
            return SituacionEntrega.NUEVA, str(entrega_id), items, estado, tipo


async def aplicar_actualizacion_items(
    entrega_id: str,
    items: list[ItemActualizacion],
    *,
    operador_id: str,
    sede_id: str,
    evidencia_url: str | None = None,
    hash_evidencia: str | None = None,
) -> list[ItemEntrega]:
    """Paso 2: confirma una entrega nueva (cantidad_pendiente absoluta) o
    aplica una actualizacion incremental (entregado_hoy, sumado/restado
    atomicamente en SQL -- asi dos visitas casi simultaneas al mismo item no
    se pisan). Cualquier sede puede llamar esto, no solo la que la creo."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Un traslado (TB) no puede quedar con nada pendiente -- se
            # entrega siempre completo, en una sola visita. Se valida aca
            # (no en el modelo Pydantic) porque hace falta saber el tipo de
            # la entrega, que no viaja en el payload de este endpoint.
            es_traslado = await conn.fetchval(
                "select tipo = $2 from entregas where id = $1::uuid",
                entrega_id,
                TipoDocumento.TB.value,
            )

            for item in items:
                if item.entregado_hoy is not None:
                    # Delta atomico en SQL -- no se lee-modifica-escribe desde
                    # Python, asi dos confirmaciones casi simultaneas al mismo
                    # item no se pisan entre si. El "and cantidad_pendiente >=
                    # $2" es la validacion real (no se puede entregar mas de
                    # lo que queda pendiente): si no hay fila que cumpla la
                    # condicion, el update no afecta ninguna fila y sabemos
                    # que hay que rechazar -- antes esto se "resolvia" con
                    # greatest(0, ...), que dejaba pendiente en 0 pero sumaba
                    # el delta completo a cantidad_entregada igual, rompiendo
                    # la cuenta (entregada + pendiente ya no daba el total).
                    # Para un traslado, "entregado hoy" tiene que cubrir TODO
                    # el pendiente (no se permite un delta parcial) -- por eso
                    # la condicion pasa de ">=" a "=" cuando es_traslado.
                    condicion_pendiente = "cantidad_pendiente = $2" if es_traslado else "cantidad_pendiente >= $2"
                    fila = await conn.fetchrow(
                        f"""
                        update entrega_items
                        set descripcion = coalesce($4, descripcion),
                            cantidad_entregada = cantidad_entregada + $2,
                            cantidad_pendiente = cantidad_pendiente - $2,
                            actualizado_at = now()
                        where id = $1::uuid and entrega_id = $3::uuid and {condicion_pendiente}
                        returning id
                        """,
                        item.id,
                        item.entregado_hoy,
                        entrega_id,
                        item.descripcion,
                    )
                    if fila is None:
                        actual = await conn.fetchrow(
                            "select descripcion, cantidad_pendiente from entrega_items"
                            " where id = $1::uuid and entrega_id = $2::uuid",
                            item.id,
                            entrega_id,
                        )
                        if actual is None:
                            raise CantidadInvalida(f"El item {item.id} no existe en esta entrega.")
                        if es_traslado:
                            raise CantidadInvalida(
                                f"'{actual['descripcion']}' es un traslado (TB): se tiene que entregar "
                                f"todo el pendiente ({actual['cantidad_pendiente']}) de una vez, no se "
                                f"puede dejar nada para despues."
                            )
                        raise CantidadInvalida(
                            f"'{actual['descripcion']}' tiene {actual['cantidad_pendiente']} pendiente, "
                            f"no se puede entregar {item.entregado_hoy}."
                        )
                else:
                    # Un traslado tampoco puede quedar pendiente al confirmar
                    # una entrega nueva (o via correccion manual del
                    # dashboard) -- siempre se declara todo entregado.
                    if es_traslado and item.cantidad_pendiente not in (None, 0):
                        # El payload del movil no manda descripcion (solo id +
                        # cantidad_pendiente) -- se busca en la DB para que el
                        # mensaje diga el nombre del producto, no el uuid.
                        descripcion = item.descripcion
                        if not descripcion:
                            descripcion = await conn.fetchval(
                                "select descripcion from entrega_items where id = $1::uuid", item.id
                            )
                        raise CantidadInvalida(
                            f"'{descripcion or item.id}' es un traslado (TB): no puede quedar "
                            f"pendiente, se debe entregar todo."
                        )
                    # Valores absolutos -- confirmar una entrega nueva desde
                    # el movil (solo cantidad_pendiente), o correccion manual
                    # desde el dashboard (cualquier combinacion de campos).
                    await conn.execute(
                        """
                        update entrega_items
                        set descripcion = coalesce($2, descripcion),
                            cantidad_entregada = coalesce($3, cantidad_entregada),
                            cantidad_pendiente = coalesce($4, cantidad_pendiente),
                            actualizado_at = now()
                        where id = $1::uuid and entrega_id = $5::uuid
                        """,
                        item.id,
                        item.descripcion,
                        item.cantidad_entregada,
                        item.cantidad_pendiente,
                        entrega_id,
                    )

            if evidencia_url and hash_evidencia:
                await conn.execute(
                    """
                    update entregas
                    set evidencia_url = $2, hash_evidencia = $3, actualizado_at = now()
                    where id = $1::uuid
                    """,
                    entrega_id,
                    evidencia_url,
                    hash_evidencia,
                )

            items_actualizados = await _items_de_entrega(conn, entrega_id)

    await registrar_evento(
        EventoLog.ENTREGA_ACTUALIZADA,
        entidad_tipo="entrega",
        entidad_id=entrega_id,
        actor_id=operador_id,
        sede_id=sede_id,
        resultado="ok",
        detalle={
            "items": [
                {
                    "id": i.id,
                    "cantidad_entregada": i.cantidad_entregada,
                    "cantidad_pendiente": i.cantidad_pendiente,
                }
                for i in items_actualizados
            ],
            "evidencia_url": evidencia_url,
        },
    )
    return items_actualizados


async def cancelar_entrega_no_confirmada(
    entrega_id: str, *, operador_id: str, sede_id: str
) -> bool:
    """El bodeguero le saca una foto a un documento, ve la pantalla de
    confirmacion (paso 2) y decide cancelar sin confirmar nada. El paso 1
    (procesar_extraccion) ya inserto la entrega -- es la barrera atomica
    contra la carrera entre sedes, no se puede evitar eso -- asi que
    "cancelar" en la practica significa deshacer ese insert.

    Solo borra si TODAVIA nadie confirmo nada: cada item sigue con
    cantidad_pendiente == cantidad_entregada, que es exactamente como queda
    un item recien insertado por procesar_extraccion, antes de que
    aplicar_actualizacion_items lo toque. Esto evita dos cosas: borrar una
    entrega real que ya tenia historial (nunca deberia pasar, pero mejor
    prevenir por las dudas), y una carrera rara donde otra sede ya la
    actualizo mientras este bodeguero decidia cancelar.

    Idempotente: si el id no existe o ya se confirmo algo, no hace nada y
    devuelve False -- cancelar nunca deberia ser un error para el movil.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        resultado = await conn.execute(
            """
            delete from entregas
            where id = $1::uuid
              and not exists (
                  select 1 from entrega_items
                  where entrega_id = $1::uuid and cantidad_pendiente <> cantidad_entregada
              )
            """,
            entrega_id,
        )

    borrado = resultado == "DELETE 1"
    if borrado:
        await registrar_evento(
            EventoLog.ENTREGA_CANCELADA,
            entidad_tipo="entrega",
            entidad_id=entrega_id,
            actor_id=operador_id,
            sede_id=sede_id,
            resultado="ok",
        )
    return borrado
