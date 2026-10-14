// Utilidades y constantes compartidas entre el panel de traslados y sus
// modales (estados con su tono, referencia del talonario y formato de fechas).

import type { FilaTrasladoSyscafe } from "@/lib/api";
import type { TonoPildora } from "@/components/ui";

export const ESTADOS: Record<string, { texto: string; tono: TonoPildora }> = {
  en_transito: { texto: "En tránsito", tono: "warn" },
  recibido: { texto: "Recibido", tono: "ok" },
  recibido_con_novedad: { texto: "Con novedad", tono: "error" },
  anulada: { texto: "Anulada", tono: "neutro" },
};

export function referencia(
  fila: Pick<FilaTrasladoSyscafe, "tipo" | "numero_talonario" | "talonario_id" | "consecutivo">,
): string {
  if (fila.numero_talonario && (fila.tipo === "anulada" || fila.talonario_id)) return fila.numero_talonario;
  return `TP-${String(fila.consecutivo ?? 0).padStart(6, "0")}`;
}

// "2026-10-13" -> "13/10/2026" sin pasar por Date (evita el corrimiento de zona horaria).
export function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso;
}

export function fechaHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}
