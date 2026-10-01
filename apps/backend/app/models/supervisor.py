"""Supervisores que resuelven traslados recibidos con novedad -- ver el plan
"supervision-novedades" y resolver_novedad en app/services/traslados_puntos.py.
Cuenta propia (no es un usuario_punto ni un empleado): no pertenece a un
punto ni a una sede, solo revisa y resuelve novedades desde cualquier lado.
"""

from typing import Literal

from pydantic import BaseModel, field_validator

from app.models.empleado import _validar_pin


class PinLoginSupervisor(BaseModel):
    """Payload de POST /supervisores/auth/pin -- mismo patron que
    PinLoginPunto (app/models/punto.py): el supervisor ya se eligio en el
    paso anterior del login movil (por ahora la unica cuenta real es Erika),
    el PIN solo confirma esa identidad puntual."""

    supervisor_id: str
    pin: str

    @field_validator("pin")
    @classmethod
    def _pin_valido(cls, v: str) -> str:
        return _validar_pin(v)


class SupervisorCrear(BaseModel):
    nombre: str
    pin: str

    @field_validator("pin")
    @classmethod
    def _pin_valido(cls, v: str) -> str:
        return _validar_pin(v)


class SupervisorActualizar(BaseModel):
    nombre: str | None = None
    estado: Literal["activo", "inactivo"] | None = None
