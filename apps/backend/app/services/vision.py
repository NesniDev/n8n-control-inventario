"""Extraccion de datos de guias de despacho a partir de una foto, usando un LLM
de vision (OpenAI) con salida estructurada. Ver Figura 1 del diagrama de
arquitectura: este servicio implementa el paso "IA Vision -> extrae JSON".
"""

import base64
import json

import httpx
from openai import AsyncOpenAI

from app.config import get_settings

# Esquema fijo que el modelo debe respetar. response_format=json_schema (modo
# strict) garantiza que la respuesta valida contra este schema (o falla
# explicitamente), asi que no necesitamos un parser de texto libre ni
# reintentos de "arregla el JSON".
_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "numero_guia": {"type": "string"},
        "remitente": {"type": "string"},
        "destinatario": {"type": "string"},
        "sede_destino_sugerida": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "descripcion": {"type": "string"},
                    "cantidad": {"type": "integer"},
                },
                "required": ["descripcion", "cantidad"],
                "additionalProperties": False,
            },
        },
        "confianza": {
            "type": "object",
            "description": "Score 0-1 de confianza por cada campo obligatorio extraido.",
            "properties": {
                "numero_guia": {"type": "number"},
                "remitente": {"type": "number"},
                "destinatario": {"type": "number"},
            },
            "required": ["numero_guia", "remitente", "destinatario"],
            "additionalProperties": False,
        },
    },
    "required": [
        "numero_guia",
        "remitente",
        "destinatario",
        "sede_destino_sugerida",
        "items",
        "confianza",
    ],
    "additionalProperties": False,
}

_EXTRACTION_PROMPT = (
    "Esta es una foto de una guia de despacho o remision logistica. "
    "Extrae el numero de guia, remitente, destinatario, los items listados "
    "(descripcion + cantidad) y la sede destino si aparece escrita. "
    "Para cada campo obligatorio (numero_guia, remitente, destinatario) "
    "asigna un score de confianza entre 0 y 1 segun que tan legible/clara "
    "estaba esa parte de la imagen. Si un campo no es legible, usa cadena "
    "vacia y confianza baja en vez de inventar un valor."
)


class ExtraccionFallida(Exception):
    pass


async def _descargar_imagen(evidencia_url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.get(evidencia_url)
        resp.raise_for_status()
        media_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
        return resp.content, media_type


async def extraer_datos_guia(evidencia_url: str) -> dict:
    """Descarga la evidencia y le pide al modelo que la estructure a JSON.

    Devuelve el dict validado contra _EXTRACTION_SCHEMA. Lanza ExtraccionFallida
    si el proveedor de IA rehusa la solicitud o falla la extraccion.
    """
    settings = get_settings()
    image_bytes, media_type = await _descargar_imagen(evidencia_url)
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.chat.completions.create(
        model=settings.vision_model,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{image_b64}"},
                    },
                    {"type": "text", "text": _EXTRACTION_PROMPT},
                ],
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "extraccion_guia",
                "strict": True,
                "schema": _EXTRACTION_SCHEMA,
            },
        },
    )

    mensaje = response.choices[0].message
    if getattr(mensaje, "refusal", None):
        raise ExtraccionFallida(f"El modelo de vision rechazo procesar la imagen: {mensaje.refusal}")
    if not mensaje.content:
        raise ExtraccionFallida("Respuesta sin contenido estructurado.")

    return json.loads(mensaje.content)
