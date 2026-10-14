"""Modelos del talonario por punto (ver app/services/talonarios.py): cada punto
trabaja con un talonario activo de 50 hojas (letra + rango de numeros) y cada
traslado consume la siguiente hoja en orden."""

import re
from uuid import UUID

from pydantic import BaseModel, field_validator

HOJAS_POR_TALONARIO = 50
NUMERO_MAXIMO = 9_999_999  # hasta 7 digitos


class TalonarioConfigurar(BaseModel):
    """Payload de POST /talonarios-puntos/configurar. `motivo` solo es
    obligatorio si hay un talonario activo que todavia no se agoto (cambio
    antes de terminar) -- eso lo valida configurar_talonario, que conoce el
    estado."""

    punto_id: UUID
    usuario_id: UUID
    letra: str
    numero_inicial: int
    motivo: str | None = None

    @field_validator("letra")
    @classmethod
    def _letra_valida(cls, v: str) -> str:
        texto = v.strip().upper()
        if not re.fullmatch(r"[A-Z]{1,3}", texto):
            raise ValueError("La letra debe tener de 1 a 3 letras (A-Z)")
        return texto

    @field_validator("numero_inicial")
    @classmethod
    def _numero_valido(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("El primer número debe ser mayor que 0")
        if v + HOJAS_POR_TALONARIO - 1 > NUMERO_MAXIMO:
            raise ValueError("El primer número es demasiado grande (máximo 7 dígitos en la última hoja)")
        return v

    @field_validator("motivo")
    @classmethod
    def _motivo_limpio(cls, v: str | None) -> str | None:
        texto = (v or "").strip()
        return texto or None


class HojaAnular(BaseModel):
    """Payload de POST /talonarios-puntos/anular-hoja -- anula exactamente la
    siguiente hoja pendiente de un talonario activo del punto. `talonario_id`
    indica cual; si falta (app vieja) y el punto tiene un unico activo, se usa ese."""

    punto_id: UUID
    usuario_id: UUID
    motivo: str
    talonario_id: UUID | None = None

    @field_validator("motivo")
    @classmethod
    def _motivo_valido(cls, v: str) -> str:
        texto = v.strip()
        if not texto:
            raise ValueError("El motivo es obligatorio")
        if len(texto) > 500:
            raise ValueError("El motivo es demasiado largo (máximo 500 caracteres)")
        return texto
