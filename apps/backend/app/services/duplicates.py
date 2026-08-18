"""Chequeo de duplicados entre sedes: la barrera real es el `unique
(tipo, indicativo_numero)` de la tabla `entregas` (ver app.db._SCHEMA) — por
ejemplo, no puede haber dos entregas 'FEI 10254'. Este modulo solo traduce la
violacion de esa restriccion en una respuesta de negocio + logging. Ver
Figura 1 del diagrama.
"""

import asyncpg

from app.db import get_pool
from app.models.entrega import EstadoEntrega
from app.models.log import EventoLog
from app.services.logging_service import registrar_evento


def _identificador(entrega: dict) -> str:
    """Ej: 'FEI 10254' — como lo nombran en el documento fisico."""
    return f"{entrega.get('tipo', '?')} {entrega.get('indicativo_numero') or 'sin numero'}"


class EntregaDuplicada(Exception):
    def __init__(self, identificador: str, mensaje: str | None = None):
        self.identificador = identificador
        super().__init__(mensaje or f"El documento {identificador} ya fue procesado por otra sede.")


async def insertar_si_no_duplicada(entrega: dict, *, actor_id: str, sede_id: str) -> str:
    """Intenta insertar la entrega. Si la restriccion unique de la DB la
    rechaza (mismo tipo+indicativo_numero, o mismo hash de evidencia),
    registra el intento de duplicado (quien, cuando, desde donde) y relanza
    como EntregaDuplicada para que el router responda 409.

    Retorna el id insertado en el caso exitoso.
    """
    pool = await get_pool()
    identificador = _identificador(entrega)

    try:
        entrega_id = await pool.fetchval(
            """
            insert into entregas (
                tipo, indicativo_numero, hash_evidencia, sede_origen_id,
                cantidad_entregada, cantidad_pendiente, estado, confianza_ia,
                evidencia_url, operador_id, capturado_at, procesado_at
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
            returning id
            """,
            entrega["tipo"],
            entrega["indicativo_numero"],
            entrega["hash_evidencia"],
            entrega["sede_origen_id"],
            entrega["cantidad_entregada"],
            entrega["cantidad_pendiente"],
            entrega["estado"],
            entrega["confianza_ia"],
            entrega["evidencia_url"],
            entrega["operador_id"],
            entrega["capturado_at"],
        )
    except asyncpg.UniqueViolationError:
        await registrar_evento(
            EventoLog.DUPLICADO_BLOQUEADO,
            entidad_tipo="entrega",
            entidad_id=identificador,
            actor_id=actor_id,
            sede_id=sede_id,
            resultado="bloqueado",
            detalle={"tipo": entrega.get("tipo"), "indicativo_numero": entrega.get("indicativo_numero")},
        )
        raise EntregaDuplicada(identificador)

    await registrar_evento(
        EventoLog.ENTREGA_INSERTADA,
        entidad_tipo="entrega",
        entidad_id=str(entrega_id),
        actor_id=actor_id,
        sede_id=sede_id,
        resultado="ok",
    )
    return str(entrega_id)


def marcar_estado_por_confianza(confianza: dict[str, float], min_confidence: float) -> EstadoEntrega:
    # cantidad_pendiente queda afuera: la ingresa el bodeguero a mano (ver
    # app/routers/entregas.py), no hay confianza de IA que evaluar ahi.
    campos_criticos = ("tipo", "indicativo_numero", "cantidad_entregada")
    if any(confianza.get(campo, 0.0) < min_confidence for campo in campos_criticos):
        return EstadoEntrega.PENDIENTE_REVISION
    return EstadoEntrega.PROCESADA
