"""Job semanal de analitica predictiva de turnos (Figura 2 del diagrama).

Agrega `entregas` por sede/dia/hora, calcula percentiles p50/p90 de carga
para detectar picos, y escribe una sugerencia de turnos en
`shift_recommendations`. Pensado para correr como cron (n8n, o
`crontab`/Task Scheduler llamando `python scripts/generar_turnos.py`).

Uso:
    python -m scripts.generar_turnos
"""

import asyncio
import statistics
from collections import defaultdict
from datetime import datetime, timezone

from app.db import close_pool, get_pool

DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]


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

        # Carga por (dia_semana, hora) de todo el historico disponible.
        entregas = await pool.fetch(
            "select capturado_at from entregas where sede_origen_id = $1", sede_id
        )

        conteos: dict[tuple[int, int], int] = defaultdict(int)
        for entrega in entregas:
            capturado = entrega["capturado_at"]
            conteos[(capturado.weekday(), capturado.hour)] += 1

        if not conteos:
            continue

        valores = list(conteos.values())
        p90 = statistics.quantiles(valores, n=10)[8] if len(valores) >= 2 else max(valores)

        # Bloques cuyo conteo esta en o por encima del p90: son los picos de
        # demanda que necesitan mas personal.
        bloques_sugeridos = []
        for dia_idx in range(7):
            horas_pico = sorted(
                h for (d, h), c in conteos.items() if d == dia_idx and c >= p90
            )
            if not horas_pico:
                continue
            bloques_sugeridos.append(
                {
                    "dia": DIAS[dia_idx],
                    "hora_inicio": f"{min(horas_pico):02d}:00:00",
                    "hora_fin": f"{max(horas_pico) + 1:02d}:00:00",
                    "personal_sugerido": max(1, round(len(horas_pico) / 2)),
                }
            )

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
            "percentiles_p50_p90",
        )
        print(f"[turnos] {sede['nombre']}: {len(bloques_sugeridos)} bloques sugeridos")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(generar_recomendaciones())
