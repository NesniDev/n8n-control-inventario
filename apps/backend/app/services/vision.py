"""Extraccion de datos de guias de despacho a partir de una foto, usando un LLM
de vision (OpenAI) con salida estructurada. Ver Figura 1 del diagrama de
arquitectura: este servicio implementa el paso "IA Vision -> extrae JSON".
"""

import base64
import json

import httpx
from openai import AsyncOpenAI, OpenAIError

from app.config import get_settings

# Tipos de documento que reconoce el pipeline: factura (FEI), traslado entre
# bodegas (TB) o remision (RM3/RM2) — ver app.models.entrega.TipoDocumento.
_TIPOS_DOCUMENTO = ("FEI", "TB", "RM3", "RM2")

# Esquema fijo que el modelo debe respetar. response_format=json_schema (modo
# strict) garantiza que la respuesta valida contra este schema (o falla
# explicitamente), asi que no necesitamos un parser de texto libre ni
# reintentos de "arregla el JSON".
_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "tipo": {"type": "string", "enum": list(_TIPOS_DOCUMENTO)},
        "indicativo_numero": {"type": "string"},
        "items": {
            "type": "array",
            "description": "Productos listados en el documento (columnas DETALLE/CANT.), uno por linea.",
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
                "tipo": {"type": "number"},
                "indicativo_numero": {"type": "number"},
            },
            "required": ["tipo", "indicativo_numero"],
            "additionalProperties": False,
        },
    },
    "required": ["tipo", "indicativo_numero", "items", "confianza"],
    "additionalProperties": False,
}

_EXTRACTION_PROMPT = (
    "Esta es una foto de un documento de despacho: puede ser una factura "
    "(tipo FEI), un traslado entre bodegas (tipo TB) o una remision (tipo "
    "RM3 o RM2, segun lo que diga el documento). Identifica el tipo de "
    "documento, su indicativo/numero (el consecutivo impreso, por ejemplo si "
    "el documento dice 'FEI 10254' el indicativo_numero es '10254'), y la "
    "lista de productos con su cantidad (columnas DETALLE y CANT. del "
    "documento) -- puede haber uno o varios productos, listalos todos, uno "
    "por item. Si el documento no distingue productos individuales, usa un "
    "solo item con una descripcion general y la cantidad total. Para tipo e "
    "indicativo_numero asigna un score de confianza entre 0 y 1 segun que "
    "tan legible/clara estaba esa parte de la imagen -- si no es legible, "
    "usa cadena vacia y confianza baja en vez de inventar un valor."
)


class ExtraccionFallida(Exception):
    pass


async def _descargar_imagen(evidencia_url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http:
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
    try:
        image_bytes, media_type = await _descargar_imagen(evidencia_url)
    except httpx.HTTPError as exc:
        # Storage no respondio o la URL no sirve (ej. reemplazo de red
        # intermitente en la sede, o la evidencia todavia no replico) -- sin
        # este catch la excepcion cruda de httpx tira un 500 sin JSON, que del
        # lado del movil se ve como "error o pantalla en blanco".
        raise ExtraccionFallida(f"No se pudo descargar la evidencia: {exc}") from exc

    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    try:
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
    except OpenAIError as exc:
        # Cualquier error del proveedor no cubierto por los reintentos propios
        # del SDK (rate limit agotado, imagen rechazada por tamano/formato,
        # timeout, etc.) -- OpenAIError es la base de TODAS las excepciones de
        # este SDK. Sin este catch, cualquiera de estas tiraba un 500 crudo
        # (no JSON) en vez del 502 con detail que espera el cliente.
        raise ExtraccionFallida(f"Fallo la extraccion con IA: {exc}") from exc

    mensaje = response.choices[0].message
    if getattr(mensaje, "refusal", None):
        raise ExtraccionFallida(f"El modelo de vision rechazo procesar la imagen: {mensaje.refusal}")
    if not mensaje.content:
        raise ExtraccionFallida("Respuesta sin contenido estructurado.")

    try:
        return json.loads(mensaje.content)
    except json.JSONDecodeError as exc:
        raise ExtraccionFallida(f"Respuesta de IA invalida: {exc}") from exc
