"""Lectura del talonario de traslados entre puntos a partir de una foto, con
el mismo LLM de vision que las guias de Despachos.

Vive aparte de app/services/vision.py a proposito: Despachos no se toca. De
ese modulo solo se reutilizan, sin modificarlos, la descarga de la foto
(_descargar_imagen) y la excepcion ExtraccionFallida (asi el router de
traslados la mapea a 422 igual que entregas.py).
"""

import base64
import io
import json

import httpx
from openai import AsyncOpenAI, OpenAIError
from PIL import Image

from app.config import get_settings
from app.services.vision import ExtraccionFallida, _descargar_imagen

# Talonario de traslados entre puntos: encabezado (numero, destino,
# transportador, fecha) + productos. Mismo criterio que _EXTRACTION_SCHEMA:
# strict, todas las propiedades requeridas, y lo ilegible viaja como cadena
# vacia con confianza baja (el servicio decide que hacer con eso, ver
# extraer_talonario en app/services/traslados_puntos.py).
_TALONARIO_SCHEMA = {
    "type": "object",
    "properties": {
        "numero_talonario": {
            "type": "string",
            "description": "Numero impreso dentro del recuadro de la esquina superior derecha del talonario.",
        },
        "destino": {"type": "string", "description": "Punto/bodega de destino del traslado, tal cual esta escrito."},
        "transportador": {"type": "string", "description": "Nombre de quien transporta la mercancia."},
        "fecha": {"type": "string", "description": "Fecha del talonario en formato YYYY-MM-DD, o cadena vacia."},
        "items": {
            "type": "array",
            "description": "Productos del talonario, uno por renglon.",
            "items": {
                "type": "object",
                "properties": {
                    "cantidad": {"type": "integer"},
                    "producto": {"type": "string"},
                    "marca": {"type": "string"},
                    "presentacion": {"type": "string"},
                    "fecha_vencimiento": {
                        "type": "string",
                        "description": "Fecha de vencimiento YYYY-MM-DD, o cadena vacia si el renglon no la trae.",
                    },
                },
                "required": ["cantidad", "producto", "marca", "presentacion", "fecha_vencimiento"],
                "additionalProperties": False,
            },
        },
        "confianza": {
            "type": "object",
            "description": "Score 0-1 de confianza por cada campo del encabezado.",
            "properties": {
                "numero_talonario": {"type": "number"},
                "destino": {"type": "number"},
                "transportador": {"type": "number"},
                "fecha": {"type": "number"},
            },
            "required": ["numero_talonario", "destino", "transportador", "fecha"],
            "additionalProperties": False,
        },
    },
    "required": ["numero_talonario", "destino", "transportador", "fecha", "items", "confianza"],
    "additionalProperties": False,
}

_TALONARIO_PROMPT = (
    "Esta es una foto de un talonario de traslado entre bodegas. La foto puede "
    "venir rotada o al reves (90, 180 o 270 grados) -- fijate en la orientacion "
    "del texto y leelo como corresponde. Transcribi: numero_talonario (el "
    "numero impreso dentro del recuadro de la esquina superior derecha), "
    "destino (a que bodega/punto va la mercancia), transportador (quien la "
    "lleva), fecha, y la lista de productos con cantidad, producto, marca, "
    "presentacion y fecha de vencimiento (si el renglon la trae). Las fechas "
    "son colombianas, en formato dd/mm/aaaa: conviertelas SIEMPRE a ISO "
    "YYYY-MM-DD (ej. '05/03/2026' -> '2026-03-05'). Si un dato no esta o no "
    "se lee, usa cadena vacia (o fecha_vencimiento vacia) y una confianza "
    "baja en vez de inventar un valor. Asigna un score de confianza entre 0 y "
    "1 a numero_talonario, destino, transportador y fecha segun que tan "
    "legible estaba cada uno. Lista todos los productos, uno por renglon."
)


async def extraer_datos_talonario(evidencia_url: str) -> dict:
    """Lee la foto de un talonario de traslado (encabezado + productos).

    Devuelve el dict validado contra _TALONARIO_SCHEMA. Lanza ExtraccionFallida
    si no se pudo descargar la foto, el proveedor de IA rehusa la solicitud o
    falla la extraccion. Mismo criterio que extraer_datos_guia en vision.py:
    WebP calidad 80, timeout de 30 s y sin temperature (el modelo la rechaza).
    """
    settings = get_settings()
    try:
        image_bytes, _ = await _descargar_imagen(evidencia_url)
    except httpx.HTTPError as exc:
        raise ExtraccionFallida(f"No se pudo descargar la foto del talonario: {exc}") from exc

    imagen = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    buffer = io.BytesIO()
    imagen.save(buffer, format="WEBP", quality=80)
    image_b64 = base64.standard_b64encode(buffer.getvalue()).decode("utf-8")

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=30.0)
    try:
        response = await client.chat.completions.create(
            model=settings.vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{image_b64}"}},
                        {"type": "text", "text": _TALONARIO_PROMPT},
                    ],
                }
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "extraccion_talonario",
                    "strict": True,
                    "schema": _TALONARIO_SCHEMA,
                },
            },
        )
    except OpenAIError as exc:
        raise ExtraccionFallida(f"Fallo la lectura del talonario con IA: {exc}") from exc

    mensaje = response.choices[0].message
    if getattr(mensaje, "refusal", None):
        raise ExtraccionFallida(f"El modelo de vision rechazo procesar la imagen: {mensaje.refusal}")
    if not mensaje.content:
        raise ExtraccionFallida("Respuesta sin contenido estructurado.")

    try:
        return json.loads(mensaje.content)
    except json.JSONDecodeError as exc:
        raise ExtraccionFallida(f"Respuesta de IA invalida: {exc}") from exc
