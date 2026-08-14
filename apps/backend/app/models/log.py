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
