/**
 * Cliente HTTP hacia el backend (ver apps/backend). Sigue el flujo de la
 * Figura 1 del diagrama de arquitectura: sube la evidencia a Storage y
 * despues llama a /entregas/procesar con la referencia.
 */

import * as Crypto from 'expo-crypto';
// SDK 57 reemplazo readAsStringAsync por las clases File/Directory; usamos el
// import legacy explicito para no migrar ahora y evitar el warning de deprecacion.
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

import { EVIDENCIA_BUCKET, supabase } from './supabase';

// En el emulador Android, "localhost" apunta al propio emulador, no a la
// máquina host — ahí usar la IP de la máquina (o 10.0.2.2). En iOS
// simulator/dispositivo físico en la misma red, localhost/IP de LAN andan bien.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export interface ItemEntrega {
  id: string;
  descripcion: string;
  cantidad_entregada: number;
  cantidad_pendiente: number;
  // Nota manual del bodeguero (una sola, se sobreescribe) -- no la pone la
  // IA, es informacion adicional libre sobre ese producto puntual.
  nota: string | null;
  // false solo para un item recien escaneado que todavia nadie confirmo
  // (ver ItemEntrega.confirmado en el backend) -- ahi cantidad_entregada ya
  // trae el valor que leyo la IA, no lo que se entrego de verdad.
  confirmado: boolean;
}

export interface ResultadoEnvio {
  // null solo con situacion 'necesita_traslado' -- no se inserto nada
  // todavia (ver mas abajo).
  id: string | null;
  // nueva: no existia, se creo -- el bodeguero confirma cuanto quedo
  // pendiente por producto. actualizable: ya existia y le quedaba algo
  // pendiente -- el bodeguero dice cuanto entrego hoy por producto.
  // necesita_traslado: el tipo (ej. FEI/FV1) le pertenece a otra sede (ej.
  // Sede Centro) distinta de la que esta procesando (ej. Polo Sur) -- items
  // trae lo que leyo la IA como referencia, pero no hay nada guardado; hay
  // que reintentar procesarEntrega con traslado_url para que se registre.
  situacion: 'nueva' | 'actualizable' | 'necesita_traslado';
  estado: 'procesada' | 'pendiente_revision';
  // FEI (factura) / TB (traslado) / RM3 / RM2 (remision).
  tipo: string;
  items: ItemEntrega[];
}

export interface ErrorEnvio {
  status: number;
  detail: string;
}

export interface Sede {
  id: string;
  nombre: string;
  codigo: string;
}

/**
 * Parsea la respuesta de un endpoint que puede devolver un error de negocio
 * ({ detail }) o, ante un bug del backend, un 500 crudo que no es JSON --
 * en ese caso res.json() tira, y sin este catch la excepcion de parseo se
 * propaga con una forma impredecible (la pantalla queda en blanco en vez de
 * mostrar un mensaje).
 */
async function parsearRespuesta<T>(res: Response): Promise<T> {
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw { status: res.status, detail: 'Error del servidor, prueba de nuevo.' } as ErrorEnvio;
  }
  if (!res.ok) {
    throw { status: res.status, detail: body?.detail ?? 'Error desconocido' } as ErrorEnvio;
  }
  return body as T;
}

export async function fetchSedes(): Promise<Sede[]> {
  const res = await fetch(`${API_BASE_URL}/sedes`);
  if (!res.ok) {
    throw new Error(`No se pudieron cargar las sedes (${res.status})`);
  }
  return res.json();
}

export interface Empleado {
  id: string;
  nombre: string;
  sede_id: string;
  rol: 'operador' | 'supervisor' | 'admin';
}

/** Login sin correo/contrasena: solo un PIN de 4 a 6 digitos -- identifica
 * al empleado (ver POST /auth/pin en el backend). */
export async function loginConPin(pin: string): Promise<Empleado> {
  const res = await fetch(`${API_BASE_URL}/auth/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? 'PIN incorrecto');
  }
  return res.json();
}

/**
 * Sube la foto al bucket "evidencia" de Supabase Storage y devuelve la URL
 * publica + un hash del contenido (para el chequeo de duplicados/idempotencia
 * del backend — ver EntregaCreate.hash_evidencia).
 */
export async function subirEvidencia(uri: string): Promise<{ url: string; hash: string }> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);

  const path = `${new Date().toISOString().slice(0, 10)}/${hash}.jpg`;
  const { error } = await supabase.storage
    .from(EVIDENCIA_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });

  if (error) {
    // Conflicto (409, "ya existe") en Storage == misma evidencia ya subida
    // antes (mismo hash -> mismo path). No es un error real para el flujo:
    // seguimos con la URL existente y dejamos que el backend decida (el
    // chequeo de duplicados real vive en /entregas/procesar). El SDK de
    // Storage no es consistente con el texto exacto -- vimos tanto
    // "Duplicate" como "The resource already exists" -- asi que chequeamos
    // el status HTTP (409) ademas del mensaje para no depender de una sola
    // palabra clave que puede no estar presente.
    const statusCode = (error as { statusCode?: string; status?: number }).statusCode;
    const status = (error as { status?: number }).status;
    const mensaje = error.message?.toLowerCase() ?? '';
    const esConflicto =
      statusCode === '409' ||
      status === 409 ||
      mensaje.includes('duplicate') ||
      mensaje.includes('already exist');
    if (!esConflicto) {
      throw new Error(`No se pudo subir la evidencia: ${error.message}`);
    }
  }

  const { data } = supabase.storage.from(EVIDENCIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, hash };
}

/**
 * Paso 1: identifica el documento (IA de vision) y devuelve sus productos --
 * creandolo si no existia. No hace falta mandar cantidades aca, eso se
 * confirma en el paso 2 (confirmarItems) una vez que el bodeguero ve la
 * lista de productos en pantalla.
 */
export async function procesarEntrega(payload: {
  evidencia_url: string;
  hash_evidencia: string;
  sede_origen_id: string;
  operador_id: string;
  capturado_at: string;
  // Foto del traslado entre sedes -- solo hace falta reenviarla cuando la
  // primera llamada devolvio situacion 'necesita_traslado' (ver
  // ResultadoEnvio). Se sube igual que la evidencia (subirEvidencia).
  traslado_url?: string;
}): Promise<ResultadoEnvio> {
  const res = await fetch(`${API_BASE_URL}/entregas/procesar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // 409 = ya estaba todo entregado, nada que actualizar (ver Figura 1);
  // cualquier otro error de negocio llega tambien como { detail } gracias a FastAPI.
  return parsearRespuesta<ResultadoEnvio>(res);
}

/**
 * Consulta directa por codigo de factura (tipo + indicativo_numero), sin
 * pasar por una foto -- para ver que le queda pendiente a un documento ya
 * registrado. El backend siempre devuelve situacion "actualizable" (el
 * documento ya existe por definicion), asi que reusa la misma pantalla de
 * confirmacion de items que el flujo de re-escaneo.
 */
export async function buscarEntrega(tipo: string, indicativoNumero: string): Promise<ResultadoEnvio> {
  const params = new URLSearchParams({ tipo, indicativo_numero: indicativoNumero });
  const res = await fetch(`${API_BASE_URL}/entregas/buscar?${params}`);
  return parsearRespuesta<ResultadoEnvio>(res);
}

/**
 * Cancela en la pantalla de confirmacion (paso 2) sin guardar nada -- deshace
 * el insert que hizo procesarEntrega (paso 1). El backend solo borra de
 * verdad si todavia nadie confirmo cantidades; nunca toca una entrega real
 * ya confirmada. Nunca lanza -- cancelar es siempre "seguro" del lado del
 * cliente (best-effort: si falla la red, el llamador igual sigue adelante).
 */
export async function cancelarEntrega(entregaId: string, operadorId: string, sedeId: string): Promise<void> {
  const params = new URLSearchParams({ operador_id: operadorId, sede_id: sedeId });
  await fetch(`${API_BASE_URL}/entregas/${entregaId}?${params}`, { method: 'DELETE' });
}

/**
 * Paso 2: confirma lo que el bodeguero ingreso por producto. Para una
 * entrega "nueva" manda cantidad_pendiente (valor absoluto); para una
 * "actualizable" manda entregado_hoy (delta, lo suma/resta el backend). La
 * nota y la descripcion son independientes de la cantidad -- se pueden
 * mandar solas (ej. un item ya bloqueado, sin nada pendiente, pero al que
 * igual se le quiere anotar algo o corregirle el nombre que leyo la IA).
 */
export async function confirmarItems(
  entregaId: string,
  items: ({ id: string; nota?: string; descripcion?: string; cantidad_entregada?: number } & (
    | { cantidad_pendiente: number }
    | { entregado_hoy: number }
    | {}
  ))[],
  operadorId: string,
  sedeId: string,
  evidenciaUrl: string,
  hashEvidencia: string
): Promise<{ id: string; items: ItemEntrega[] }> {
  const res = await fetch(`${API_BASE_URL}/entregas/${entregaId}/items`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items,
      operador_id: operadorId,
      sede_id: sedeId,
      evidencia_url: evidenciaUrl,
      hash_evidencia: hashEvidencia,
    }),
  });

  return parsearRespuesta<{ id: string; items: ItemEntrega[] }>(res);
}

// Lista fija -- mismos valores que app.models.devolucion.MotivoDevolucion.
export type MotivoDevolucion = 'danado' | 'equivocado' | 'vencido' | 'no_era_lo_pedido' | 'otro';

// reposicion: la cantidad vuelve a quedar pendiente (se debe re-entregar).
// reembolso: se devuelve el dinero -- la cantidad queda finalizada, no
// vuelve a pendiente. Mismos valores que ResolucionDevolucion del backend.
export type ResolucionDevolucion = 'reposicion' | 'reembolso';

/**
 * El cliente devuelve un producto ya entregado. Es una accion propia,
 * inmediata -- no forma parte del guardado general de confirmarItems.
 * Solo tiene sentido sobre una entrega que ya existia (situacion
 * 'actualizable'), nunca sobre una recien escaneada sin confirmar.
 */
export async function registrarDevolucion(
  entregaId: string,
  payload: {
    item_id: string;
    cantidad: number;
    motivo: MotivoDevolucion;
    resolucion: ResolucionDevolucion;
    operador_id: string;
    sede_id: string;
  }
): Promise<{ item: ItemEntrega }> {
  const res = await fetch(`${API_BASE_URL}/entregas/${entregaId}/devoluciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parsearRespuesta<{ item: ItemEntrega }>(res);
}

/**
 * Un evento de la tabla `logs` (append-only) -- ver app/services/logging_service.py.
 * `detalle` varia segun `evento`: para 'entrega_actualizada' trae los items
 * con su cantidad_entregada/cantidad_pendiente EN ESE MOMENTO (asi se puede
 * armar el historial de fechas de un producto puntual, aunque haya
 * cambiado varias veces); para 'devolucion_registrada' trae item_id,
 * cantidad, motivo y resolucion.
 */
export interface LogEntry {
  id: string;
  evento: string;
  entidad_id: string;
  actor_id: string;
  sede_id: string;
  resultado: string;
  detalle: Record<string, any>;
  timestamp: string;
}

/** Historial completo de una entrega (todos sus productos) -- el filtrado
 * por producto se hace del lado del cliente, ver historialDeItem en App.tsx. */
export async function fetchHistorialEntrega(entregaId: string): Promise<LogEntry[]> {
  const params = new URLSearchParams({ entidad_id: entregaId, limit: '200' });
  const res = await fetch(`${API_BASE_URL}/logs?${params}`);
  return parsearRespuesta<LogEntry[]>(res);
}
