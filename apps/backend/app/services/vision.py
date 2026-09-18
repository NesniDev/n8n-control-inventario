"""Extraccion de datos de guias de despacho a partir de una foto, usando un LLM
de vision (OpenAI) con salida estructurada. Ver Figura 1 del diagrama de
arquitectura: este servicio implementa el paso "IA Vision -> extrae JSON".
"""

import base64
import io
import json

import httpx
from openai import AsyncOpenAI, OpenAIError
from PIL import Image

from app.config import get_settings

# Tipos de documento mas comunes -- factura (FEI/FV1), EDP/EDV, traslado
# entre bodegas (TB9) o remision (RM3/RM2), ver app.models.entrega.TipoDocumento
# -- pero "tipo" en el schema de abajo NO esta restringido a estos: son la
# guia del prompt, no una jaula, porque en la practica aparecen otros. Ver
# tambien _TIPO_SEDE_DUENA en app/services/duplicates.py: EDP/EDV son de
# Polo Sur, FEI/FV1 de Sede Centro -- si el prompt no menciona un codigo
# explicitamente, el modelo tiende a "redondearlo" al ejemplo mas parecido
# (FEI) en vez de transcribirlo tal cual, lo que rompia esa restriccion.
#
# Esquema fijo que el modelo debe respetar. response_format=json_schema (modo
# strict) garantiza que la respuesta valida contra este schema (o falla
# explicitamente), asi que no necesitamos un parser de texto libre ni
# reintentos de "arregla el JSON".
_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        # Sin "enum": los tipos conocidos son la guia del prompt, no una
        # jaula -- si el documento real dice otra cosa, la IA la transcribe
        # tal cual en vez de forzar la mas parecida de la lista (ver
        # app.models.entrega.TipoDocumento, que ya no restringe validacion).
        "tipo": {"type": "string"},
        "indicativo_numero": {"type": "string"},
        "concepto": {
            "type": "string",
            "description": (
                "Texto del campo 'Concepto' del documento, si existe -- en guias de "
                "traslado ese campo suele referenciar el numero de la factura de "
                "origen del movimiento (ver _concepto_referencia_factura en "
                "app.services.duplicates), que es un codigo DISTINTO al indicativo/"
                "numero propio de la guia de traslado. El campo 'Concepto' esta "
                "tipicamente mas abajo en el documento, despues del titulo/empresa, el "
                "nombre del dueno, y el NIT, en ese orden -- usa esa posicion para "
                "ubicarlo. Es UN SOLO campo 'Concepto' cuyo valor esta impreso DOS "
                "VECES, en dos renglones seguidos identicos (no son dos campos "
                "distintos): el primer renglon tiene la etiqueta 'Concepto' al "
                "principio, el segundo repite el mismo texto sin la etiqueta. "
                "Formato real tipico: el valor es una frase corta 'TRANSPORTA "
                "<nombre de una persona> <codigo tipo-numero>', ej. 'Concepto  "
                "TRANSPORTA NELSON LEON FEI-152754' seguido, en el renglon de abajo, "
                "de 'TRANSPORTA NELSON LEON FEI-152754' otra vez. Si uno de los dos "
                "renglones esta poco legible, el otro trae el mismo dato -- revisa "
                "ambos. Transcribi en concepto el texto completo (con la palabra "
                "'TRANSPORTA' y el nombre incluidos, no solo el codigo aislado). "
                "Cadena vacia si "
                "el documento no tiene campo 'Concepto'."
            ),
        },
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
                "items": {"type": "number"},
            },
            "required": ["tipo", "indicativo_numero", "items"],
            "additionalProperties": False,
        },
    },
    "required": ["tipo", "indicativo_numero", "concepto", "items", "confianza"],
    "additionalProperties": False,
}

_EXTRACTION_PROMPT = (
    "Esta es una foto de un documento de despacho. La foto puede venir "
    "rotada o al reves (90, 180 o 270 grados respecto de la orientacion de "
    "lectura normal) -- antes de transcribir nada, fijate en la orientacion "
    "del texto impreso y leelo como corresponde, sin asumir que la foto ya "
    "viene derecha. El tipo es el codigo "
    "impreso junto al numero (ej. 'FEI 10254' -> tipo FEI, 'EDP 340' -> tipo "
    "EDP) -- puede ser, entre otros, FEI o FV1 (factura), EDP o EDV, TB9 "
    "(traslado entre bodegas), o RM3/RM2 (remision). Esta lista es solo "
    "referencia, NO una jaula: transcribi EXACTAMENTE el codigo que este "
    "impreso en el documento, letra por letra, aunque no sea ninguno de "
    "estos ejemplos -- nunca lo reemplaces por el mas parecido de la lista "
    "ni asumas FEI por defecto. Identifica el tipo de documento, su "
    "indicativo/numero (el consecutivo impreso, por ejemplo si el documento "
    "dice 'FEI 10254' el indicativo_numero es '10254'), y la lista de "
    "productos con su cantidad (columnas DETALLE y CANT. del documento) -- "
    "puede haber uno o varios productos, listalos todos, uno por item. Si "
    "el documento no distingue productos individuales, usa un solo item con "
    "una descripcion general y la cantidad total. Busca tambien un campo "
    "'Concepto' (tipico en guias de traslado, donde referencia la factura "
    "de origen del movimiento -- un codigo tipo-numero DISTINTO al "
    "indicativo/numero propio de la guia) y transcribilo completo y tal "
    "cual en concepto. Es UN SOLO campo 'Concepto' cuyo valor esta impreso "
    "DOS VECES, en dos renglones seguidos identicos (no son dos campos "
    "distintos): el primer renglon tiene la etiqueta 'Concepto' al "
    "principio, el segundo repite el mismo texto sin la etiqueta. Formato "
    "real tipico: el valor es una frase corta 'TRANSPORTA <nombre de una "
    "persona> <codigo tipo-numero>', ej. 'Concepto  TRANSPORTA NELSON LEON "
    "FEI-152754' seguido, en el renglon de abajo, de 'TRANSPORTA NELSON "
    "LEON FEI-152754' otra vez. Si uno de los dos renglones esta poco "
    "legible, el otro trae el mismo dato -- revisa ambos. Transcribi en "
    "concepto el texto completo (con la palabra 'TRANSPORTA' y el nombre "
    "incluidos, no solo el codigo aislado). Ese bloque esta tipicamente "
    "mas abajo en el documento, en este orden: titulo/empresa, nombre del "
    "dueno, NIT, y recien despues 'Concepto' -- usa esa posicion para "
    "ubicarlo si el "
    "documento tiene varios bloques de texto parecidos. Si no existe ese "
    "campo, usa cadena vacia. Para tipo e indicativo_numero asigna un score "
    "de confianza entre 0 y 1 segun que "
    "tan legible/clara estaba esa parte de la imagen -- si no es legible, "
    "usa cadena vacia y confianza baja en vez de inventar un valor. Asigna "
    "tambien un score de confianza entre 0 y 1 para items en conjunto (no "
    "uno por producto): que tan legibles estaban los nombres y cantidades "
    "de la lista completa -- baja si la letra es chica, borrosa, o el papel "
    "esta doblado/manchado justo en esa zona. "
    "Algunas guias tienen correcciones a mano: un valor impreso tachado con "
    "una cantidad o texto distinto escrito al lado o encima, a mano. IGNORA "
    "SIEMPRE lo escrito a mano y las tachaduras -- transcribi UNICAMENTE el "
    "valor original impreso, aunque este tachado. Esto aplica a tipo, "
    "indicativo_numero, y tambien a la cantidad y descripcion de cada item. "
    "A veces la descripcion de un producto no entra en un solo renglon de "
    "DETALLE y su ultima palabra (tipicamente una unidad: KILOS, UND, CAJAS, "
    "METROS) queda en el renglon de abajo, sin su propio valor de CANT. Eso "
    "NO es un producto nuevo. Ejemplo: '1.00 | 75936  SAL BLANCA * 40 | "
    "19,500.00' seguido de 'KILOS' solo en el renglon siguiente es UN SOLO "
    "producto: 'SAL BLANCA * 40 KILOS', cantidad 1. No lo separes en dos "
    "items."
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

    # Recodificar siempre a WebP (venga la evidencia en JPEG -- app movil
    # vieja -- o ya en WebP -- app nueva, ver comprimirParaEnvio en
    # PantallaCapturaFoto.tsx) antes de mandarla a la IA: WebP a la misma
    # resolucion/calidad pesa la mitad que JPEG y el modelo la procesa mucho
    # mas rapido (medido: ~2.7s promedio vs ~5.2s con JPEG, misma imagen,
    # misma resolucion -- ver plan de este cambio). No se descarta color
    # (a diferencia de convertir a escala de grises, que tambien se probo y
    # se descarto por el riesgo de perder informacion real, ej. sellos o
    # tinta de otro color) -- Image.open() abre JPEG o WebP indistintamente,
    # asi que este mismo codigo sirve para ambos formatos sin rama especial.
    imagen = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    buffer = io.BytesIO()
    imagen.save(buffer, format="WEBP", quality=80)
    image_b64 = base64.standard_b64encode(buffer.getvalue()).decode("utf-8")
    media_type = "image/webp"

    # Sin este timeout, el cliente usa el default del SDK (600s, mas hasta 2
    # reintentos automaticos -- hasta 30 minutos reales en el peor caso) y el
    # operador se queda mirando "Extrayendo datos..." sin ningun corte si la
    # IA anda lenta. 30s alcanza de sobra en el caso normal (la extraccion
    # tarda unos pocos segundos); si se pasa, mejor cortar y que
    # ExtraccionFallida le devuelva un error claro al movil (ver el catch de
    # OpenAIError mas abajo, ya lo maneja) que dejarlo esperando indefinido.
    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=30.0)
    try:
        response = await client.chat.completions.create(
            model=settings.vision_model,
            # NO fijar temperature: se probo temperature=0 (buscando lecturas
            # deterministicas, ver commit revertido) y el modelo configurado
            # en VISION_MODEL lo rechaza con 400 ("Unsupported value:
            # 'temperature' does not support 0 with this model. Only the
            # default (1) value is supported.") -- rompia la extraccion por
            # completo. Verificado en logs reales de produccion antes de
            # revertir. Si se quiere determinismo, hay que resolverlo de otra
            # forma (ver docs/architecture.md o el historial de este archivo).
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
        # (no JSON) en vez del error con detail que espera el cliente (ver
        # entregas.py -- el router mapea ExtraccionFallida a un 422).
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
