from enum import StrEnum

from pydantic import BaseModel, field_validator


class RolEmpleado(StrEnum):
    OPERADOR = "operador"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"
    # Factura primero (crea la entrega como "nueva"); el bodeguero
    # ('operador') solo puede re-fotografiar un documento que punto_venta ya
    # facturo -- ver FacturacionRequerida en app/services/duplicates.py.
    PUNTO_VENTA = "punto_venta"
    # Solo lectura: ve las fotos marcadas es_faia (GET /entregas/faia), no
    # crea ni confirma nada.
    FAIA_VIEWER = "faia_viewer"


def _validar_pin(pin: str) -> str:
    if not pin.isdigit() or not (4 <= len(pin) <= 6):
        raise ValueError("El PIN debe tener entre 4 y 6 digitos")
    return pin


class EmpleadoCreate(BaseModel):
    nombre: str
    sede_id: str
    rol: RolEmpleado = RolEmpleado.OPERADOR
    pin: str

    @field_validator("pin")
    @classmethod
    def _pin_valido(cls, v: str) -> str:
        return _validar_pin(v)


class PinLogin(BaseModel):
    pin: str
    empleado_id: str

    @field_validator("pin")
    @classmethod
    def _pin_valido(cls, v: str) -> str:
        return _validar_pin(v)
