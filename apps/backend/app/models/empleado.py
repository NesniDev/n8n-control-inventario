from enum import StrEnum

from pydantic import BaseModel


class RolEmpleado(StrEnum):
    OPERADOR = "operador"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"


class EmpleadoCreate(BaseModel):
    nombre: str
    sede_id: str
    rol: RolEmpleado = RolEmpleado.OPERADOR
