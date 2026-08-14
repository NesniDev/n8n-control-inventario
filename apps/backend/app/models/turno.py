from datetime import date, time
from enum import StrEnum

from pydantic import BaseModel


class OrigenTurno(StrEnum):
    MANUAL = "manual"
    SUGERIDO_IA = "sugerido_ia"


class TurnoCreate(BaseModel):
    empleado_id: str
    sede_id: str
    fecha: date
    hora_inicio: time
    hora_fin: time
    origen: OrigenTurno = OrigenTurno.MANUAL
