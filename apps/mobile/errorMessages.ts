/**
 * Traduce los errores que ya circulan en este codigo (ver api.ts) a texto en
 * español que le sirve a un operador en terreno -- nunca la excepcion cruda
 * (stack traces, texto tecnico de Supabase, HTML de un 502 de Traefik, etc.).
 */

export type ContextoError = 'login' | 'sedes' | 'evidencia' | 'firma' | 'entrega' | 'devolucion';

const MENSAJE_SERVIDOR = 'Error del servidor. Intentá de nuevo en unos minutos.';
const MENSAJE_SESION = 'PIN incorrecto o sesión no válida.';

const MENSAJES_POR_CONTEXTO: Record<ContextoError, string> = {
  login: MENSAJE_SESION,
  sedes: 'No se pudieron cargar las sedes. Intentá de nuevo.',
  evidencia: 'No se pudo subir la foto. Revisá tu conexión e intentá de nuevo.',
  firma: 'No se pudo subir la firma. Revisá tu conexión e intentá de nuevo.',
  entrega: 'No se pudo procesar la entrega. Intentá de nuevo.',
  devolucion: 'No se pudo registrar la devolución. Intentá de nuevo.',
};

const MENSAJE_GENERICO = 'Ocurrió un error. Intentá de nuevo.';

function mensajePorContexto(contexto?: ContextoError): string {
  return contexto ? MENSAJES_POR_CONTEXTO[contexto] : MENSAJE_GENERICO;
}

// Forma que lanza parsearRespuesta en api.ts (ver ErrorEnvio) -- un objeto
// plano, nunca una instancia de Error.
function esErrorHttp(err: unknown): err is { status: number; detail?: unknown } {
  return typeof err === 'object' && err !== null && typeof (err as { status?: unknown }).status === 'number';
}

/**
 * `contexto` solo se usa como fallback -- cuando el error no trae ya un
 * mensaje de negocio utilizable (404/422 con detail, o los casos conocidos
 * de subida a Storage). Sin contexto devuelve un fallback generico.
 */
export function mensajeError(err: unknown, contexto?: ContextoError): string {
  // fetch() rechaza con un TypeError cuando no hay conexion -- el texto exacto
  // varia segun plataforma ("Network request failed" en React Native,
  // "Failed to fetch" en web/debugger).
  if (err instanceof TypeError && /network request failed|failed to fetch/i.test(err.message)) {
    return 'Sin conexión a internet. Revisá tu red e intentá de nuevo.';
  }

  if (esErrorHttp(err)) {
    const { status, detail } = err;
    if (status >= 500) return MENSAJE_SERVIDOR; // puede traer HTML/texto tecnico -- se ignora
    if (status === 401 || status === 403) return MENSAJE_SESION;
    if ((status === 404 || status === 422) && typeof detail === 'string' && detail.trim()) {
      // Ya son mensajes de negocio escritos a mano en el backend
      // (ExtraccionFallida, CantidadInvalida, "no se encontro ese documento", etc.).
      return detail;
    }
    return mensajePorContexto(contexto);
  }

  if (err instanceof Error) {
    if (err.message.startsWith('No se pudo subir la evidencia:')) {
      return 'No se pudo subir la foto. Revisá tu conexión e intentá de nuevo.';
    }
    if (err.message.startsWith('No se pudo subir la firma:')) {
      return 'No se pudo subir la firma. Revisá tu conexión e intentá de nuevo.';
    }
  }

  return mensajePorContexto(contexto);
}
