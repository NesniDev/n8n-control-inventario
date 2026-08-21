from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class EstadoEntrega(StrEnum):
    PROCESADA = "procesada"
    PENDIENTE_REVISION = "pendiente_revision"
    DUPLICADO_BLOQUEADO = "duplicado_bloqueado"


class TipoDocumento(StrEnum):
    """Los 4 tipos mas comunes -- factura (FEI), traslado entre bodegas (TB)
    o remision (RM3/RM2). Referencia para armar chips/sugerencias en las
    apps; NO se usa para validar (en la practica aparecen otros tipos, ver
    EntregaRevision.tipo y buscar_entrega en routers/entregas.py, los dos
    aceptan cualquier texto no vacio)."""

    FEI = "FEI"
    TB = "TB"
    RM3 = "RM3"
    RM2 = "RM2"


class SituacionEntrega(StrEnum):
    """Resultado de POST /entregas/procesar -- ver app/services/duplicates.py.

    nueva: no existia, se creo con los items leidos por la IA (cantidad_pendiente
    arranca igual a cantidad_entregada hasta que el bodeguero confirme el real).
    actualizable: ya existia y le queda algo pendiente en algun item -- se
    devuelven los items actuales para que el bodeguero los actualice.
    """

    NUEVA = "nueva"
    ACTUALIZABLE = "actualizable"


class ItemEntrega(BaseModel):
    id: str
    descripcion: str
    cantidad_entregada: int
    cantidad_pendiente: int
    # Nota manual del bodeguero (una sola, se sobreescribe) -- no la pone la
    # IA, es informacion adicional libre sobre ese producto puntual.
    nota: str | None = None


class EntregaCreate(BaseModel):
    """Payload que envia la app movil tras subir la foto a Storage (paso 1)."""

    evidencia_url: str
    hash_evidencia: str
    sede_origen_id: str
    operador_id: str
    capturado_at: datetime


class EntregaRevision(BaseModel):
    """Payload para corregir/aprobar una entrega en 'pendiente_revision' desde
    el dashboard. Solo se envian los campos que un supervisor corrigio.
    Las cantidades por producto se corrigen aparte, via PATCH /entregas/{id}/items."""

    # str y no TipoDocumento: en la practica el tipo real del documento no
    # siempre es uno de los 4 conocidos -- el supervisor tiene que poder
    # escribir uno nuevo si no esta en la lista (ver dashboard).
    tipo: str | None = None
    indicativo_numero: str | None = None
    revisado_por: str = "supervisor"

    @model_validator(mode="after")
    def _validar_tipo(self) -> "EntregaRevision":
        if self.tipo is not None and not self.tipo.strip():
            raise ValueError("tipo no puede quedar vacio")
        return self


class ItemActualizacion(BaseModel):
    """Cambios por item (ver PATCH /entregas/{id}/items). descripcion y
    cantidad_entregada son correcciones directas (las usa el dashboard).
    Para la cantidad pendiente hay dos modos, excluyentes entre si:
    cantidad_pendiente fija el valor absoluto (confirmar una entrega nueva
    desde el movil, o correccion manual desde el dashboard); entregado_hoy es
    un delta que el backend suma/resta atomicamente en SQL (confirmar una
    actualizacion desde el movil -- evita pisar la entrega de otra sede si
    llegan casi al mismo tiempo)."""

    id: str
    descripcion: str | None = None
    cantidad_entregada: int | None = Field(default=None, ge=0)
    cantidad_pendiente: int | None = Field(default=None, ge=0)
    # ge=0 evita un delta negativo -- sin esto, un entregado_hoy negativo
    # terminaba SUMANDO pendiente en vez de restarlo (ver
    # aplicar_actualizacion_items). El limite superior (no se puede entregar
    # mas de lo que queda pendiente) se valida ahi mismo, contra el dato
    # real de la fila -- aca no se puede, este modelo no conoce el pendiente
    # actual.
    entregado_hoy: int | None = Field(default=None, ge=0)
    # Nota manual por producto -- se puede mandar sola (sin tocar cantidades),
    # ej. para anotar algo de un item que ya esta bloqueado (nada pendiente).
    nota: str | None = None

    @model_validator(mode="after")
    def _validar(self) -> "ItemActualizacion":
        if self.cantidad_pendiente is not None and self.entregado_hoy is not None:
            raise ValueError("cantidad_pendiente y entregado_hoy son excluyentes")
        if all(
            v is None
            for v in (self.descripcion, self.cantidad_entregada, self.cantidad_pendiente, self.entregado_hoy, self.nota)
        ):
            raise ValueError("el item no trae ningun cambio")
        return self


class ActualizarItemsRequest(BaseModel):
    """Payload del paso 2 -- confirmar una entrega nueva o aplicar una
    actualizacion incremental. evidencia_url/hash_evidencia son de la foto de
    esta visita; si se mandan, entregas.evidencia_url pasa a ser la mas
    reciente (el historial de fotos anteriores queda en logs)."""

    items: list[ItemActualizacion]
    operador_id: str
    sede_id: str
    evidencia_url: str | None = None
    hash_evidencia: str | None = None
