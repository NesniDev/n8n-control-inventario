"""Carga de trabajo por dia/hora y bloques de turno sugeridos (Figura 2).

Lo usan dos lugares con el mismo calculo:
- GET /turnos/carga (app/routers/shifts.py): en vivo, para el dashboard.
- scripts/generar_turnos.py: la foto semanal que se guarda en
  shift_recommendations (la dispara n8n con su "Cron: semanal").

Criterios:
- Hora LOCAL de la sede (sedes.timezone), no UTC -- si no, un pico de 14:00
  en Colombia aparece como 19:00.
- Solo las ultimas N semanas (default 8): el historico entero pesaria igual
  lo de hace un anio que lo de la semana pasada.
- Carga = promedio de documentos por semana en esa celda (dia, hora).
- Pico = celda en o por encima del percentil 90 de las celdas con carga.
- Un bloque por cada tramo CONTIGUO de horas pico en un dia (antes se tomaba
  de la primera a la ultima hora pico, cubriendo tambien los huecos del medio).
"""

import math
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]
SEMANAS_HISTORIAL = 8
MODELO = f"p90_{SEMANAS_HISTORIAL}semanas_hora_local"


@dataclass
class Celda:
    dia: int  # 0 = lunes ... 6 = domingo
    hora: int  # 0..23, hora local de la sede
    promedio: float  # documentos por semana


async def cargar_celdas(
    pool: asyncpg.Pool, sede_id: str, semanas: int = SEMANAS_HISTORIAL
) -> tuple[list[Celda], int]:
    """Carga por (dia, hora) de la sede en las ultimas `semanas`. Devuelve
    tambien las semanas realmente cubiertas: con menos historia que la
    ventana, dividir por `semanas` subestimaria los promedios."""
    filas = await pool.fetch(
        """
        select
            extract(isodow from e.capturado_at at time zone s.timezone)::int - 1 as dia,
            extract(hour from e.capturado_at at time zone s.timezone)::int as hora,
            count(*) as n,
            min(e.capturado_at) as primero
        from entregas e
        join sedes s on s.id::text = e.sede_origen_id
        where e.sede_origen_id = $1
          and e.estado <> 'duplicado_bloqueado'
          and e.capturado_at >= now() - make_interval(weeks => $2)
        group by 1, 2
        """,
        sede_id,
        semanas,
    )
    if not filas:
        return [], 0

    primero = min(f["primero"] for f in filas)
    dias_cubiertos = (datetime.now(timezone.utc) - primero).total_seconds() / 86400
    semanas_cubiertas = max(1, min(semanas, math.ceil(dias_cubiertos / 7)))
    celdas = [Celda(f["dia"], f["hora"], f["n"] / semanas_cubiertas) for f in filas]
    return celdas, semanas_cubiertas


def umbral_pico(celdas: list[Celda]) -> float | None:
    """Percentil 90 de las celdas con carga (None si no hay ninguna)."""
    valores = [c.promedio for c in celdas if c.promedio > 0]
    if not valores:
        return None
    if len(valores) < 2:
        return valores[0]
    return statistics.quantiles(valores, n=10)[8]


def calcular_bloques(celdas: list[Celda], umbral: float | None) -> list[dict]:
    """Un bloque por tramo contiguo de horas pico de cada dia.

    personal_sugerido es una regla simple (horas del bloque / 2, minimo 1):
    no hay datos de cuantos documentos despacha una persona por hora, asi que
    es una referencia para arrancar, no un calculo de capacidad."""
    if umbral is None:
        return []
    carga = {(c.dia, c.hora): c.promedio for c in celdas}
    bloques: list[dict] = []
    for dia in range(7):
        horas = sorted(h for (d, h), p in carga.items() if d == dia and p >= umbral)
        tramo: list[int] = []
        for hora in horas + [None]:
            if hora is not None and (not tramo or hora == tramo[-1] + 1):
                tramo.append(hora)
                continue
            if tramo:
                bloques.append(
                    {
                        "dia": DIAS[dia],
                        "dia_indice": dia,
                        "hora_inicio": f"{tramo[0]:02d}:00:00",
                        "hora_fin": f"{(tramo[-1] + 1) % 24:02d}:00:00",
                        "personal_sugerido": max(1, round(len(tramo) / 2)),
                        "carga_maxima": round(max(carga[(dia, h)] for h in tramo), 1),
                    }
                )
            tramo = [hora] if hora is not None else []
    return bloques
