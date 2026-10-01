import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

RolDashboard = Literal["admin", "supervisor", "consulta"]

PASSWORD_MIN = 8
PASSWORD_MAX = 200

_PATRON_USUARIO = re.compile(r"^[a-z0-9._@-]{3,50}$")


def normalizar_usuario(valor: str) -> str:
    return valor.strip().lower()


def _usuario_valido(valor: str) -> str:
    valor = normalizar_usuario(valor)
    if not _PATRON_USUARIO.match(valor):
        raise ValueError("El usuario debe tener entre 3 y 50 caracteres (letras, números, punto, guion o @)")
    return valor


class LoginRequest(BaseModel):
    usuario: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)


class CambiarPasswordRequest(BaseModel):
    actual: str = Field(min_length=1, max_length=PASSWORD_MAX)
    nueva: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class UsuarioDashboardCrear(BaseModel):
    usuario: str
    nombre: str = Field(min_length=1, max_length=100)
    rol: RolDashboard
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)

    @field_validator("usuario")
    @classmethod
    def _usuario(cls, v: str) -> str:
        return _usuario_valido(v)

    @field_validator("nombre")
    @classmethod
    def _nombre(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("El nombre no puede quedar vacío")
        return v


class UsuarioDashboardActualizar(BaseModel):
    """Solo se actualiza lo que viene."""

    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    rol: RolDashboard | None = None
    activo: bool | None = None

    @field_validator("nombre")
    @classmethod
    def _nombre(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("El nombre no puede quedar vacío")
        return v


class PasswordNueva(BaseModel):
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
