import re
from collections import defaultdict
from typing import Mapping, Sequence

from app.models.ranking import RankingProductoItem
from app.services.productos import extraer_codigo_nombre

_ESPACIOS = re.compile(r"\s+")


def _normalizar(texto: str) -> str:
    return _ESPACIOS.sub(" ", texto.strip()).upper()


def _clave_y_nombre(descripcion: str, codigo_por_nombre: Mapping[str, str]) -> tuple[str | None, str]:
    """Misma logica de deteccion de codigo que el catalogo de productos (ver
    app/services/productos.py) -- si la descripcion trae un codigo reconocible
    se agrupa por ese codigo. Si no, se busca el texto normalizado (mayusculas,
    espacios colapsados) en el catalogo: si hay un producto con ese nombre, se
    usa su codigo (la IA a veces lee la descripcion sin el codigo delante). Si
    tampoco, se agrupa por el texto normalizado para que "SAL BLANCA" y
    "sal  blanca" no cuenten como productos distintos.
    """
    resultado = extraer_codigo_nombre(descripcion)
    if resultado is not None:
        codigo, nombre = resultado
        return codigo, nombre
    normalizado = _normalizar(descripcion)
    codigo = codigo_por_nombre.get(normalizado)
    if codigo is not None:
        return codigo, normalizado
    return None, normalizado


def calcular_ranking_productos(
    filas: Sequence[Mapping], limit: int, catalogo: Sequence[Mapping] = ()
) -> tuple[list[RankingProductoItem], list[RankingProductoItem]]:
    """Agrega en Python filas crudas (descripcion, cantidad_entregada,
    entrega_id) de entrega_items -- mismo enfoque que
    scripts/generar_turnos.py (fetch crudo + defaultdict, sin agregacion en
    SQL). `catalogo` son las filas (codigo, nombre) de productos, ya leidas por
    el router: completan el codigo faltante y el nombre corregido a mano gana
    sobre el texto de la factura. No toca la DB.
    """
    nombre_por_codigo: dict[str, str] = {fila["codigo"]: fila["nombre"] for fila in catalogo}
    codigo_por_nombre: dict[str, str] = {_normalizar(fila["nombre"]): fila["codigo"] for fila in catalogo}

    cantidad_total: dict[str, int] = defaultdict(int)
    entregas_por_clave: dict[str, set] = defaultdict(set)
    nombre_bonito: dict[str, str] = {}
    codigo_por_clave: dict[str, str | None] = {}

    for fila in filas:
        descripcion = fila["descripcion"] or ""
        if not descripcion.strip():
            continue
        codigo, nombre = _clave_y_nombre(descripcion, codigo_por_nombre)
        clave = codigo if codigo is not None else nombre
        cantidad_total[clave] += fila["cantidad_entregada"]
        entregas_por_clave[clave].add(fila["entrega_id"])
        codigo_por_clave[clave] = codigo
        if clave not in nombre_bonito:
            # Version "bonita" para mostrar: la primera descripcion vista para
            # esa clave (sin forzar mayusculas), en vez del texto normalizado.
            nombre_bonito[clave] = descripcion.strip() if codigo is None else nombre

    items = [
        RankingProductoItem(
            codigo=codigo_por_clave[clave],
            nombre=nombre_por_codigo.get(clave, nombre_bonito[clave])
            if codigo_por_clave[clave] is not None
            else nombre_bonito[clave],
            cantidad_total=total,
            entregas_count=len(entregas_por_clave[clave]),
        )
        for clave, total in cantidad_total.items()
    ]

    mas_vendidos = sorted(items, key=lambda item: item.cantidad_total, reverse=True)[:limit]
    menos_vendidos = sorted(items, key=lambda item: item.cantidad_total)[:limit]
    return mas_vendidos, menos_vendidos
