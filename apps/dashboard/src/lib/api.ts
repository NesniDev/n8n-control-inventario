// Cliente hacia el backend (ver apps/backend). Los datos se leen por HTTP,
// pero la revalidacion es instantanea via Supabase Realtime (ver
// lib/supabase.ts y app/page.tsx) — el polling de 5s de SWR queda como red
// de seguridad si el socket de Realtime se corta.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Tipos mas comunes -- sugerencia rapida (datalist), no una restriccion: en
// la practica el tipo real de un documento no siempre es uno de estos (ver
// apps/backend/app/models/entrega.py TipoDocumento). FEI/FV1 son de Sede
// Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en duplicates.py).
export type TipoDocumento = "FEI" | "FV1" | "EDP" | "EDV" | "TB" | "RM3" | "RM2";

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
  confianza_ia: Record<string, number>;
  evidencia_url: string;
  // Firma del cliente al confirmar la entrega desde el movil (paso 2) --
  // ausente cuando el guardado fue "Guardar nota" (sin cambio de
  // cantidades, no es un evento de entrega) o en entregas anteriores a esta
  // funcionalidad.
  firma_url?: string | null;
  // Foto del traslado (documento adicional que a veces se adjunta junto a
  // la evidencia principal) -- opcional, no todas las entregas lo traen.
  traslado_url?: string | null;
  capturado_at: string;
}

export interface LogEvent {
  id: string;
  evento: string;
  entidad_tipo: string;
  entidad_id: string;
  actor_id: string;
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
// feed de actividad -- calculados del lado del cliente filtrando por fecha,
// no hay un filtro de rango de fechas en el backend todavia -- tengan un
// universo representativo y no se corten a mitad del dia en una sede activa.
export const fetchEntregas = () => getJson<Entrega[]>("/entregas?limit=150");
export const fetchLogs = () => getJson<LogEvent[]>("/logs?limit=150");

// Historial completo de una entrega (todos sus productos) -- el filtrado
// por producto se hace del lado del cliente, ver historialDeItem en page.tsx.
export const fetchHistorialEntrega = (entregaId: string) =>
  getJson<LogEvent[]>(`/logs?entidad_id=${encodeURIComponent(entregaId)}&limit=200`);

export async function revisarEntrega(
  id: string,
  campos: { tipo?: string; indicativo_numero?: string }
): Promise<Entrega> {
  const res = await fetch(`${API_BASE_URL}/entregas/${id}/revisar`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campos),
  });
  if (!res.ok) {
    throw new Error(`No se pudo aprobar la entrega (${res.status})`);
  }
  return res.json();
}

// Correccion de items desde el dashboard: siempre valores absolutos (el
// supervisor corrige el dato, no "entrega hoy" como el movil) — ver
// PATCH /entregas/{id}/items en el backend.
export async function actualizarItems(
  entregaId: string,
  items: { id: string; descripcion: string; cantidad_entregada: number; cantidad_pendiente: number }[],
  revisadoPor: string
): Promise<{ id: string; items: ItemEntrega[] }> {
  const res = await fetch(`${API_BASE_URL}/entregas/${entregaId}/items`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, operador_id: revisadoPor, sede_id: "dashboard" }),
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
