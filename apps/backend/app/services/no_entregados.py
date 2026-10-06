"""Unidades de un producto que no se entregan (ver app/models/no_entregado.py).

A diferencia de una devolucion (app/services/devoluciones.py), no exige que
nada se haya entregado: cierra pendiente sin entregarlo (ej. el mostrador
facturo de mas o facturo un producto equivocado). Queda su propia fila en
`items_no_entregados` con motivo y quien la registro.
"""

from app.db import get_pool
from app.models.entrega import ItemEntrega
from app.models.log import EventoLog
from app.models.no_entregado import NoEntregadoCreate
from app.services.duplicates import RolNoAutorizado
from app.services.logging_service import registrar_evento


class NoEntregadoInvalido(Exception):
    """La cantidad supera lo pendiente, o el item no existe en esta entrega."""


async def registrar_no_entregado(entrega_id: str, payload: NoEntregadoCreate) -> ItemEntrega:
    """Mueve `cantidad` de pendiente a no entregada, de forma atomica.

    "and cantidad_pendiente >= $2" es la validacion real (mismo patron que
    registrar_devolucion). NO toca actualizado_at: asi el item no pasa a
    contar como "confirmado" (actualizado_at > creado_at) por esta accion y
    la primera confirmacion de cantidades sigue funcionando igual.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Mismo criterio de rol que aplicar_actualizacion_items: un id
            # desconocido (ej. el "supervisor" del dashboard) nunca bloquea.
            fila_empleado = await conn.fetchrow(
                "select rol from empleados where id::text = $1", payload.operador_id
            )
            if fila_empleado is not None and fila_empleado["rol"] in ("faia_viewer", "punto_venta"):
                raise RolNoAutorizado()

            fila = await conn.fetchrow(
                """
                update entrega_items
                set cantidad_pendiente = cantidad_pendiente - $2,
                    cantidad_no_entregada = cantidad_no_entregada + $2
                where id = $1::uuid and entrega_id = $3::uuid
                    and cantidad_pendiente >= $2
                returning id, descripcion, cantidad_entregada, cantidad_pendiente,
                    cantidad_no_entregada, nota, (actualizado_at > creado_at) as confirmado
                """,
                payload.item_id,
                payload.cantidad,
                entrega_id,
            )

            if fila is None:
                actual = await conn.fetchrow(
                    "select descripcion, cantidad_pendiente"
                    " from entrega_items where id = $1::uuid and entrega_id = $2::uuid",
                    payload.item_id,
                    entrega_id,
                )
                if actual is None:
                    raise NoEntregadoInvalido(f"El item {payload.item_id} no existe en esta entrega.")
                raise NoEntregadoInvalido(
                    f"'{actual['descripcion']}' solo tiene {actual['cantidad_pendiente']} pendiente, "
                    f"no se pueden marcar {payload.cantidad} como no entregadas."
                )

            await conn.execute(
                """
                insert into items_no_entregados (entrega_id, item_id, cantidad, motivo, motivo_detalle, operador_id, sede_id)
                values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
                """,
                entrega_id,
                payload.item_id,
                payload.cantidad,
                payload.motivo.value,
                payload.motivo_detalle,
                payload.operador_id,
                payload.sede_id,
            )

    await registrar_evento(
        EventoLog.ITEM_NO_ENTREGADO,
        entidad_tipo="entrega",
        entidad_id=entrega_id,
        actor_id=payload.operador_id,
        sede_id=payload.sede_id,
        resultado="ok",
        detalle={
            "item_id": payload.item_id,
            "producto": fila["descripcion"],
            "cantidad": payload.cantidad,
            "motivo": payload.motivo.value,
            "motivo_detalle": payload.motivo_detalle,
        },
    )

    return ItemEntrega(
        id=str(fila["id"]),
        descripcion=fila["descripcion"],
        cantidad_entregada=fila["cantidad_entregada"],
        cantidad_pendiente=fila["cantidad_pendiente"],
        cantidad_no_entregada=fila["cantidad_no_entregada"],
        nota=fila["nota"],
        confirmado=fila["confirmado"],
    )
