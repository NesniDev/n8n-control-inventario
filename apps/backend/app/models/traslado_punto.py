"""Modelos del flujo de traslados entre puntos: bodega origen carga el
traslado y firma como quien despacha, el conductor firma aparte, y bodega
destino confirma que recibio (con o sin novedad). Ver
app/services/traslados_puntos.py y el plan "traslados-entre-puntos". Tablas
aditivas -- no comparten nada con el modelo de entregas (app/models/entrega.py).
"""

import re
from datetime import date
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator


class EstadoTrasladoPunto(StrEnum):
    EN_TRANSITO = "en_transito"
    RECIBIDO = "recibido"
    # Alguna linea llego con menos cantidad de la enviada, o se cargo una
    # novedad (general o por item) -- ver registrar_recepcion.
    RECIBIDO_CON_NOVEDAD = "recibido_con_novedad"


class ItemTrasladoCrear(BaseModel):
    producto: str
    marca: str = ""
    presentacion: str = ""
    cantidad: int = Field(gt=0)


class TrasladoPuntoCrear(BaseModel):
    """Payload de POST /traslados-puntos -- lo arma la app movil en
    FirmaTransportador, despues de subir las 2 firmas (despacha/transporta).

    `id` lo genera el celular (expo-crypto randomUUID()) ANTES de crear el
    traslado: el path de esas firmas en Storage
    (firmas-traslados/{id}-{rol}.png) depende de este id, asi que tiene que
    conocerse de antemano -- ver subirFirmaTraslado en apps/mobile/api.ts."""

    id: str
    punto_origen_id: str
    punto_destino_id: str
    transportador_nombre: str
    fecha: date
    observaciones: str | None = None
    items: list[ItemTrasladoCrear] = Field(min_length=1)
    firma_despacha_url: str
    firma_transporta_url: str
    # usuario_punto de quien despacha (bodega origen) -- debe pertenecer al
    # punto_origen_id (ver crear_traslado en app/services/traslados_puntos.py).
    creado_por: str
    # Numero impreso en el talonario fisico (ej. "00231", "A-00231") -- lo
    # tipea quien despacha, es lo primero que copia del papel. Obligatorio
    # solo al crear -- los traslados existentes antes de este campo quedan
    # con numero_talonario null (ver app/db.py) y siguen funcionando igual.
    numero_talonario: str

    @field_validator("numero_talonario")
    @classmethod
    def _numero_talonario_valido(cls, v: str) -> str:
        texto = v.strip()
        if not texto:
            raise ValueError("El número de talonario es obligatorio")
        if not re.fullmatch(r"[A-Za-z0-9 /-]{1,30}", texto):
            raise ValueError(
                "El número de talonario solo puede tener letras, números, espacios, guiones y barras (máximo 30 caracteres)"
            )
        return texto


class ItemRecepcion(BaseModel):
    """Linea confirmada en la recepcion -- si 'Llego completo' quedo tildado
    en el movil, cantidad_recibida viaja igual a la cantidad enviada (no hay
    un modo implicito de 'no tocar'), asi el backend siempre valida contra un
    numero explicito."""

    id: str
    cantidad_recibida: int = Field(ge=0)
    novedad: str | None = None


class RecepcionTraslado(BaseModel):
    """Payload de POST /traslados-puntos/{id}/recepcion."""

    items: list[ItemRecepcion] = Field(min_length=1)
    novedad: str | None = None
    firma_recibe_url: str
    # usuario_punto de quien recibe (bodega destino).
    recibido_por: str


class SolucionNovedad(BaseModel):
    """Payload de POST /traslados-puntos/{id}/solucion -- Supervision marca
    una novedad como resuelta (ver resolver_novedad en
    app/services/traslados_puntos.py). `solucion` es obligatoria (no tiene
    sentido resolver sin explicar que se hizo); se recorta y se limita para
    no guardar un texto gigante por error.

    El consecutivo (codigo de punto + numero, ej. "NPT-1234") es bajo que
    numero queda archivada la solucion -- Erika lo busca despues para volver
    a esa novedad sin tener que recordar el traslado. Solo el formato se
    valida aca (mayusculas, digitos); que el codigo exista y este activo se
    valida contra la tabla puntos en resolver_novedad, que necesita el pool
    async."""

    supervisor_id: str
    solucion: str
    consecutivo_codigo: str
    # Solo digitos -- se guarda tal cual se escribio (sin sacar ceros a la
    # izquierda), para que el numero que Erika anoto a mano coincida siempre
    # con el que queda buscable.
    consecutivo_numero: str

    @field_validator("solucion")
    @classmethod
    def _solucion_valida(cls, v: str) -> str:
        texto = v.strip()
        if not texto:
            raise ValueError("La solución no puede estar vacía")
        if len(texto) > 2000:
            raise ValueError("La solución es demasiado larga (máximo 2000 caracteres)")
        return texto

    @field_validator("consecutivo_codigo")
    @classmethod
    def _consecutivo_codigo_valido(cls, v: str) -> str:
        texto = v.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{1,10}", texto):
            raise ValueError("El código de punto del consecutivo no es válido")
        return texto

    @field_validator("consecutivo_numero")
    @classmethod
    def _consecutivo_numero_valido(cls, v: str) -> str:
        texto = v.strip()
        if not re.fullmatch(r"\d{1,10}", texto):
            raise ValueError("El número del consecutivo debe tener solo dígitos (1 a 10)")
        return texto
