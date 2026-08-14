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

export interface ResultadoEnvio {
  id: string;
  estado: 'procesada' | 'pendiente_revision';
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
    // "Duplicate" en Storage == misma evidencia ya subida antes. No es un
    // error real para el flujo: seguimos con la URL existente y dejamos que
    // el backend decida (chequeo de duplicados real vive en /entregas/procesar).
    if (!error.message?.toLowerCase().includes('duplicate')) {
      throw new Error(`No se pudo subir la evidencia: ${error.message}`);
    }
  }

  const { data } = supabase.storage.from(EVIDENCIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, hash };
}

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

  const body = await res.json();

  if (!res.ok) {
    // 409 = duplicado bloqueado (ver Figura 1); cualquier otro error de negocio
    // llega tambien como { detail: string } gracias a FastAPI.
    throw { status: res.status, detail: body.detail ?? 'Error desconocido' } as ErrorEnvio;
  }

  return body as ResultadoEnvio;
}
