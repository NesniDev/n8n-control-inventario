"""Reporte mensual en Excel para que los bodegueros le manden a sus
superiores -- a nivel de documento (entrega), no de producto: fecha/tipo/
numero son atributos de la entrega, asi que no hace falta el join a
entrega_items que usa el CSV plano (ver export.csv en routers/entregas.py).
"""

import io
from collections import defaultdict
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

from app.db import get_pool

_MESES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

# Los 4 tipos conocidos van primero en cada hoja; cualquier otro (custom, ver
# vision.py/EntregaRevision) va despues, en orden alfabetico.
_ORDEN_TIPOS_CONOCIDOS = ("FEI", "TB", "RM3", "RM2")


def _orden_tipo(tipo: str) -> tuple[int, str]:
    if tipo in _ORDEN_TIPOS_CONOCIDOS:
        return (_ORDEN_TIPOS_CONOCIDOS.index(tipo), tipo)
    return (len(_ORDEN_TIPOS_CONOCIDOS), tipo)


async def generar_reporte_mensual_xlsx(*, sede_id: str | None = None) -> bytes:
    """Una hoja por mes (todo el historico, orden cronologico) -- dentro de
    cada hoja, un bloque Fecha+Numero por tipo de documento, uno al lado del
    otro separados por una columna en blanco."""
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            "select capturado_at, tipo, indicativo_numero from entregas"
            " where sede_origen_id = $1 order by capturado_at",
            sede_id,
        )
    else:
        rows = await pool.fetch(
            "select capturado_at, tipo, indicativo_numero from entregas order by capturado_at"
        )

    # (año, mes) -> tipo -> [(fecha, numero), ...]
    por_mes: dict[tuple[int, int], dict[str, list[tuple[datetime, str]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for r in rows:
        fecha: datetime = r["capturado_at"]
        tipo = (r["tipo"] or "").strip() or "SIN TIPO"
        por_mes[(fecha.year, fecha.month)][tipo].append((fecha, r["indicativo_numero"] or ""))

    wb = Workbook()
    wb.remove(wb.active)  # la hoja default vacia, cada mes crea la suya

    for (anio, mes) in sorted(por_mes.keys()):
        nombre_hoja = f"{_MESES_ES[mes]} {anio}"[:31]  # Excel limita a 31 caracteres
        ws = wb.create_sheet(title=nombre_hoja)
        tipos_del_mes = por_mes[(anio, mes)]

        columna = 1
        for tipo in sorted(tipos_del_mes.keys(), key=_orden_tipo):
            entradas = sorted(tipos_del_mes[tipo], key=lambda e: e[0])
            col_fecha = get_column_letter(columna)
            col_numero = get_column_letter(columna + 1)

            ws.merge_cells(f"{col_fecha}1:{col_numero}1")
            encabezado = ws[f"{col_fecha}1"]
            encabezado.value = tipo
            encabezado.font = Font(bold=True)
            encabezado.alignment = Alignment(horizontal="center")

            ws[f"{col_fecha}2"] = "Fecha"
            ws[f"{col_numero}2"] = "Número"
            ws[f"{col_fecha}2"].font = Font(bold=True)
            ws[f"{col_numero}2"].font = Font(bold=True)

            for i, (fecha, numero) in enumerate(entradas, start=3):
                ws[f"{col_fecha}{i}"] = fecha.strftime("%d/%m/%Y")
                ws[f"{col_numero}{i}"] = numero

            ws.column_dimensions[col_fecha].width = 12
            ws.column_dimensions[col_numero].width = 16
            columna += 3  # +1 columna en blanco como separador antes del proximo tipo

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
