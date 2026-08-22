"""Devolucion de un producto ya entregado (ver app/models/devolucion.py).

Es un evento distinto a confirmar cantidades (app/services/duplicates.py):
cambia entregada Y pendiente a la vez, segun como se resuelva, y queda su
propia fila en `devoluciones` con motivo/resolucion/quien la registro --
mutar entrega_items a secas no alcanza para dejar ese registro.
"""

from app.db import get_pool
from app.models.entrega import ItemEntrega
from app.models.devolucion import DevolucionCreate, ResolucionDevolucion
from app.models.log import EventoLog
from app.services.logging_service import registrar_evento


class DevolucionInvalida(Exception):
    """La cantidad a devolver supera lo que consta como entregado, o el item
    no existe en esta entrega."""


async def registrar_devolucion(entrega_id: str, payload: DevolucionCreate) -> ItemEntrega:
    """Aplica la devolucion sobre el item y deja el registro.

    - reposicion: cantidad_entregada baja, cantidad_pendiente sube la misma
      cantidad -- el total del item no cambia, se debe re-entregar lo correcto.
    - reembolso: cantidad_entregada baja, cantidad_pendiente queda igual --
      el total del item se achica, esas unidades quedan cerradas del todo
      (se devolvio el dinero, no se debe una reposicion).

    En los dos casos el UPDATE es atomico y condicionado (mismo patron que
    aplicar_actualizacion_items con entregado_hoy): "and cantidad_entregada
    >= $cantidad" es la validacion real -- si no hay fila que la cumpla, no
    se puede devolver mas de lo que consta como entregado.

    Ademas "and actualizado_at > creado_at": un item recien insertado por
    procesar_extraccion trae cantidad_entregada = cantidad_pendiente = lo
    que leyo la IA (ver ese modulo) -- ANTES de que nadie confirme nada. Sin
    este chequeo, "cantidad_entregada >= $cantidad" solo no alcanza para
    saber si algo se entrego de verdad: un documento recien escaneado (nunca
    confirmado via aplicar_actualizacion_items) pasaria igual. actualizado_at
    solo avanza con una confirmacion real (paso 2) o una devolucion previa,
    nunca con el insert -- ver ItemEntrega.confirmado.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if payload.resolucion == ResolucionDevolucion.REPOSICION:
                fila = await conn.fetchrow(
                    """
                    update entrega_items
                    set cantidad_entregada = cantidad_entregada - $2,
                        cantidad_pendiente = cantidad_pendiente + $2,
                        actualizado_at = now()
                    where id = $1::uuid and entrega_id = $3::uuid
                        and cantidad_entregada >= $2 and actualizado_at > creado_at
                    returning id, descripcion, cantidad_entregada, cantidad_pendiente, nota
                    """,
                    payload.item_id,
                    payload.cantidad,
                    entrega_id,
                )
            else:
                fila = await conn.fetchrow(
                    """
                    update entrega_items
                    set cantidad_entregada = cantidad_entregada - $2,
                        actualizado_at = now()
                    where id = $1::uuid and entrega_id = $3::uuid
                        and cantidad_entregada >= $2 and actualizado_at > creado_at
                    returning id, descripcion, cantidad_entregada, cantidad_pendiente, nota
                    """,
                    payload.item_id,
                    payload.cantidad,
                    entrega_id,
                )

            if fila is None:
                actual = await conn.fetchrow(
                    "select descripcion, cantidad_entregada, (actualizado_at > creado_at) as confirmado"
                    " from entrega_items where id = $1::uuid and entrega_id = $2::uuid",
                    payload.item_id,
                    entrega_id,
                )
                if actual is None:
                    raise DevolucionInvalida(f"El item {payload.item_id} no existe en esta entrega.")
                if not actual["confirmado"]:
                    raise DevolucionInvalida(
                        f"'{actual['descripcion']}' todavia no fue confirmado -- nada de ese item "
                        "se entrego de verdad, no se puede registrar una devolucion."
                    )
                raise DevolucionInvalida(
                    f"'{actual['descripcion']}' solo tiene {actual['cantidad_entregada']} entregado, "
                    f"no se puede devolver {payload.cantidad}."
                )

            await conn.execute(
                """
                insert into devoluciones (entrega_id, item_id, cantidad, motivo, resolucion, operador_id, sede_id)
                values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
                """,
                entrega_id,
                payload.item_id,
                payload.cantidad,
                payload.motivo.value,
                payload.resolucion.value,
                payload.operador_id,
                payload.sede_id,
            )

    await registrar_evento(
        EventoLog.DEVOLUCION_REGISTRADA,
        entidad_tipo="entrega",
        entidad_id=entrega_id,
        actor_id=payload.operador_id,
        sede_id=payload.sede_id,
        resultado="ok",
        detalle={
            "item_id": payload.item_id,
            "cantidad": payload.cantidad,
            "motivo": payload.motivo.value,
            "resolucion": payload.resolucion.value,
        },
    )

    return ItemEntrega(
        id=str(fila["id"]),
        descripcion=fila["descripcion"],
        cantidad_entregada=fila["cantidad_entregada"],
        cantidad_pendiente=fila["cantidad_pendiente"],
        nota=fila["nota"],
        confirmado=True,  # el guard de arriba ya exigio actualizado_at > creado_at
    )
