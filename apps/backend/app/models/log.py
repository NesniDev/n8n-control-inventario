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
