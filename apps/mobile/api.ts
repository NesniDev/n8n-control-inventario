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
}

export interface ResultadoEnvio {
  id: string;
  // nueva: no existia, se creo -- el bodeguero confirma cuanto quedo
  // pendiente por producto. actualizable: ya existia y le quedaba algo
  // pendiente -- el bodeguero dice cuanto entrego hoy por producto.
  situacion: 'nueva' | 'actualizable';
  estado: 'procesada' | 'pendiente_revision';
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
    throw { status: res.status, detail: 'Error del servidor, probá de nuevo.' } as ErrorEnvio;
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

/** Login sin correo/contrasena: solo un PIN de 4 a 6 digitos. */
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
 * Paso 2: confirma lo que el bodeguero ingreso por producto. Para una
 * entrega "nueva" manda cantidad_pendiente (valor absoluto); para una
 * "actualizable" manda entregado_hoy (delta, lo suma/resta el backend).
 */
export async function confirmarItems(
  entregaId: string,
  items: ({ id: string } & ({ cantidad_pendiente: number } | { entregado_hoy: number }))[],
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
