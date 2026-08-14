"""Trazabilidad: cada paso del pipeline escribe un evento append-only en `logs`.
Ver Figura 1 del diagrama de arquitectura (linea punteada = evento en logs).
"""

from typing import Any

from app.db import get_pool
from app.models.log import EventoLog


async def registrar_evento(
    evento: EventoLog,
    *,
    entidad_tipo: str,
    entidad_id: str,
    actor_id: str,
    sede_id: str,
    resultado: str,
    detalle: dict[str, Any] | None = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        insert into logs (evento, entidad_tipo, entidad_id, actor_id, sede_id, resultado, detalle)
        values ($1, $2, $3, $4, $5, $6, $7)
        """,
        evento.value,
        entidad_tipo,
        entidad_id,
        actor_id,
        sede_id,
        resultado,
        detalle or {},
    )
