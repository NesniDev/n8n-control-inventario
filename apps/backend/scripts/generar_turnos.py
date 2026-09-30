"""Job semanal de analitica predictiva de turnos (Figura 2 del diagrama).

Calcula, por sede, la carga de documentos por dia/hora local de las ultimas
semanas, detecta los picos (percentil 90) y escribe los bloques de turno
sugeridos en `shift_recommendations` -- una foto por semana ISO. El calculo
vive en app/services/turnos.py y es el mismo que muestra en vivo el
dashboard (GET /turnos/carga). Pensado para correr como cron (n8n, o
`crontab`/Task Scheduler llamando `python scripts/generar_turnos.py`).

Uso:
    python -m scripts.generar_turnos
"""

import asyncio
from datetime import datetime, timezone

from app.db import close_pool, get_pool
from app.services.turnos import MODELO, calcular_bloques, cargar_celdas, umbral_pico


def _semana_iso(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


async def generar_recomendaciones() -> None:
    pool = await get_pool()
    ahora = datetime.now(timezone.utc)
    semana_iso = _semana_iso(ahora)

    sedes = await pool.fetch("select id, nombre from sedes where activa = true")

    for sede in sedes:
        sede_id = str(sede["id"])
        celdas, _ = await cargar_celdas(pool, sede_id)
        if not celdas:
            continue
        bloques_sugeridos = calcular_bloques(celdas, umbral_pico(celdas))

        await pool.execute(
            """
            insert into shift_recommendations (sede_id, semana_iso, bloques_sugeridos, generado_at, modelo_usado)
            values ($1, $2, $3, $4, $5)
            on conflict (sede_id, semana_iso) do update
                set bloques_sugeridos = excluded.bloques_sugeridos,
                    generado_at = excluded.generado_at,
                    modelo_usado = excluded.modelo_usado
            """,
            sede_id,
            semana_iso,
            bloques_sugeridos,
            ahora,
            MODELO,
        )
        print(f"[turnos] {sede['nombre']}: {len(bloques_sugeridos)} bloques sugeridos")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(generar_recomendaciones())
