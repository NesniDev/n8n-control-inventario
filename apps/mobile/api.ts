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
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

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
  indicativo_numero: string;
  items: ItemEntrega[];
  // Confianza por campo que devolvio la IA al leer tipo/indicativo_numero
  // (ver marcar_estado_por_confianza en el backend). El movil la guarda para
  // poder reenviarla en un reintento (ver procesarEntrega, campos
  // _conocido/_conocida) sin tener que releer la factura con IA.
  confianza: Record<string, number>;
  // Presente en los dos endpoints (procesarEntrega tambien lo arma a mano,
  // ver procesar_extraccion en el backend) -- null en un documento recien
  // creado o confirmado sin firma ("Guardar nota"/"Confirmar cantidades").
  firma_url?: string | null;
  // Flag a nivel documento (no por item). Presente en ambos endpoints --
  // procesarEntrega lo arma a mano (False en nueva/necesita_traslado, o el
  // valor ya guardado si el documento ya existia), buscarEntrega lo trae
  // via select e.* -- asi el movil precarga el switch de PantallaConfirmando
  // con el valor real en vez de asumir false y pisarlo en una reconfirmacion.
  es_faia: boolean;
  // Nota a nivel documento completo (distinta de ItemEntrega.nota, que es
  // por producto) -- mismo criterio que es_faia: presente en ambos
  // endpoints, se precarga en Confirmando para no pisar una nota ya escrita
  // en una visita anterior. null si nunca se escribio.
  nota_general: string | null;
  // Aviso TEMPRANO (no el gate real, ver aplicar_actualizacion_items en el
  // backend) de que este documento pertenece a otra sede -- solo presente
  // cuando situacion es 'actualizable' Y se mando el sede_id de quien
  // consulta (buscarEntrega siempre lo manda; procesarEntrega tambien).
  // Permite mostrar la tarjeta "Traslado requerido" apenas se abre
  // Confirmando, sin esperar a que el bodeguero cargue cantidades y falle
  // al confirmar.
  requiere_traslado?: boolean;
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

// Formas minimas compartidas por PantallaLogin.tsx (generalizada para poder
// loguear tanto Despachos -- sedes/empleados -- como Traslados -- puntos/
// usuarios_punto) -- ver el plan "traslados-entre-puntos". Sede y Empleado
// ya satisfacen estas formas estructuralmente (tienen de sobra), asi que no
// hacen falta cambios en esos tipos.
export interface Lugar {
  id: string;
  nombre: string;
}

export interface UsuarioLogin {
  id: string;
  nombre: string;
  rol?: string;
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

// Ver app/models/empleado.py RolEmpleado -- punto_venta factura primero
// (PantallaCapturaFoto/Confirmando, mismo flujo que operador pero sin el
// switch "Es FAIA", ver PantallaConfirmando); faia_viewer no usa esta app
// (solo el panel /faia del dashboard), se lista por completitud del tipo.
export type RolEmpleado = 'operador' | 'supervisor' | 'admin' | 'punto_venta' | 'faia_viewer';

export interface Empleado {
  id: string;
  nombre: string;
  sede_id: string;
  rol: RolEmpleado;
}

// Version liviana de Empleado para el paso "elegir bodeguero" -- alcanza con
// lo que se muestra en la lista, no hace falta sede_id (ya se eligio la sede).
export interface EmpleadoBasico {
  id: string;
  nombre: string;
  rol: RolEmpleado;
}

/** Bodegueros activos de una sede, para el paso intermedio del login (elegir
 * quien esta usando el telefono antes de pedir el PIN). Ver GET /empleados
 * en el backend -- ya filtra por sede y ya viene sin datos de PIN. */
export async function fetchEmpleados(sedeId: string): Promise<EmpleadoBasico[]> {
  const params = new URLSearchParams({ sede_id: sedeId });
  const res = await fetch(`${API_BASE_URL}/empleados?${params}`);
  if (!res.ok) {
    throw new Error(`No se pudieron cargar los bodegueros (${res.status})`);
  }
  return res.json();
}

/** Login sin correo/contrasena: el bodeguero ya se elige en el paso anterior
 * (ver PantallaLogin) -- el PIN solo confirma esa identidad puntual (ver
 * POST /auth/pin en el backend). */
export async function loginConPin(pin: string, empleadoId: string): Promise<Empleado> {
  const res = await fetch(`${API_BASE_URL}/auth/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, empleado_id: empleadoId }),
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

  // WebP, no JPEG -- comprimirParaEnvio (PantallaCapturaFoto.tsx) ya entrega
  // el archivo en ese formato (misma resolucion/calidad, la mitad de peso).
  const path = `${new Date().toISOString().slice(0, 10)}/${hash}.webp`;
  const { error } = await supabase.storage
    .from(EVIDENCIA_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/webp', upsert: false });

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
 * react-native-signature-canvas entrega la firma como data URI PNG a la
 * resolucion de la pantalla (~970x1670 px, ~95 KB medido con firmas reales).
 * Antes de subirla se achica a 600 px de ancho y se pasa a WebP -- mismo
 * criterio que comprimirParaEnvio para las fotos: de ~95 KB baja a ~15 KB sin
 * perder legibilidad, lo que importa al subir desde bodegas con mala señal
 * (un traslado lleva 3 firmas). manipulateAsync necesita un archivo, no un
 * data URI, por eso pasa por un temporal en cache que se borra al terminar.
 */
async function firmaAWebp(firmaDataUri: string): Promise<ArrayBuffer> {
  const base64 = firmaDataUri.replace(/^data:image\/\w+;base64,/, '');
  const temporal = `${FileSystem.cacheDirectory}firma-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(temporal, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const resultado = await manipulateAsync(temporal, [{ resize: { width: 600 } }], {
      compress: 0.9,
      format: SaveFormat.WEBP,
      base64: true,
    });
    FileSystem.deleteAsync(resultado.uri, { idempotent: true }).catch(() => {});
    if (!resultado.base64) throw new Error('No se pudo procesar la firma');
    return decode(resultado.base64);
  } finally {
    FileSystem.deleteAsync(temporal, { idempotent: true }).catch(() => {});
  }
}

/**
 * Sube la firma del cliente (dibujada con el dedo, ver <Signature> en
 * App.tsx) al mismo bucket que la evidencia, en su propio subpath. A
 * diferencia de subirEvidencia, recibe un data URI base64 ya en memoria
 * (react-native-signature-canvas entrega el PNG asi, no un uri de archivo).
 * upsert: true porque el path es por entregaId, no por hash de contenido --
 * una re-firma pisa la anterior, no hace falta dedup.
 */
// Las firmas anteriores a este cambio quedaron como firmas/{id}.png -- sus
// URLs siguen guardadas en entregas.firma_url y funcionan igual.
export async function subirFirma(entregaId: string, firmaDataUri: string): Promise<{ url: string }> {
  const path = `firmas/${entregaId}.webp`;
  const { error } = await supabase.storage
    .from(EVIDENCIA_BUCKET)
    .upload(path, await firmaAWebp(firmaDataUri), { contentType: 'image/webp', upsert: true });

  if (error) {
    throw new Error(`No se pudo subir la firma: ${error.message}`);
  }

  const { data } = supabase.storage.from(EVIDENCIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
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
  // Lectura previa de ESTA MISMA foto (reintento tras necesita_traslado) --
  // si vienen los 4 completos, el backend NO vuelve a leer la factura con IA
  // (evita que dos lecturas de la misma imagen no coincidan entre si).
  tipo_conocido?: string;
  indicativo_numero_conocido?: string;
  items_conocidos?: { descripcion: string; cantidad: number }[];
  confianza_conocida?: Record<string, number>;
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
export async function buscarEntrega(
  tipo: string,
  indicativoNumero: string,
  sedeId: string
): Promise<ResultadoEnvio> {
  const params = new URLSearchParams({ tipo, indicativo_numero: indicativoNumero, sede_id: sedeId });
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
  hashEvidencia: string,
  // URL publica de la firma del cliente -- solo viene cuando se confirmaron
  // cantidades desde el movil (fase 'firma' en App.tsx), no en "Guardar nota".
  firmaUrl?: string,
  // Flag a nivel documento (no por item) -- ver el switch "Es FAIA" en
  // PantallaConfirmando. undefined/null deja el valor actual sin tocar.
  esFaia?: boolean,
  // Nota a nivel documento completo (distinta de nota por item, arriba en
  // `items`) -- ver el editor "Nota general" en PantallaConfirmando.
  // undefined deja el valor actual sin tocar; "" SI la borra.
  notaGeneral?: string,
  // Datos de quien retira esta visita puntual -- solo tiene sentido junto a
  // firmaUrl (alguien presente para firmar), ver el formulario previo a
  // VisorFirma en PantallaConfirmando. No es una columna: queda en el
  // detalle del evento de esta confirmacion (ver logs en el backend).
  retiradoPor?: { nombre: string; telefono: string },
  // Foto de traslado -- solo hace falta cuando el backend ya devolvio
  // "necesita_traslado" en un intento anterior de ESTA MISMA confirmacion
  // (ver extraerNecesitaTrasladoConfirmar en errorMessages.ts y la tarjeta
  // "Traslado requerido" en PantallaConfirmando.tsx). Mismo par que ya usa
  // procesarEntrega para el traslado al crear.
  trasladoUrl?: string,
  conceptoTraslado?: string
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
      firma_url: firmaUrl,
      es_faia: esFaia,
      nota_general: notaGeneral,
      retirado_por: retiradoPor,
      traslado_url: trasladoUrl,
      concepto_traslado: conceptoTraslado,
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
  // Nombre del empleado dueño de actor_id (join en el backend, ver
  // listar_logs) -- null si actor_id no matchea ningun empleado (ej.
  // "system" del sync en tiempo real, o "supervisor" de una correccion del
  // dashboard) -- caer al actor_id crudo en ese caso, mismo criterio que ya
  // usa operador_nombre/bodeguero_nombre en Entrega.
  actor_nombre?: string | null;
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

// ---------------------------------------------------------------------------
// Traslados entre puntos -- flujo aparte de Despachos (ver Navegacion.tsx,
// tab "Traslados" y el plan "traslados-entre-puntos"). Puntos y sus usuarios
// son listas DISTINTAS de sedes/empleados, con su propio login por PIN.

export interface Punto {
  id: string;
  nombre: string;
  // Codigo corto (ej. "NPT") -- null en un punto que todavia no lo tiene
  // cargado (ver scripts/cargar_puntos.py). Se usa para armar el
  // consecutivo de una solucion de novedad (ver resolverNovedadTraslado).
  codigo?: string | null;
}

/** Version liviana de UsuarioPunto para el paso "elegir quien esta usando el
 * telefono" del login -- mismo criterio que EmpleadoBasico. */
export interface UsuarioPuntoBasico {
  id: string;
  nombre: string;
}

export interface UsuarioPunto {
  id: string;
  nombre: string;
  punto_id: string;
}

export async function fetchPuntos(): Promise<Punto[]> {
  const res = await fetch(`${API_BASE_URL}/puntos`);
  if (!res.ok) {
    throw new Error(`No se pudieron cargar los puntos (${res.status})`);
  }
  return res.json();
}

/** Usuarios activos de un punto, para el paso intermedio del login (mismo
 * patron que fetchEmpleados). */
export async function fetchUsuariosPunto(puntoId: string): Promise<UsuarioPuntoBasico[]> {
  const res = await fetch(`${API_BASE_URL}/puntos/${puntoId}/usuarios`);
  if (!res.ok) {
    throw new Error(`No se pudo cargar el personal de este punto (${res.status})`);
  }
  return res.json();
}

/** Login sin correo/contrasena para usuarios de punto -- mismo mecanismo que
 * loginConPin, contra POST /puntos/auth/pin. */
export async function loginPunto(pin: string, usuarioId: string): Promise<UsuarioPunto> {
  const res = await fetch(`${API_BASE_URL}/puntos/auth/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, usuario_id: usuarioId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? 'PIN incorrecto');
  }
  return res.json();
}

export type EstadoTraslado = 'en_transito' | 'recibido' | 'recibido_con_novedad';

// Estado de la novedad de un traslado ya recibido con diferencia -- ver
// app/models/traslado_punto.py. 'pendiente' apenas se registra la recepcion
// con novedad; 'resuelta' cuando Supervision carga una solucion (ver
// resolverNovedadTraslado). Ausente/null en un traslado sin novedad.
export type EstadoNovedad = 'pendiente' | 'resuelta';

export interface ItemTraslado {
  id: string;
  traslado_id: string;
  producto: string;
  marca: string;
  presentacion: string;
  cantidad: number;
  // null hasta que el punto destino confirma la recepcion.
  cantidad_recibida: number | null;
  novedad: string | null;
}

export interface Traslado {
  id: string;
  consecutivo: number;
  punto_origen_id: string;
  punto_destino_id: string;
  // Presentes en list/detail (join del backend) -- no en la respuesta de
  // POST /traslados-puntos (recien creado, todavia no hace falta el nombre).
  punto_origen_nombre?: string;
  punto_destino_nombre?: string;
  // Numero impreso en el talonario fisico (ver TrasladoPuntoCrear en el
  // backend) -- null en los traslados creados antes de este campo.
  numero_talonario?: string | null;
  transportador_nombre: string;
  fecha: string;
  observaciones: string | null;
  estado: EstadoTraslado;
  firma_despacha_url: string | null;
  firma_transporta_url: string | null;
  firma_recibe_url: string | null;
  creado_por: string;
  recibido_por: string | null;
  recibido_at: string | null;
  novedad: string | null;
  created_at: string;
  // Presente en list (conteo, sin traer todos los items); items completo
  // solo en detail/creacion/recepcion (ver GET /traslados-puntos/{id}).
  cantidad_items?: number;
  items?: ItemTraslado[];
  // Novedad de Supervision (ver app/services/traslados_puntos.py
  // resolver_novedad) -- null/undefined en un traslado sin novedad
  // (en_transito o recibido completo). novedad_estado es 'pendiente' apenas
  // se recibe con novedad, 'resuelta' una vez que Supervision carga la
  // solucion; solucion/solucionado_por/solucionado_por_nombre/solucionado_at
  // solo tienen valor una vez resuelta.
  novedad_estado?: EstadoNovedad | null;
  solucion?: string | null;
  solucionado_por?: string | null;
  // Join del backend (tabla supervisores) -- mismo criterio que
  // punto_origen_nombre/punto_destino_nombre.
  solucionado_por_nombre?: string | null;
  solucionado_at?: string | null;
  // Consecutivo bajo el que quedo archivada la solucion (ej. "NPT-1234", ver
  // resolver_novedad en el backend) -- solo tiene valor una vez resuelta,
  // mismo criterio que solucion/solucionado_por.
  consecutivo_solucion?: string | null;
}

export interface ItemTrasladoCrear {
  producto: string;
  marca: string;
  presentacion: string;
  cantidad: number;
}

/**
 * Crea el traslado -- lo llama FirmaTransportador despues de subir las 2
 * firmas (despacha/transporta, ver subirFirmaTraslado). `id` lo genera el
 * celular de antemano (ver TrasladoContext.tsx), porque el path de esas
 * firmas en Storage depende de el.
 */
export async function crearTrasladoPunto(payload: {
  id: string;
  numero_talonario: string;
  punto_origen_id: string;
  punto_destino_id: string;
  transportador_nombre: string;
  fecha: string;
  observaciones?: string;
  items: ItemTrasladoCrear[];
  firma_despacha_url: string;
  firma_transporta_url: string;
  creado_por: string;
}): Promise<Traslado> {
  const res = await fetch(`${API_BASE_URL}/traslados-puntos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parsearRespuesta<Traslado>(res);
}

/** Enviados (origenId) o bandeja por recibir (destinoId) -- ver
 * InicioTraslados/BandejaRecepcion. */
export async function fetchTrasladosPunto(filtro: {
  destinoId?: string;
  origenId?: string;
  estado?: EstadoTraslado;
}): Promise<Traslado[]> {
  const params = new URLSearchParams();
  if (filtro.destinoId) params.set('destino_id', filtro.destinoId);
  if (filtro.origenId) params.set('origen_id', filtro.origenId);
  if (filtro.estado) params.set('estado', filtro.estado);
  const res = await fetch(`${API_BASE_URL}/traslados-puntos?${params}`);
  return parsearRespuesta<Traslado[]>(res);
}

export async function fetchTrasladoPunto(id: string): Promise<Traslado> {
  const res = await fetch(`${API_BASE_URL}/traslados-puntos/${id}`);
  return parsearRespuesta<Traslado>(res);
}

export interface ItemRecepcionEnvio {
  id: string;
  cantidad_recibida: number;
  novedad?: string;
}

/**
 * Confirma la recepcion en el punto destino -- 409 si alguien mas ya lo
 * recibio primero (ver esErrorTrasladoYaRecibido en errorMessages.ts).
 */
export async function registrarRecepcion(
  trasladoId: string,
  payload: { items: ItemRecepcionEnvio[]; novedad?: string; firma_recibe_url: string; recibido_por: string }
): Promise<Traslado> {
  const res = await fetch(`${API_BASE_URL}/traslados-puntos/${trasladoId}/recepcion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parsearRespuesta<Traslado>(res);
}

/**
 * Sube una de las 3 firmas del traslado (despacha/transporta/recibe) al
 * mismo bucket que la evidencia de Despachos, en su propio subpath -- mismo
 * mecanismo que subirFirma, sin tocarla.
 */
export async function subirFirmaTraslado(
  trasladoId: string,
  rol: 'despacha' | 'transporta' | 'recibe',
  firmaDataUri: string
): Promise<{ url: string }> {
  const path = `firmas-traslados/${trasladoId}-${rol}.webp`;
  const { error } = await supabase.storage
    .from(EVIDENCIA_BUCKET)
    .upload(path, await firmaAWebp(firmaDataUri), { contentType: 'image/webp', upsert: true });

  if (error) {
    throw new Error(`No se pudo subir la firma: ${error.message}`);
  }

  const { data } = supabase.storage.from(EVIDENCIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// ---------------------------------------------------------------------------
// Supervision -- revisa y resuelve traslados recibidos con novedad (ver el
// plan "supervision-novedades"). Cuenta propia (tabla supervisores), no
// pertenece a un punto ni a una sede.

export interface Supervisor {
  id: string;
  nombre: string;
}

export async function fetchSupervisores(): Promise<Supervisor[]> {
  const res = await fetch(`${API_BASE_URL}/supervisores`);
  if (!res.ok) {
    throw new Error(`No se pudieron cargar los supervisores (${res.status})`);
  }
  return res.json();
}

/** Login sin correo/contrasena para supervisores -- mismo mecanismo que
 * loginPunto/loginConPin, contra POST /supervisores/auth/pin. */
export async function loginSupervisor(pin: string, supervisorId: string): Promise<Supervisor> {
  const res = await fetch(`${API_BASE_URL}/supervisores/auth/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, supervisor_id: supervisorId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? 'PIN incorrecto');
  }
  return res.json();
}

/** Bandeja de Supervision -- pendientes (el que lleva mas tiempo esperando,
 * primero) o resueltas (la mas reciente, primero); ver
 * GET /traslados-puntos/novedades en el backend. */
export async function fetchNovedadesTraslado(estado: EstadoNovedad): Promise<Traslado[]> {
  const params = new URLSearchParams({ estado });
  const res = await fetch(`${API_BASE_URL}/traslados-puntos/novedades?${params}`);
  return parsearRespuesta<Traslado[]>(res);
}

/**
 * Marca una novedad como resuelta -- 409 si alguien mas ya la resolvio
 * primero (ver esErrorNovedadYaResuelta en errorMessages.ts, mismo criterio
 * que esErrorTrasladoYaRecibido), o si el consecutivo elegido ya lo uso otra
 * novedad (ver esErrorConsecutivoDuplicado, distinto detail del 409 anterior).
 * `consecutivoCodigo` es el codigo del punto (ej. "NPT") y `consecutivoNumero`
 * el numero tal cual lo tipeo Erika -- el backend arma "NPT-1234".
 */
export async function resolverNovedadTraslado(
  trasladoId: string,
  supervisorId: string,
  solucion: string,
  consecutivoCodigo: string,
  consecutivoNumero: string
): Promise<Traslado> {
  const res = await fetch(`${API_BASE_URL}/traslados-puntos/${trasladoId}/solucion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supervisor_id: supervisorId,
      solucion,
      consecutivo_codigo: consecutivoCodigo,
      consecutivo_numero: consecutivoNumero,
    }),
  });
  return parsearRespuesta<Traslado>(res);
}

/**
 * Busqueda de Supervision por consecutivo (ej. "NPT-1234", ver
 * GET /traslados-puntos/buscar-consecutivo en el backend) -- solo entre
 * novedades ya resueltas, `q` vacio o solo espacios nunca se manda (el
 * backend igual devuelve [] en ese caso, esto evita el viaje de red).
 */
export async function buscarConsecutivoTraslado(q: string): Promise<Traslado[]> {
  const texto = q.trim();
  if (!texto) return [];
  const params = new URLSearchParams({ q: texto });
  const res = await fetch(`${API_BASE_URL}/traslados-puntos/buscar-consecutivo?${params}`);
  return parsearRespuesta<Traslado[]>(res);
}
