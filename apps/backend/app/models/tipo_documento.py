"""Tipos de documento que la IA de vision usa como guia (ver
app/services/tipos_documento.py y app/services/vision.py). No restringen el
campo "tipo" de entregas: son referencia del prompt, no una lista cerrada."""

from pydantic import BaseModel, field_validator


def normalizar_codigo(valor: str) -> str:
    codigo = valor.strip().upper()
    if not codigo or len(codigo) > 12 or not codigo.isalnum():
        raise ValueError("El codigo debe ser alfanumerico, de 1 a 12 caracteres")
    return codigo


class TipoDocumentoCrear(BaseModel):
    codigo: str
    descripcion: str = ""

    @field_validator("codigo")
    @classmethod
    def _codigo_valido(cls, v: str) -> str:
        return normalizar_codigo(v)

    @field_validator("descripcion")
    @classmethod
    def _descripcion_limpia(cls, v: str) -> str:
        return v.strip()


class TipoDocumentoActualizar(BaseModel):
    descripcion: str | None = None
    activo: bool | None = None

    @field_validator("descripcion")
    @classmethod
    def _descripcion_limpia(cls, v: str | None) -> str | None:
        return v.strip() if v is not None else None
