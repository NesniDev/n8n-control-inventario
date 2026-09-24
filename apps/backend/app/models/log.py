from enum import StrEnum


class EventoLog(StrEnum):
    FOTO_CAPTURADA = "foto_capturada"
    EXTRACCION_IA = "extraccion_ia"
    VALIDACION = "validacion"
    CHEQUEO_DUPLICADO = "chequeo_duplicado"
    ENTREGA_INSERTADA = "entrega_insertada"
    DUPLICADO_BLOQUEADO = "duplicado_bloqueado"
    SYNC_TIEMPO_REAL = "sync_tiempo_real"
    TURNOS_GENERADOS = "turnos_generados"
    REVISION_MANUAL_APROBADA = "revision_manual_aprobada"
    # Lo escribe n8n directo contra la REST API de Supabase (Workflow 3:
    # monitoreo-salud.json), no el backend -- por diseno: si el backend esta
    # caido no puede reportar su propia caida. Ver n8n/workflows/README.md.
    HEALTH_CHECK_FALLIDO = "health_check_fallido"
    # Confirmacion del bodeguero (paso 2) tras un POST /entregas/procesar que
    # devolvio situacion "nueva" o "actualizable" -- ver app/services/duplicates.py.
    ENTREGA_ACTUALIZADA = "entrega_actualizada"
    # El bodeguero cancelo antes de confirmar cantidades (paso 2) -- solo
    # aplica a una entrega recien insertada (situacion "nueva") que todavia
    # nadie confirmo. Ver cancelar_entrega_no_confirmada en duplicates.py.
    ENTREGA_CANCELADA = "entrega_cancelada"
    # Se registro la devolucion de un producto ya entregado -- ver
    # app/services/devoluciones.py.
    DEVOLUCION_REGISTRADA = "devolucion_registrada"
    # Borrado definitivo de una entrega en pendiente_revision desde el
    # dashboard (boton "Cancelar" de la cola de revision) -- ver
    # DELETE /entregas/{id}/definitivo en entregas.py.
    ENTREGA_ELIMINADA = "entrega_eliminada"
    # Borrado masivo de TODAS las entregas y logs, disparado desde el
    # dashboard -- equivalente a scripts/limpiar_datos.py pero via HTTP.
    LIMPIEZA_TOTAL = "limpieza_total"
    # Alta de un traslado entre puntos -- ver app/services/traslados_puntos.py.
    TRASLADO_PUNTO_CREADO = "traslado_punto_creado"
    # Confirmacion de recepcion en el punto destino (registrar_recepcion) --
    # se registra siempre que se recibe, con o sin novedad.
    TRASLADO_PUNTO_RECIBIDO = "traslado_punto_recibido"
    # Se registra ADEMAS de TRASLADO_PUNTO_RECIBIDO (no en su lugar) cuando la
    # recepcion quedo con una diferencia -- cantidad incompleta en algun item
    # o alguna novedad cargada (general o por item).
    TRASLADO_PUNTO_NOVEDAD = "traslado_punto_novedad"
    # Supervision (Erika) marco una novedad como resuelta -- ver
    # resolver_novedad en app/services/traslados_puntos.py.
    TRASLADO_PUNTO_NOVEDAD_RESUELTA = "traslado_punto_novedad_resuelta"
