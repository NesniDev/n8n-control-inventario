"""Chequeo de duplicados entre sedes + flujo de items por entrega (ver plan en
docs/architecture.md): la barrera real sigue siendo el `unique (tipo,
indicativo_numero)` de la tabla `entregas` (ver app.db._SCHEMA) -- ej. no
puede haber dos "FEI 10254". Un documento puede traer varios productos
(`entrega_items`), y si al fotografiarlo de nuevo todavia le queda algo
pendiente en cualquier item, se devuelve para actualizar en vez de bloquear.
"""

import re
from datetime import datetime

import asyncpg

from app.db import get_pool
from app.models.entrega import (
    EstadoEntrega,
    ItemActualizacion,
    ItemEntrega,
    SituacionEntrega,
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


class _NecesitaTraslado(Exception):
    """Uso interno de procesar_extraccion: se dispara DENTRO de la
    transaccion tentativa (asi el insert que ya se hizo se deshace solo) para
    devolver SituacionEntrega.NECESITA_TRASLADO en vez de crear el
    documento -- ver _TIPO_SEDE_DUENA."""


# tipo (mayusculas) -> codigo de sedes.codigo (SEDE-01/SEDE-02, NO nombre --
# el nombre de una sede se puede renombrar, ej. "Sede Principal" ya paso a
# llamarse "Sede Centro", el codigo es el identificador estable). Un tipo que
# no esta aca (TB, RM3, RM2, o cualquier otro que la IA transcriba) no tiene
# sede duena, se procesa igual que siempre, sin esta restriccion.
_TIPO_SEDE_DUENA = {
    "EDP": "SEDE-02",  # Polo Sur
    "EDV": "SEDE-02",
    "FEI": "SEDE-01",  # Sede Centro
    "FV1": "SEDE-01",
}


def _concepto_referencia_factura(tipo: str, indicativo_numero: str, concepto_traslado: str) -> bool:
    """El concepto de la guia de traslado (campo de texto libre del
    documento, ver 'concepto' en vision._EXTRACTION_SCHEMA) debe mencionar
    el identificador de la factura para la que se pide la excepcion de sede
    -- no el tipo de la guia en si (que es TB, no el de la factura, asi que
    comparar el tipo del TRASLADO nunca coincidiria), sino la referencia
    "TIPO-INDICATIVO" tal como aparece impresa en el documento fisico (ej.
    "FEI-21542", con guion, no espacio). Buscar solo el numero suelto daria
    falsos positivos con cualquier numero que aparezca en el concepto por
    otro motivo -- el identificador completo es mucho mas dificil que
    coincida por casualidad con un traslado ajeno.

    Substring normalizado (upper + strip) en vez de igualdad exacta: el
    concepto es texto libre, puede traer palabras alrededor (ej. "Traslado
    por factura FEI-21542 a bodega central"). Tambien se colapsan los
    espacios pegados a un guion (tipico ruido de OCR: "FEI - 21542",
    "FEI -21542") -- sigue exigiendo el guion en si, no se relaja a buscar
    el numero suelto (eso ya se descarto por dar falsos positivos)."""
    numero = indicativo_numero.strip().upper()
    if not numero:
        return False
    identificador = f"{tipo.strip().upper()}-{numero}"
    concepto_normalizado = re.sub(r"\s*-\s*", "-", concepto_traslado.strip().upper())
    return identificador in concepto_normalizado


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
        select id, descripcion, cantidad_entregada, cantidad_pendiente, nota,
            (actualizado_at > creado_at) as confirmado
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
            nota=r["nota"],
            confirmado=r["confirmado"],
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
    traslado_url: str | None = None,
    concepto_traslado: str | None = None,
    items_traslado: list[dict] | None = None,
    traslado_tipo: str | None = None,
    traslado_indicativo_numero: str | None = None,
) -> tuple[SituacionEntrega, str | None, list[ItemEntrega], EstadoEntrega, str, str]:
    """Paso 1 del flujo (ver Figura 1 / docs/architecture.md):

    - No existia -> intenta insertarla (items = lo que leyo la IA, con
      cantidad_pendiente = cantidad_entregada hasta que el bodeguero confirme
      en el paso 2). El `unique(tipo, indicativo_numero)` de la tabla es la
      barrera real contra la carrera entre sedes -- se inserta primero y se
      atrapa la excepcion, no se pre-chequea con un select (mismo patron que
      ya usaba este modulo).
    - No existia, pero el tipo pertenece a otra sede (ver _TIPO_SEDE_DUENA) y
      no vino traslado_url, o vino pero su concepto no menciona el numero de
      la factura (ver _concepto_referencia_factura) -> no se inserta nada, se devuelve
      "necesita_traslado" (id=None) con lo que leyo la IA. Esto SOLO aplica
      al crear el documento -- una vez aceptado (con o sin traslado), el
      resto del ciclo (confirmar cantidades, devoluciones) sigue sin
      restriccion de sede, igual que hoy. Si el traslado SI se acepta y la
      factura se leyo con poca confianza en los items, se insertan los
      productos leidos del traslado en vez de los de la factura (ver
      confianza_items mas abajo).
    - Ya existia y le queda algo pendiente en cualquier item -> "actualizable",
      no se escribe nada todavia, se devuelven los items tal cual estan.
    - Ya existia y todo esta en pendiente=0 -> EntregaDuplicada (409).
    """
    pool = await get_pool()
    # .upper() ademas de .strip(): "tipo" ya no esta atado al enum de 4
    # valores conocidos (ver vision.py), la IA puede transcribir cualquier
    # texto -- sin normalizar el casing, "tb" y "TB" quedarian como
    # documentos distintos para la barrera anti-duplicado y para buscar_entrega.
    tipo = (extraido.get("tipo") or "FEI").strip().upper()
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
                        estado, confianza_ia, evidencia_url, operador_id, capturado_at,
                        procesado_at, traslado_url, traslado_tipo, traslado_indicativo_numero
                    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, $12)
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
                    traslado_url,
                    traslado_tipo,
                    traslado_indicativo_numero,
                )

                # Si el tipo pertenece a otra sede, se deshace este insert
                # (la excepcion adentro de la transaccion hace rollback sola)
                # y se devuelve necesita_traslado en vez de crear el
                # documento -- salvo que vino un traslado cuyo concepto
                # menciona el numero de esta factura (ver
                # _concepto_referencia_factura).
                dueno_esperado = _TIPO_SEDE_DUENA.get(tipo)
                if dueno_esperado is not None:
                    fila_sede = await conn.fetchrow(
                        "select codigo from sedes where id::text = $1", sede_origen_id
                    )
                    sede_no_coincide = fila_sede is None or fila_sede["codigo"] != dueno_esperado
                    if sede_no_coincide:
                        traslado_valido = traslado_url is not None and _concepto_referencia_factura(
                            tipo, indicativo_numero, concepto_traslado or ""
                        )
                        if not traslado_valido:
                            raise _NecesitaTraslado()

                        confianza_items = (extraido.get("confianza") or {}).get("items", 1.0)
                        if confianza_items < min_confidence and items_traslado:
                            # La factura no se leyo bien (nombres/cantidades
                            # poco legibles) y el traslado ya fue validado
                            # por numero -- se usan sus productos en vez de
                            # los de la factura, que en la practica suelen
                            # verse mejor en la guia de traslado. Reemplazo
                            # de la lista completa, no item por item
                            # (emparejar dos listas leidas por separado por
                            # OCR es fragil, misma razon por la que se
                            # descarto _items_coinciden).
                            items_extraidos = items_traslado

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
                            # Recien insertado, todavia nadie lo confirmo --
                            # ver el comentario en ItemEntrega.confirmado.
                            confirmado=False,
                        )
                    )
        except _NecesitaTraslado:
            # El insert de arriba ya se deshizo (rollback de la transaccion).
            # Se arman los items "vista previa" a partir de lo que leyo la
            # IA -- nunca se insertaron, por eso id="" (el movil no los usa
            # para nada mas que mostrar contexto en el aviso de traslado).
            items_vista = [
                ItemEntrega(
                    id="",
                    descripcion=str(it.get("descripcion") or ""),
                    cantidad_entregada=max(0, int(it.get("cantidad") or 0)),
                    cantidad_pendiente=max(0, int(it.get("cantidad") or 0)),
                    confirmado=False,
                )
                for it in items_extraidos
            ]
            return SituacionEntrega.NECESITA_TRASLADO, None, items_vista, estado, tipo, indicativo_numero
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
                    "select id, tipo, indicativo_numero from entregas where hash_evidencia = $1",
                    hash_evidencia,
                )
            else:
                fila = await conn.fetchrow(
                    "select id, tipo, indicativo_numero from entregas"
                    " where tipo = $1 and indicativo_numero = $2",
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
            return (
                SituacionEntrega.ACTUALIZABLE,
                str(fila["id"]),
                items,
                estado,
                fila["tipo"],
                fila["indicativo_numero"],
            )
        else:
            await registrar_evento(
                EventoLog.ENTREGA_INSERTADA,
                entidad_tipo="entrega",
                entidad_id=str(entrega_id),
                actor_id=operador_id,
                sede_id=sede_origen_id,
                resultado="ok",
            )
            return SituacionEntrega.NUEVA, str(entrega_id), items, estado, tipo, indicativo_numero


async def aplicar_actualizacion_items(
    entrega_id: str,
    items: list[ItemActualizacion],
    *,
    operador_id: str,
    sede_id: str,
    evidencia_url: str | None = None,
    hash_evidencia: str | None = None,
    firma_url: str | None = None,
) -> list[ItemEntrega]:
    """Paso 2: confirma una entrega nueva (cantidad_pendiente absoluta) o
    aplica una actualizacion incremental (entregado_hoy, sumado/restado
    atomicamente en SQL -- asi dos visitas casi simultaneas al mismo item no
    se pisan). Cualquier sede puede llamar esto, no solo la que la creo."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
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
                    fila = await conn.fetchrow(
                        """
                        update entrega_items
                        set descripcion = coalesce($4, descripcion),
                            nota = coalesce($5, nota),
                            cantidad_entregada = cantidad_entregada + $2,
                            cantidad_pendiente = cantidad_pendiente - $2,
                            actualizado_at = now()
                        where id = $1::uuid and entrega_id = $3::uuid and cantidad_pendiente >= $2
                        returning id
                        """,
                        item.id,
                        item.entregado_hoy,
                        entrega_id,
                        item.descripcion,
                        item.nota,
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
                        raise CantidadInvalida(
                            f"'{actual['descripcion']}' tiene {actual['cantidad_pendiente']} pendiente, "
                            f"no se puede entregar {item.entregado_hoy}."
                        )
                else:
                    # Valores absolutos -- confirmar una entrega nueva desde
                    # el movil (solo cantidad_pendiente), o correccion manual
                    # desde el dashboard (cualquier combinacion de campos).
                    await conn.execute(
                        """
                        update entrega_items
                        set descripcion = coalesce($2, descripcion),
                            cantidad_entregada = coalesce($3, cantidad_entregada),
                            cantidad_pendiente = coalesce($4, cantidad_pendiente),
                            nota = coalesce($6, nota),
                            actualizado_at = now()
                        where id = $1::uuid and entrega_id = $5::uuid
                        """,
                        item.id,
                        item.descripcion,
                        item.cantidad_entregada,
                        item.cantidad_pendiente,
                        entrega_id,
                        item.nota,
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

            if firma_url:
                await conn.execute(
                    "update entregas set firma_url = $2, actualizado_at = now() where id = $1::uuid",
                    entrega_id,
                    firma_url,
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
