// Cliente hacia el backend (ver apps/backend). Los datos se leen por HTTP,
// pero la revalidacion es instantanea via Supabase Realtime (ver
// lib/supabase.ts y app/page.tsx) — el polling de 5s de SWR queda como red
// de seguridad si el socket de Realtime se corta.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Tipos mas comunes -- sugerencia rapida (datalist), no una restriccion: en
// la practica el tipo real de un documento no siempre es uno de estos (ver
// apps/backend/app/models/entrega.py TipoDocumento). FEI/FV1 son de Sede
// Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en duplicates.py).
export type TipoDocumento = "FEI" | "FV1" | "EDP" | "EDV" | "TB9" | "RM3" | "RM2";

export interface ItemEntrega {
  id: string;
  descripcion: string;
  cantidad_entregada: number;
  cantidad_pendiente: number;
}

export interface Entrega {
  id: string;
  tipo: string;
  indicativo_numero: string;
  sede_origen_id: string;
  sede_origen_nombre: string | null;
  // Un documento puede traer varios productos -- cada uno con su propia
  // cantidad entregada/pendiente (ver apps/backend/app/models/entrega.py).
  items: ItemEntrega[];
  estado: "procesada" | "pendiente_revision" | "duplicado_bloqueado";
  operador_id: string;
  // Nombre del empleado dueño de operador_id (join en el backend, ver
  // _SELECT_ENTREGAS_BASE) -- quién facturó/capturó la foto original. Nunca
  // se pisa después (aplicar_actualizacion_items no toca operador_id), así
  // que sigue siendo válido aunque el bodeguero ya haya confirmado la
  // entrega. Null si operador_id no matchea ningún empleado (ej. el
  // "supervisor" fijo que manda revisarEntrega) — el fallback es el id crudo.
  operador_nombre: string | null;
  // Rol del empleado dueño de operador_id (mismo join que operador_nombre) --
  // distingue si quien creó/facturó el documento fue "punto_venta" o
  // "operador" (bodega), para etiquetar evidencia_creacion_url en la UI.
  operador_rol: string | null;
  // Quién de bodega confirmó cantidades reales por última vez (join en el
  // backend contra bodeguero_id, ver apps/backend/app/db.py) -- a diferencia
  // de operador_id (el creador, inmutable), ESTE sí se actualiza en cada
  // confirmación real, así que refleja quién está con la factura ahora. Null
  // hasta que alguien de bodega la toque (ej. punto_venta facturó y todavía
  // nadie confirmó) -- se muestra como "NE" en la UI.
  bodeguero_id: string | null;
  bodeguero_nombre: string | null;
  confianza_ia: Record<string, number>;
  evidencia_url: string;
  // Foto tal como quedó en la creación del documento -- nunca se pisa
  // después (ver evidencia_creacion_url en apps/backend/app/db.py), a
  // diferencia de evidencia_url (que sí se actualiza cuando bodega vuelve a
  // fotografiar al confirmar). Null en documentos creados antes de esta
  // columna, o cuando coincide con evidencia_url (nadie la reemplazó).
  evidencia_creacion_url: string | null;
  // Firma del cliente al confirmar la entrega desde el movil (paso 2) --
  // ausente cuando el guardado fue "Guardar nota" (sin cambio de
  // cantidades, no es un evento de entrega) o en entregas anteriores a esta
  // funcionalidad.
  firma_url?: string | null;
  // Foto del traslado (documento adicional que a veces se adjunta junto a
  // la evidencia principal) -- opcional, no todas las entregas lo traen.
  traslado_url?: string | null;
  // Tipo/numero del documento de traslado (distinto del tipo/indicativo_numero
  // del documento principal) -- solo presente cuando la entrega vino de un
  // caso "necesita_traslado" (ver _TIPO_SEDE_DUENA en duplicates.py).
  traslado_tipo: string | null;
  traslado_indicativo_numero: string | null;
  capturado_at: string;
  // Nota a nivel documento completo (distinta de ItemEntrega.nota, que es
  // por producto) -- la escribe el bodeguero en PantallaConfirmando. Llega
  // gratis por select e.* en el backend. Null si nunca se escribio.
  nota_general: string | null;
}

export interface Sede {
  id: string;
  nombre: string;
  codigo?: string;
}

// Rol completo del empleado (ver app/models/empleado.py RolEmpleado) -- el
// login del panel FAIA necesita distinguir 'faia_viewer'/'supervisor'/'admin'
// del resto para permitir o no el acceso (ver app/faia/page.tsx).
export type RolEmpleado = "operador" | "supervisor" | "admin" | "punto_venta" | "faia_viewer";

// Version liviana para el paso "elegir bodeguero" del login (ver GET
// /empleados) -- alcanza con lo que se muestra en la lista, no trae datos de
// PIN.
export interface EmpleadoBasico {
  id: string;
  nombre: string;
  rol: RolEmpleado;
}

// Empleado autenticado (respuesta de POST /auth/pin) -- ademas del id/nombre
// trae sede_id y el rol completo, usado para el gate de acceso a FAIA.
export interface Empleado {
  id: string;
  nombre: string;
  sede_id: string;
  rol: RolEmpleado;
}

export interface LogEvent {
  id: string;
  evento: string;
  entidad_tipo: string;
  entidad_id: string;
  actor_id: string;
  // Nombre resuelto del actor (join contra empleados en GET /logs) -- null
  // si actor_id no matchea ningun empleado real (ej. "system" del sync en
  // tiempo real, o "supervisor" de una correccion del dashboard).
  actor_nombre?: string | null;
  sede_id: string;
  resultado: string;
  // Varia segun `evento` -- ver app/services/logging_service.py. Para
  // 'entrega_actualizada' trae los items con su cantidad_entregada/
  // cantidad_pendiente EN ESE MOMENTO (asi se arma el historial de fechas
  // de un producto puntual, ver historialDeItem en page.tsx); para
  // 'devolucion_registrada' trae item_id/cantidad/motivo/resolucion.
  detalle: Record<string, unknown>;
  timestamp: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${path} respondio ${res.status}`);
  }
  return res.json();
}

// Ventana mas grande que antes (era 50/30) para que el resumen del dia y el
// feed de actividad -- calculados del lado del cliente filtrando por fecha --
// tengan un universo representativo y no se corten a mitad del dia en una
// sede activa. Sin argumentos mantiene ese comportamiento (limit 150, sin
// filtros); `sedeId`/`desde`/`hasta` habilitan el filtro por rango/sede de la
// tabla "Todas las entregas" (ver rangoAFechas en page.tsx) sin tocar esta
// llamada base.
export const fetchEntregas = (opciones?: {
  sedeId?: string;
  desde?: string;
  hasta?: string;
  busqueda?: string;
  limit?: number;
}) => {
  const params = new URLSearchParams();
  if (opciones?.sedeId) params.set("sede_id", opciones.sedeId);
  if (opciones?.desde) params.set("desde", opciones.desde);
  if (opciones?.hasta) params.set("hasta", opciones.hasta);
  if (opciones?.busqueda) params.set("busqueda", opciones.busqueda);
  params.set("limit", String(opciones?.limit ?? 150));
  return getJson<Entrega[]>(`/entregas?${params.toString()}`);
};
export const fetchLogs = () => getJson<LogEvent[]>("/logs?limit=150");

// Historial completo de una entrega (todos sus productos) -- el filtrado
// por producto se hace del lado del cliente, ver historialDeItem en page.tsx.
export const fetchHistorialEntrega = (entregaId: string) =>
  getJson<LogEvent[]>(`/logs?entidad_id=${encodeURIComponent(entregaId)}&limit=200`);

// Sedes activas -- se usan para el selector de "sede origen" al corregir una
// entrega en revision manual (ver revisarEntrega), y como paso 1 del login
// del panel FAIA (ver app/faia/page.tsx).
export const fetchSedes = () => getJson<Sede[]>("/sedes");

// Bodegueros/empleados activos de una sede -- paso 2 del login del panel
// FAIA (elegir quien esta usando el panel antes de pedir el PIN), mismo
// patron que apps/mobile/api.ts.
export const fetchEmpleados = (sedeId: string) =>
  getJson<EmpleadoBasico[]>(`/empleados?sede_id=${encodeURIComponent(sedeId)}`);

// Login por PIN (POST /auth/pin) -- el empleado ya se eligio en el paso
// anterior, aca el PIN solo confirma esa identidad puntual. Devuelve 401 con
// { detail: "PIN incorrecto" } si no matchea.
export async function loginConPin(pin: string, empleadoId: string): Promise<Empleado> {
  const res = await fetch(`${API_BASE_URL}/auth/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin, empleado_id: empleadoId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `No se pudo iniciar sesión (${res.status})`);
  }
  return res.json();
}

// Documento marcado FAIA (es_faia = true) -- solo identificacion/foto, sin
// cantidades ni items editables (ver GET /entregas/faia en el backend).
export interface EntregaFaia {
  id: string;
  tipo: string;
  indicativo_numero: string;
  sede_origen_id: string;
  sede_origen_nombre: string | null;
  // Quien facturo (join en el backend con empleados.operador_id) -- null si
  // no matchea ningun empleado.
  operador_nombre: string | null;
  evidencia_url: string;
  capturado_at: string;
}

// Rol-gateado server-side (403 si el empleado no es faia_viewer/supervisor/
// admin) -- el panel FAIA igual filtra antes de llamar, ver app/faia/page.tsx.
export async function fetchEntregasFaia(empleadoId: string): Promise<EntregaFaia[]> {
  const res = await fetch(`${API_BASE_URL}/entregas/faia?empleado_id=${encodeURIComponent(empleadoId)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `No se pudieron cargar los documentos FAIA (${res.status})`);
  }
  return res.json();
}

export async function revisarEntrega(
  id: string,
  campos: {
    tipo?: string;
    indicativo_numero?: string;
    sede_origen_id?: string;
    operador_id?: string;
    capturado_at?: string;
    traslado_tipo?: string;
    traslado_indicativo_numero?: string;
    // false = guarda las correcciones sin tocar el estado (para poder
    // corregir un dato sin aprobar todavia, o para una entrega con items
    // pendientes que ya esta "procesada" y no hay que forzar). Si se omite,
    // el backend asume true (comportamiento historico: guarda y aprueba).
    aprobar?: boolean;
  }
): Promise<Entrega> {
  const res = await fetch(`${API_BASE_URL}/entregas/${id}/revisar`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campos),
  });
  if (!res.ok) {
    throw new Error(`No se pudo guardar la entrega (${res.status})`);
  }
  return res.json();
}

// Correccion de items desde el dashboard: siempre valores absolutos (el
// supervisor corrige el dato, no "entrega hoy" como el movil) — ver
// PATCH /entregas/{id}/items en el backend.
export async function actualizarItems(
  entregaId: string,
  items: { id: string; descripcion: string; cantidad_entregada: number; cantidad_pendiente: number }[],
  revisadoPor: string,
  // Nota a nivel documento completo (distinta de la nota por item, que va
  // arriba en `items`). undefined deja el valor actual sin tocar; "" SI
  // borra la nota.
  notaGeneral?: string
): Promise<{ id: string; items: ItemEntrega[] }> {
  const res = await fetch(`${API_BASE_URL}/entregas/${entregaId}/items`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, operador_id: revisadoPor, sede_id: "dashboard", nota_general: notaGeneral }),
  });
  if (!res.ok) {
    throw new Error(`No se pudieron actualizar los items (${res.status})`);
  }
  return res.json();
}

// Borrado definitivo desde el dashboard (boton "Cancelar" de la cola de
// revision) -- protegido por el header X-Admin-Token en el backend, ver
// _verificar_token_admin en apps/backend/app/routers/entregas.py.
export async function eliminarEntrega(id: string, adminToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/entregas/${id}/definitivo`, {
    method: "DELETE",
    headers: { "X-Admin-Token": adminToken },
  });
  if (!res.ok) {
    throw new Error(`No se pudo eliminar la entrega (${res.status})`);
  }
}

// DELETE /entregas/{id} (sin token -- el backend no lo pide, lo usa tambien
// el mobile) -- distinto de eliminarEntrega/definitivo: borra una entrega
// que NO este en pendiente_revision, siempre que ningun item haya tenido
// todavia una entrega parcial (cantidad_pendiente === cantidad_entregada en
// todos, ver cancelar_entrega_no_confirmada en el backend). Idempotente: si
// no aplica, no rompe nada, solo devuelve cancelado:false.
export async function cancelarEntrega(id: string): Promise<{ cancelado: boolean }> {
  // operador_id/sede_id son opcionales en el backend (default "desconocido"),
  // pero se mandan explicitos para que el log de auditoria (actor_id) diga
  // "supervisor"/"dashboard" en vez de eso -- mismo criterio que actualizarItems.
  const res = await fetch(`${API_BASE_URL}/entregas/${id}?operador_id=supervisor&sede_id=dashboard`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`No se pudo cancelar el pedido (${res.status})`);
  }
  return res.json();
}

// "Zona de peligro" -- borra TODAS las entregas y logs. Misma proteccion de
// token que eliminarEntrega.
export async function eliminarTodasLasEntregas(
  adminToken: string
): Promise<{ entregas_borradas: number; logs_borrados: number }> {
  const res = await fetch(`${API_BASE_URL}/entregas/todas`, {
    method: "DELETE",
    headers: { "X-Admin-Token": adminToken },
  });
  if (!res.ok) {
    throw new Error(`No se pudo limpiar el sistema (${res.status})`);
  }
  return res.json();
}

// Descarga directa (no XHR) — el navegador la maneja como un archivo, no
// necesita CORS de fetch.
export const EXPORT_CSV_URL = `${API_BASE_URL}/entregas/export.csv`;

// Reporte mensual real en Excel (una hoja por mes, columnas por tipo de
// documento) -- para que los bodegueros le manden el control a un superior.
// A diferencia de EXPORT_CSV_URL, es a nivel de documento, no de producto.
export const EXPORT_XLSX_URL = `${API_BASE_URL}/entregas/export.xlsx`;

// Catalogo codigo -> nombre de producto (ver apps/backend/app/services/productos.py)
// -- se auto-completa al procesar/corregir facturas; esto es solo para
// consultarlo y para completar/corregir a mano lo que la extraccion
// automatica no pudo resolver.
export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  creado_at: string;
}

export const fetchProductos = (buscar?: string) =>
  getJson<Producto[]>(`/productos${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ""}`);

export async function crearProducto(datos: { codigo: string; nombre: string }): Promise<Producto> {
  const res = await fetch(`${API_BASE_URL}/productos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `No se pudo crear el producto (${res.status})`);
  }
  return res.json();
}

export async function actualizarProducto(id: string, nombre: string): Promise<Producto> {
  const res = await fetch(`${API_BASE_URL}/productos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `No se pudo actualizar el producto (${res.status})`);
  }
  return res.json();
}

// Ranking de productos mas/menos vendidos en un rango de fechas (ver GET
// /ranking/productos en el backend) -- se agrega en Python a partir de
// entrega_items, sin agregacion en SQL (ver apps/backend/app/services/ranking.py).
export interface RankingProductoItem {
  codigo: string | null;
  nombre: string;
  cantidad_total: number;
  entregas_count: number;
}

export interface RankingProductosResponse {
  desde: string;
  hasta: string;
  sede_id: string | null;
  mas_vendidos: RankingProductoItem[];
  menos_vendidos: RankingProductoItem[];
}

export const fetchRankingProductos = (opciones: {
  desde: string;
  hasta: string;
  sedeId?: string;
  limit?: number;
}) => {
  const params = new URLSearchParams({ desde: opciones.desde, hasta: opciones.hasta });
  if (opciones.sedeId) params.set("sede_id", opciones.sedeId);
  if (opciones.limit) params.set("limit", String(opciones.limit));
  return getJson<RankingProductosResponse>(`/ranking/productos?${params.toString()}`);
};
