"use client";

// Traslados entre puntos con su numero Syscafe (ver
// apps/backend/app/services/traslados_puntos.py): reemplaza el control a mano
// en el Excel del talonario. Lista traslados y hojas anuladas (etiquetadas
// "Anulada", sin campo Syscafe), pendientes primero. admin/supervisor registran
// o corrigen el numero en linea; consulta lo ve en solo lectura.

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  asignarSyscafeDashboard,
  fetchPuntosPublicos,
  listarTrasladosSyscafe,
  type FilaTrasladoSyscafe,
} from "@/lib/api";
import { EncabezadoPagina, ErrorConReintento, EstadoVacio, Pildora, type TonoPildora } from "@/components/ui";
import { useSesion } from "@/lib/SesionProvider";

const ESTADOS: Record<string, { texto: string; tono: TonoPildora }> = {
  en_transito: { texto: "En tránsito", tono: "warn" },
  recibido: { texto: "Recibido", tono: "ok" },
  recibido_con_novedad: { texto: "Con novedad", tono: "error" },
  anulada: { texto: "Anulada", tono: "neutro" },
};

function referencia(fila: FilaTrasladoSyscafe): string {
  if (fila.numero_talonario && (fila.tipo === "anulada" || fila.talonario_id)) return fila.numero_talonario;
  return `TP-${String(fila.consecutivo ?? 0).padStart(6, "0")}`;
}

// "2026-10-13" -> "13/10/2026" sin pasar por Date (evita el corrimiento de zona horaria).
function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso;
}

export default function TrasladosPage() {
  const { puedeEditar } = useSesion();
  const [puntoId, setPuntoId] = useState("");
  const [estado, setEstado] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);

  const { data: puntos } = useSWR("puntos-publicos", fetchPuntosPublicos);
  const {
    data: filas,
    error,
    isLoading,
    mutate: recargar,
  } = useSWR(
    ["traslados-syscafe", puntoId, soloPendientes],
    () => listarTrasladosSyscafe({ puntoId: puntoId || undefined, pendientes: soloPendientes }),
    { refreshInterval: 5000 },
  );

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valorEditado, setValorEditado] = useState("");
  const [guardando, setGuardando] = useState(false);

  const visibles = (filas ?? []).filter((f) => !estado || f.estado === estado);

  const empezarEdicion = (fila: FilaTrasladoSyscafe) => {
    setEditandoId(fila.id);
    setValorEditado(fila.numero_syscafe ?? "");
  };

  const guardar = async (fila: FilaTrasladoSyscafe, valor: string | null) => {
    setGuardando(true);
    try {
      await asignarSyscafeDashboard(fila.id, valor);
      toast.success(valor ? "Número Syscafe guardado" : "Número Syscafe borrado");
      setEditandoId(null);
      recargar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el número Syscafe");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <EncabezadoPagina
        sobretitulo="Control logístico · traslados"
        titulo="Traslados y número Syscafe"
        descripcion="Cada traslado de talonario con su número en Syscafe (formato CÓDIGO-NÚMERO, por ejemplo NBR-945). Los pendientes aparecen primero."
      />

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-muted">Punto de origen</span>
          <select
            value={puntoId}
            onChange={(e) => setPuntoId(e.target.value)}
            className="rounded-lg border border-line bg-page px-2 py-1.5 text-xs text-ink [color-scheme:dark]"
          >
            <option value="">Todos los puntos</option>
            {(puntos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-muted">Estado</span>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className="rounded-lg border border-line bg-page px-2 py-1.5 text-xs text-ink [color-scheme:dark]"
          >
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([valor, { texto }]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => setSoloPendientes(e.target.checked)}
            className="h-4 w-4 cursor-pointer"
          />
          Solo pendientes de Syscafe
        </label>
        <p className="ml-auto text-xs text-muted">
          {isLoading ? "Cargando…" : `${visibles.length} ${visibles.length === 1 ? "fila" : "filas"}`}
        </p>
      </section>

      {error ? (
        <ErrorConReintento mensaje="No se pudieron cargar los traslados." onReintentar={() => recargar()} />
      ) : null}

      <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:p-5">
        {isLoading ? (
          <ul className="flex flex-col gap-1" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-8 animate-pulse rounded bg-surface-2" />
            ))}
          </ul>
        ) : visibles.length === 0 ? (
          <EstadoVacio
            titulo={soloPendientes ? "No hay traslados pendientes de Syscafe." : "No hay traslados para mostrar."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2 font-medium">Punto</th>
                  <th className="px-2 py-2 font-medium">Talonario</th>
                  <th className="px-2 py-2 font-medium">Syscafe</th>
                  <th className="px-2 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 font-medium">Origen → destino</th>
                  <th className="px-2 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibles.map((fila) => {
                  const anulada = fila.tipo === "anulada";
                  const info = ESTADOS[fila.estado] ?? { texto: fila.estado, tono: "neutro" as TonoPildora };
                  return (
                    <tr key={`${fila.tipo}:${fila.id}`} className="transition hover:bg-surface-2/60">
                      <td className="px-2 py-2.5 text-ink">{fila.punto_origen_nombre ?? "—"}</td>
                      <td className="px-2 py-2.5 font-mono text-xs text-ink">{referencia(fila)}</td>
                      <td className="px-2 py-2.5">
                        {anulada ? (
                          <span className="text-xs text-muted" title={fila.motivo ?? undefined}>
                            {fila.motivo ? `Motivo: ${fila.motivo}` : "—"}
                          </span>
                        ) : editandoId === fila.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              autoFocus
                              value={valorEditado}
                              onChange={(e) => setValorEditado(e.target.value.toUpperCase())}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") guardar(fila, valorEditado.trim() || null);
                                if (e.key === "Escape") setEditandoId(null);
                              }}
                              placeholder="NBR-945"
                              aria-label="Número Syscafe"
                              className="w-32 rounded-md border border-line-strong bg-page px-2 py-1 font-mono text-xs text-ink"
                            />
                            <button
                              onClick={() => guardar(fila, valorEditado.trim() || null)}
                              disabled={guardando}
                              className="cursor-pointer text-xs font-medium text-ink hover:text-ink disabled:opacity-50"
                            >
                              {guardando ? "Guardando…" : "Guardar"}
                            </button>
                            <button
                              onClick={() => setEditandoId(null)}
                              className="cursor-pointer text-xs font-medium text-muted hover:text-ink"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {fila.numero_syscafe ? (
                              <span className="font-mono text-xs font-medium text-ink">{fila.numero_syscafe}</span>
                            ) : (
                              <Pildora tono="warn">Pendiente</Pildora>
                            )}
                            {puedeEditar ? (
                              <>
                                <button
                                  onClick={() => empezarEdicion(fila)}
                                  className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink"
                                >
                                  {fila.numero_syscafe ? "Editar" : "Registrar"}
                                </button>
                                {fila.numero_syscafe ? (
                                  <button
                                    onClick={() => guardar(fila, null)}
                                    disabled={guardando}
                                    className="cursor-pointer text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
                                  >
                                    Borrar
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-muted">{fechaCorta(fila.fecha)}</td>
                      <td className="px-2 py-2.5 text-xs text-ink">
                        {anulada ? "—" : `${fila.punto_origen_nombre ?? "—"} → ${fila.punto_destino_nombre ?? "—"}`}
                      </td>
                      <td className="px-2 py-2.5">
                        <Pildora tono={info.tono}>{info.texto}</Pildora>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
