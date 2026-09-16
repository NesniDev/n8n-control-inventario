"""Catalogo codigo -> nombre de producto, auto-completado a medida que se
procesan/corrigen facturas (ver app/services/productos.py). El alta y la
correccion manual de aca son para completar/arreglar a mano lo que la
extraccion automatica no pudo resolver.
"""

import asyncpg
from fastapi import APIRouter, HTTPException

from app.db import get_pool
from app.models.producto import ProductoActualizar, ProductoCreate

router = APIRouter(prefix="/productos", tags=["productos"])


def _con_id(row: dict) -> dict:
    row = dict(row)
    row["id"] = str(row["id"])
    return row


@router.get("")
async def listar_productos(buscar: str | None = None) -> list[dict]:
    pool = await get_pool()
    if buscar:
        rows = await pool.fetch(
            "select * from productos where codigo ilike $1 or nombre ilike $1 order by codigo",
            f"%{buscar}%",
        )
    else:
        rows = await pool.fetch("select * from productos order by codigo")
    return [_con_id(row) for row in rows]


@router.post("", status_code=201)
async def crear_producto(producto: ProductoCreate) -> dict:
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "insert into productos (codigo, nombre) values ($1, $2) returning *",
            producto.codigo,
            producto.nombre,
        )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(status_code=409, detail="Ya existe un producto con ese código.") from exc
    return _con_id(row)


@router.patch("/{producto_id}")
async def actualizar_producto(producto_id: str, cambios: ProductoActualizar) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        "update productos set nombre = $2 where id = $1::uuid returning *",
        producto_id,
        cambios.nombre,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    return _con_id(row)
