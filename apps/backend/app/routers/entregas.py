"""Orquesta el pipeline de la Figura 1: recibe la foto ya subida a Storage,
llama a la IA de vision, valida por confianza, chequea duplicados y persiste.

En produccion, el paso "n8n webhook" de la Figura 1 llama a este endpoint
(o esta logica vive directamente como un nodo HTTP Request en n8n apuntando
aqui) tras subir la evidencia. Este router es la implementacion de referencia.
"""

import csv
import io

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.db import get_pool
from app.models.entrega import EntregaCreate, EntregaRevision, EstadoEntrega, TipoDocumento
from app.models.log import EventoLog
from app.services.duplicates import EntregaDuplicada, insertar_si_no_duplicada, marcar_estado_por_confianza
from app.services.logging_service import registrar_evento
from app.services.vision import ExtraccionFallida, extraer_datos_guia

router = APIRouter(prefix="/entregas", tags=["entregas"])


@router.post("/procesar", status_code=status.HTTP_201_CREATED)
async def procesar_entrega(payload: EntregaCreate) -> dict:
    settings = get_settings()

    await registrar_evento(
        EventoLog.FOTO_CAPTURADA,
        entidad_tipo="entrega",
        entidad_id=payload.hash_evidencia,
        actor_id=payload.operador_id,
        sede_id=payload.sede_origen_id,
        resultado="ok",
    )

    try:
        extraido = await extraer_datos_guia(payload.evidencia_url)
    except ExtraccionFallida as exc:
        await registrar_evento(
            EventoLog.EXTRACCION_IA,
            entidad_tipo="entrega",
            entidad_id=payload.hash_evidencia,
            actor_id=payload.operador_id,
            sede_id=payload.sede_origen_id,
            resultado="error",
            detalle={"error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await registrar_evento(
        EventoLog.EXTRACCION_IA,
        entidad_tipo="entrega",
        entidad_id=payload.hash_evidencia,
        actor_id=payload.operador_id,
        sede_id=payload.sede_origen_id,
        resultado="ok",
        detalle={
            "tipo": extraido.get("tipo"),
            "indicativo_numero": extraido.get("indicativo_numero"),
            "cantidad_entregada": extraido.get("cantidad_entregada"),
            # Guia leida por la IA, solo a modo de auditoria — la que se
            # persiste es la que ingresa el bodeguero (payload.cantidad_pendiente).
            "cantidad_pendiente_ia": extraido.get("cantidad_pendiente"),
        },
    )

    estado = marcar_estado_por_confianza(extraido.get("confianza", {}), settings.min_confidence)
    await registrar_evento(
        EventoLog.VALIDACION,
        entidad_tipo="entrega",
        entidad_id=payload.hash_evidencia,
        actor_id=payload.operador_id,
        sede_id=payload.sede_origen_id,
        resultado="ok" if estado == EstadoEntrega.PROCESADA else "revision_manual",
        detalle={"confianza": extraido.get("confianza", {})},
    )

    entrega = {
        "tipo": extraido.get("tipo") or TipoDocumento.FEI.value,
        "indicativo_numero": extraido.get("indicativo_numero", ""),
        "hash_evidencia": payload.hash_evidencia,
        "sede_origen_id": payload.sede_origen_id,
        "cantidad_entregada": extraido.get("cantidad_entregada", 0),
        # La del bodeguero manda sobre lo que haya leido la IA (ver
        # EntregaCreate.cantidad_pendiente y el log EXTRACCION_IA de arriba).
        "cantidad_pendiente": payload.cantidad_pendiente,
        "estado": estado.value,
        "confianza_ia": extraido.get("confianza", {}),
        "evidencia_url": payload.evidencia_url,
        "operador_id": payload.operador_id,
        "capturado_at": payload.capturado_at,
    }

    await registrar_evento(
        EventoLog.CHEQUEO_DUPLICADO,
        entidad_tipo="entrega",
        entidad_id=payload.hash_evidencia,
        actor_id=payload.operador_id,
        sede_id=payload.sede_origen_id,
        resultado="ok",
    )

    try:
        entrega_id = await insertar_si_no_duplicada(
            entrega, actor_id=payload.operador_id, sede_id=payload.sede_origen_id
        )
    except EntregaDuplicada as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    # Sync en tiempo real (Figura 1: DB -> dashboards). Con Supabase esto se
    # resuelve con Realtime (replicacion logica de Postgres) escuchando la
    # tabla `entregas` desde el dashboard — sin relay propio que mantener.
    await registrar_evento(
        EventoLog.SYNC_TIEMPO_REAL,
        entidad_tipo="entrega",
        entidad_id=entrega_id,
        actor_id="system",
        sede_id=payload.sede_origen_id,
        resultado="ok",
    )

    return {"id": entrega_id, "estado": estado.value}


_SELECT_ENTREGAS_CON_SEDE = """
    select e.*, s.nombre as sede_origen_nombre
    from entregas e
    left join sedes s on s.id::text = e.sede_origen_id
"""


@router.get("")
async def listar_entregas(sede_id: str | None = None, limit: int = 50) -> list[dict]:
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            _SELECT_ENTREGAS_CON_SEDE + " where e.sede_origen_id = $1 order by e.capturado_at desc limit $2",
            sede_id,
            limit,
        )
    else:
        rows = await pool.fetch(
            _SELECT_ENTREGAS_CON_SEDE + " order by e.capturado_at desc limit $1", limit
        )

    resultado = []
    for row in rows:
        item = dict(row)
        item["id"] = str(item["id"])
        resultado.append(item)
    return resultado


_EXPORT_COLUMNAS = [
    "capturado_at",
    "tipo",
    "indicativo_numero",
    "sede_origen_id",
    "cantidad_entregada",
    "cantidad_pendiente",
    "estado",
    "operador_id",
    "hash_evidencia",
    "evidencia_url",
]


@router.patch("/{entrega_id}/revisar")
async def revisar_entrega(entrega_id: str, payload: EntregaRevision) -> dict:
    """Corrige los campos de baja confianza y aprueba una entrega que estaba
    en 'pendiente_revision', dejandola como 'procesada'. Usado por el boton
    de revision manual del dashboard.
    """
    pool = await get_pool()
    actual = await pool.fetchrow("select * from entregas where id = $1::uuid", entrega_id)
    if actual is None:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")

    campos = {
        "tipo": payload.tipo.value if payload.tipo else None,
        "indicativo_numero": payload.indicativo_numero,
        "cantidad_entregada": payload.cantidad_entregada,
        "cantidad_pendiente": payload.cantidad_pendiente,
    }
    campos = {k: v for k, v in campos.items() if v is not None}

    row = await pool.fetchrow(
        """
        update entregas
        set tipo = coalesce($2, tipo),
            indicativo_numero = coalesce($3, indicativo_numero),
            cantidad_entregada = coalesce($4, cantidad_entregada),
            cantidad_pendiente = coalesce($5, cantidad_pendiente),
            estado = $6,
            actualizado_at = now()
        where id = $1::uuid
        returning *
        """,
        entrega_id,
        campos.get("tipo"),
        campos.get("indicativo_numero"),
        campos.get("cantidad_entregada"),
        campos.get("cantidad_pendiente"),
        EstadoEntrega.PROCESADA.value,
    )

    await registrar_evento(
        EventoLog.REVISION_MANUAL_APROBADA,
        entidad_tipo="entrega",
        entidad_id=entrega_id,
        actor_id=payload.revisado_por,
        sede_id=actual["sede_origen_id"],
        resultado="ok",
        detalle={"campos_corregidos": list(campos.keys())},
    )

    resultado = dict(row)
    resultado["id"] = str(resultado["id"])
    return resultado


@router.get("/export.csv")
async def exportar_entregas_csv(sede_id: str | None = None) -> StreamingResponse:
    """CSV de todas las entregas para llevar control en Excel/Sheets. Se abre
    directo con doble click (Excel detecta la coma como separador) o se
    importa como "Datos > Desde texto/CSV".
    """
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            "select * from entregas where sede_origen_id = $1 order by capturado_at desc",
            sede_id,
        )
    else:
        rows = await pool.fetch("select * from entregas order by capturado_at desc")

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=_EXPORT_COLUMNAS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        item = dict(row)
        writer.writerow(item)
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=entregas.csv"},
    )
