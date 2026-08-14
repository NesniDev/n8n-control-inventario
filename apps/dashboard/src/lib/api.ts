// Cliente hacia el backend (ver apps/backend). El dashboard hace polling
// cada pocos segundos en vez de Change Streams reales — ver README para el
// plan de reemplazo por WebSocket/SSE cuando haya un listener de Mongo.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface Entrega {
  id: string;
  numero_guia: string;
  remitente: string;
  destinatario: string;
  sede_origen_id: string;
  sede_origen_nombre: string | null;
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
  campos: { numero_guia?: string; remitente?: string; destinatario?: string }
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

// Descarga directa (no XHR) — el navegador la maneja como un archivo, no
// necesita CORS de fetch.
export const EXPORT_CSV_URL = `${API_BASE_URL}/entregas/export.csv`;
