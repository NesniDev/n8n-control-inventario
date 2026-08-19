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
