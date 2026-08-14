"""Orquesta el pipeline de la Figura 1: recibe la foto ya subida a Storage,
llama a la IA de vision, valida por confianza, chequea duplicados y persiste.

En produccion, el paso "n8n webhook" de la Figura 1 llama a este endpoint
(o esta logica vive directamente como un nodo HTTP Request en n8n apuntando
aqui) tras subir la evidencia. Este router es la implementacion de referencia.
"""

from fastapi import APIRouter, HTTPException, status

from app.config import get_settings
from app.db import get_pool
from app.models.entrega import EntregaCreate, EstadoEntrega
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
        detalle={"numero_guia": extraido.get("numero_guia")},
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
        "numero_guia": extraido.get("numero_guia", ""),
        "hash_evidencia": payload.hash_evidencia,
        "sede_origen_id": payload.sede_origen_id,
        "sede_destino_id": extraido.get("sede_destino_sugerida") or None,
        "remitente": extraido.get("remitente", ""),
        "destinatario": extraido.get("destinatario", ""),
        "items": extraido.get("items", []),
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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Duplicado: {exc.numero_guia} ya fue procesada por otra sede.",
        ) from exc

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


@router.get("")
async def listar_entregas(sede_id: str | None = None, limit: int = 50) -> list[dict]:
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            """
            select * from entregas where sede_origen_id = $1
            order by capturado_at desc limit $2
            """,
            sede_id,
            limit,
        )
    else:
        rows = await pool.fetch(
            "select * from entregas order by capturado_at desc limit $1", limit
        )

    resultado = []
    for row in rows:
        item = dict(row)
        item["id"] = str(item["id"])
        resultado.append(item)
    return resultado
