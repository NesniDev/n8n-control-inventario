"""Orquesta el pipeline de la Figura 1: recibe la foto ya subida a Storage,
llama a la IA de vision, valida por confianza, chequea duplicados y persiste.

En produccion, el paso "n8n webhook" de la Figura 1 llama a este endpoint
(o esta logica vive directamente como un nodo HTTP Request en n8n apuntando
aqui) tras subir la evidencia. Este router es la implementacion de referencia.

Flujo en dos pasos (ver docs/architecture.md): POST /procesar identifica el
documento y devuelve sus items (creandolo si no existia); PATCH /items lo
confirma -- el bodeguero dice cuanto quedo pendiente (entrega nueva) o cuanto
entrego hoy (actualizacion de una entrega con algo pendiente todavia).
"""

import csv
import io

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import get_settings
from app.db import get_pool
from app.models.devolucion import DevolucionCreate
from app.models.entrega import (
    ActualizarItemsRequest,
    EntregaCreate,
    EntregaRevision,
    EstadoEntrega,
    SituacionEntrega,
    TipoDocumento,
)
from app.models.log import EventoLog
from app.services.devoluciones import DevolucionInvalida, registrar_devolucion
from app.services.duplicates import (
    CantidadInvalida,
    EntregaDuplicada,
    aplicar_actualizacion_items,
    cancelar_entrega_no_confirmada,
    procesar_extraccion,
)
from app.services.logging_service import registrar_evento
from app.services.reportes import generar_reporte_mensual_xlsx
from app.services.vision import ExtraccionFallida, extraer_datos_guia

router = APIRouter(prefix="/entregas", tags=["entregas"])


@router.post("/procesar")
async def procesar_entrega(payload: EntregaCreate) -> JSONResponse:
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
        # 422 y no 502: el proxy de EasyPanel (Traefik) intercepta cualquier
        # respuesta 502/503/504 y la reemplaza por su propia pagina HTML de
        # "Service is not reachable" -- pensando que el contenedor esta caido
        # -- en vez de dejar pasar nuestro JSON con el detail real. Eso hacia
        # que un fallo de IA (legitimo, ej. imagen ilegible) le llegara al
        # movil como una respuesta no-JSON, mostrando el mensaje generico de
        # "Error del servidor" en vez del motivo real. 422 no esta en esa
        # lista y se propaga tal cual.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

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
            "cantidad_items": len(extraido.get("items") or []),
        },
    )

    await registrar_evento(
        EventoLog.CHEQUEO_DUPLICADO,
        entidad_tipo="entrega",
        entidad_id=payload.hash_evidencia,
        actor_id=payload.operador_id,
        sede_id=payload.sede_origen_id,
        resultado="ok",
    )

    # Si vino traslado_url, tambien se lee con IA -- hace falta su concepto
    # (campo de texto libre del documento) para verificar que menciona el
    # numero de esta factura (ver _concepto_referencia_factura en
    # duplicates.py); una foto de traslado que no referencia esta factura no
    # debe destrabar la restriccion de sede.
    concepto_traslado = None
    items_traslado = None
    if payload.traslado_url:
        try:
            extraido_traslado = await extraer_datos_guia(payload.traslado_url)
        except ExtraccionFallida as exc:
            raise HTTPException(status_code=422, detail=f"No se pudo leer el traslado: {exc}") from exc
        concepto_traslado = (extraido_traslado.get("concepto") or "").strip()
        items_traslado = extraido_traslado.get("items") or []
        await registrar_evento(
            EventoLog.EXTRACCION_IA,
            entidad_tipo="entrega",
            entidad_id=payload.hash_evidencia,
            actor_id=payload.operador_id,
            sede_id=payload.sede_origen_id,
            resultado="ok",
            detalle={
                "origen": "traslado",
                "tipo": extraido_traslado.get("tipo"),
                "indicativo_numero": extraido_traslado.get("indicativo_numero"),
                "concepto": concepto_traslado,
            },
        )

    try:
        situacion, entrega_id, items, estado, tipo, indicativo_numero = await procesar_extraccion(
            extraido,
            hash_evidencia=payload.hash_evidencia,
            sede_origen_id=payload.sede_origen_id,
            operador_id=payload.operador_id,
            capturado_at=payload.capturado_at,
            evidencia_url=payload.evidencia_url,
            min_confidence=settings.min_confidence,
            traslado_url=payload.traslado_url,
            concepto_traslado=concepto_traslado,
            items_traslado=items_traslado,
        )
    except EntregaDuplicada as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    # necesita_traslado no inserto nada -- no hay entrega_id (None). Los logs
    # de aca abajo se atan a hash_evidencia, mismo identificador que ya se usa
    # mas arriba para FOTO_CAPTURADA/EXTRACCION_IA antes de que exista la fila.
    entidad_id_log = entrega_id or payload.hash_evidencia

    await registrar_evento(
        EventoLog.VALIDACION,
        entidad_tipo="entrega",
        entidad_id=entidad_id_log,
        actor_id=payload.operador_id,
        sede_id=payload.sede_origen_id,
        resultado="ok" if estado == EstadoEntrega.PROCESADA else "revision_manual",
        detalle={"confianza": extraido.get("confianza", {}), "situacion": situacion.value},
    )

    # Sync en tiempo real (Figura 1: DB -> dashboards). Con Supabase esto se
    # resuelve con Realtime (replicacion logica de Postgres) escuchando las
    # tablas `entregas`/`entrega_items` desde el dashboard — sin relay propio.
    await registrar_evento(
        EventoLog.SYNC_TIEMPO_REAL,
        entidad_tipo="entrega",
        entidad_id=entidad_id_log,
        actor_id="system",
        sede_id=payload.sede_origen_id,
        resultado="ok",
    )

    codigo = status.HTTP_201_CREATED if situacion == SituacionEntrega.NUEVA else status.HTTP_200_OK
    return JSONResponse(
        status_code=codigo,
        content={
            "id": entrega_id,
            "situacion": situacion.value,
            "estado": estado.value,
            "tipo": tipo,
            "indicativo_numero": indicativo_numero,
            "items": [item.model_dump() for item in items],
        },
    )


@router.delete("/{entrega_id}")
async def cancelar_entrega(entrega_id: str, operador_id: str = "desconocido", sede_id: str = "desconocida") -> dict:
    """El bodeguero cancela en la pantalla de confirmacion (paso 2) sin
    guardar nada -- deshace el insert que hizo POST /procesar (paso 1). Solo
    borra si todavia nadie confirmo cantidades (ver
    cancelar_entrega_no_confirmada); nunca borra una entrega real que ya
    tenia historial. Idempotente y nunca falla: cancelar dos veces, o
    cancelar algo que ya no existe, simplemente no hace nada."""
    cancelado = await cancelar_entrega_no_confirmada(entrega_id, operador_id=operador_id, sede_id=sede_id)
    return {"cancelado": cancelado}


@router.patch("/{entrega_id}/items")
async def actualizar_items(entrega_id: str, payload: ActualizarItemsRequest) -> dict:
    """Paso 2: confirma una entrega nueva (cantidad_pendiente por item) o
    aplica una actualizacion incremental (entregado_hoy por item). Lo llama
    la app movil apenas el bodeguero confirma en pantalla, y tambien lo usa
    el dashboard para corregir items desde la revision manual."""
    pool = await get_pool()
    existente = await pool.fetchrow("select id from entregas where id = $1::uuid", entrega_id)
    if existente is None:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")

    try:
        items = await aplicar_actualizacion_items(
            entrega_id,
            payload.items,
            operador_id=payload.operador_id,
            sede_id=payload.sede_id,
            evidencia_url=payload.evidencia_url,
            hash_evidencia=payload.hash_evidencia,
            firma_url=payload.firma_url,
        )
    except CantidadInvalida as exc:
        # 422 y no 502/503/504: el proxy de EasyPanel (Traefik) intercepta esos
        # tres codigos y los reemplaza por su propia pagina, tapando el detail
        # real (ver la misma nota en ExtraccionFallida, entregas.py).
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"id": entrega_id, "items": [item.model_dump() for item in items]}


@router.post("/{entrega_id}/devoluciones")
async def crear_devolucion(entrega_id: str, payload: DevolucionCreate) -> dict:
    """El cliente devuelve un producto ya entregado (dañado, equivocado,
    vencido, etc.). 'reposicion' deja esa cantidad pendiente de nuevo (se
    debe re-entregar); 'reembolso' la finaliza -- no vuelve a pendiente,
    esas unidades salen del total (se devolvio el dinero, no un reemplazo).
    Solo aplica sobre una entrega que ya existia, no una recien escaneada
    sin confirmar todavia."""
    pool = await get_pool()
    existente = await pool.fetchrow("select id from entregas where id = $1::uuid", entrega_id)
    if existente is None:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")

    try:
        item = await registrar_devolucion(entrega_id, payload)
    except DevolucionInvalida as exc:
        # 422 y no 502/503/504 -- misma trampa de Traefik que CantidadInvalida.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"item": item.model_dump()}


_SELECT_ENTREGAS_BASE = """
    select e.*, s.nombre as sede_origen_nombre,
        coalesce(
            json_agg(
                json_build_object(
                    'id', i.id, 'descripcion', i.descripcion,
                    'cantidad_entregada', i.cantidad_entregada,
                    'cantidad_pendiente', i.cantidad_pendiente,
                    'nota', i.nota,
                    'confirmado', (i.actualizado_at > i.creado_at)
                ) order by i.creado_at
            ) filter (where i.id is not null),
            '[]'
        ) as items
    from entregas e
    left join sedes s on s.id::text = e.sede_origen_id
    left join entrega_items i on i.entrega_id = e.id
"""


@router.get("")
async def listar_entregas(sede_id: str | None = None, limit: int = 50) -> list[dict]:
    pool = await get_pool()
    if sede_id:
        rows = await pool.fetch(
            _SELECT_ENTREGAS_BASE
            + " where e.sede_origen_id = $1 group by e.id, s.nombre order by e.capturado_at desc limit $2",
            sede_id,
            limit,
        )
    else:
        rows = await pool.fetch(
            _SELECT_ENTREGAS_BASE + " group by e.id, s.nombre order by e.capturado_at desc limit $1",
            limit,
        )

    resultado = []
    for row in rows:
        item = dict(row)
        item["id"] = str(item["id"])
        resultado.append(item)
    return resultado


@router.get("/buscar")
async def buscar_entrega(tipo: str, indicativo_numero: str) -> dict:
    """Consulta directa por codigo de factura (sin pasar por una foto) -- el
    bodeguero busca `(tipo, indicativo_numero)` y ve que productos quedan
    pendientes. Usa el mismo indice unico que ya bloquea duplicados (ver
    app.db._SCHEMA), asi que la busqueda es siempre por, a lo sumo, un
    documento.

    `tipo` es texto libre y no TipoDocumento -- en la practica el tipo real
    de un documento no siempre es uno de los 4 conocidos (ver
    app.models.entrega.TipoDocumento)."""
    tipo = tipo.strip().upper()
    if not tipo:
        raise HTTPException(status_code=422, detail="tipo no puede quedar vacio")

    pool = await get_pool()
    row = await pool.fetchrow(
        _SELECT_ENTREGAS_BASE + " where e.tipo = $1 and e.indicativo_numero = $2 group by e.id, s.nombre",
        tipo,
        indicativo_numero,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No se encontro ningun documento con ese tipo/numero")

    resultado = dict(row)
    resultado["id"] = str(resultado["id"])
    # Fijo a "actualizable": reutiliza el mismo shape que POST /procesar para
    # que el movil pueda reusar tal cual la pantalla de confirmacion de items
    # que ya existe para el flujo de re-escaneo.
    resultado["situacion"] = "actualizable"
    return resultado


_EXPORT_COLUMNAS = [
    "capturado_at",
    "tipo",
    "indicativo_numero",
    "sede_origen_id",
    "descripcion",
    "cantidad_entregada",
    "cantidad_pendiente",
    "nota",
    "estado",
    "operador_id",
    "hash_evidencia",
    "evidencia_url",
]


@router.patch("/{entrega_id}/revisar")
async def revisar_entrega(entrega_id: str, payload: EntregaRevision) -> dict:
    """Corrige tipo/indicativo_numero y aprueba una entrega que estaba en
    'pendiente_revision', dejandola como 'procesada'. Usado por el boton de
    revision manual del dashboard. Las cantidades por producto se corrigen
    aparte via PATCH /entregas/{id}/items."""
    pool = await get_pool()
    actual = await pool.fetchrow("select * from entregas where id = $1::uuid", entrega_id)
    if actual is None:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")

    campos = {
        "tipo": payload.tipo.strip().upper() if payload.tipo else None,
        "indicativo_numero": payload.indicativo_numero,
    }
    campos = {k: v for k, v in campos.items() if v is not None}

    row = await pool.fetchrow(
        """
        update entregas
        set tipo = coalesce($2, tipo),
            indicativo_numero = coalesce($3, indicativo_numero),
            estado = $4,
            actualizado_at = now()
        where id = $1::uuid
        returning *
        """,
        entrega_id,
        campos.get("tipo"),
        campos.get("indicativo_numero"),
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
    """CSV de todas las entregas para llevar control en Excel/Sheets -- una
    fila por producto (item), con los datos del documento repetidos. Se abre
    directo con doble click (Excel detecta la coma como separador) o se
    importa como "Datos > Desde texto/CSV".
    """
    pool = await get_pool()
    query = """
        select e.capturado_at, e.tipo, e.indicativo_numero, e.sede_origen_id, e.estado,
               e.operador_id, e.hash_evidencia, e.evidencia_url,
               i.descripcion, i.cantidad_entregada, i.cantidad_pendiente, i.nota
        from entregas e
        left join entrega_items i on i.entrega_id = e.id
    """
    if sede_id:
        rows = await pool.fetch(
            query + " where e.sede_origen_id = $1 order by e.capturado_at desc, i.creado_at",
            sede_id,
        )
    else:
        rows = await pool.fetch(query + " order by e.capturado_at desc, i.creado_at")

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=_EXPORT_COLUMNAS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row))
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=entregas.csv"},
    )


@router.get("/export.xlsx")
async def exportar_reporte_mensual(sede_id: str | None = None) -> StreamingResponse:
    """Reporte mensual para mandarle a un superior -- un Excel real con una
    hoja por mes (todo el historico) y, dentro de cada hoja, un bloque
    Fecha+Número por tipo de documento (ver app/services/reportes.py). A
    diferencia de export.csv, es a nivel de documento, no de producto."""
    contenido = await generar_reporte_mensual_xlsx(sede_id=sede_id)
    return StreamingResponse(
        iter([contenido]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=reporte_mensual.xlsx"},
    )
