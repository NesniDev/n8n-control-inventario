// Cliente hacia el backend (ver apps/backend). Los datos se leen por HTTP,
// pero la revalidacion es instantanea via Supabase Realtime (ver
// lib/supabase.ts y app/page.tsx) — el polling de 5s de SWR queda como red
// de seguridad si el socket de Realtime se corta.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type TipoDocumento = "FEI" | "TB" | "RM3" | "RM2";

export interface ItemEntrega {
  id: string;
  descripcion: string;
  cantidad_entregada: number;
  cantidad_pendiente: number;
}

export interface Entrega {
  id: string;
  tipo: TipoDocumento;
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
  timestamp: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${path} respondio ${res.status}`);
  }
  return res.json();
}

export const fetchEntregas = () => getJson<Entrega[]>("/entregas?limit=50");
export const fetchLogs = () => getJson<LogEvent[]>("/logs?limit=30");

export async function revisarEntrega(
  id: string,
  campos: { tipo?: TipoDocumento; indicativo_numero?: string }
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

// Descarga directa (no XHR) — el navegador la maneja como un archivo, no
// necesita CORS de fetch.
export const EXPORT_CSV_URL = `${API_BASE_URL}/entregas/export.csv`;
