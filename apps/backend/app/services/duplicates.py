"""Chequeo de duplicados entre sedes: la barrera real es el `unique
(numero_guia, remitente)` de la tabla `entregas` (ver app.db._SCHEMA). Este
modulo solo traduce la violacion de esa restriccion en una respuesta de
negocio + logging. Ver Figura 1 del diagrama.
"""

import asyncpg

from app.db import get_pool
from app.models.entrega import EstadoEntrega
from app.models.log import EventoLog
from app.services.logging_service import registrar_evento


class EntregaDuplicada(Exception):
    def __init__(self, numero_guia: str):
        self.numero_guia = numero_guia
        super().__init__(f"La guia {numero_guia} ya fue procesada por otra sede.")


async def insertar_si_no_duplicada(entrega: dict, *, actor_id: str, sede_id: str) -> str:
    """Intenta insertar la entrega. Si la restriccion unique la rechaza,
    registra el intento de duplicado (quien, cuando, desde donde) y relanza
    como EntregaDuplicada para que el router responda 409.

    Retorna el id insertado en el caso exitoso.
    """
    pool = await get_pool()
    try:
        entrega_id = await pool.fetchval(
            """
            insert into entregas (
                numero_guia, hash_evidencia, sede_origen_id, sede_destino_id,
                remitente, destinatario, items, estado, confianza_ia,
                evidencia_url, operador_id, capturado_at, procesado_at
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
            returning id
            """,
            entrega["numero_guia"],
            entrega["hash_evidencia"],
            entrega["sede_origen_id"],
            entrega["sede_destino_id"],
            entrega["remitente"],
            entrega["destinatario"],
            entrega["items"],
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
            entidad_id=entrega.get("numero_guia", "desconocido"),
            actor_id=actor_id,
            sede_id=sede_id,
            resultado="bloqueado",
            detalle={"numero_guia": entrega.get("numero_guia")},
        )
        raise EntregaDuplicada(entrega.get("numero_guia", "desconocido"))

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
    campos_criticos = ("numero_guia", "remitente", "destinatario")
    if any(confianza.get(campo, 0.0) < min_confidence for campo in campos_criticos):
        return EstadoEntrega.PENDIENTE_REVISION
    return EstadoEntrega.PROCESADA
