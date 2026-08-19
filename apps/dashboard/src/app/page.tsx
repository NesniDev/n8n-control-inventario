"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  EXPORT_CSV_URL,
  fetchEntregas,
  fetchLogs,
  revisarEntrega,
  type Entrega,
  type TipoDocumento,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";

const ESTADO_LABEL: Record<Entrega["estado"], string> = {
  procesada: "Procesada",
  pendiente_revision: "Pendiente de revisión",
  duplicado_bloqueado: "Duplicado bloqueado",
};

const ESTADO_CLASS: Record<Entrega["estado"], string> = {
  procesada: "bg-emerald-500/15 text-emerald-400",
  pendiente_revision: "bg-amber-500/15 text-amber-400",
  duplicado_bloqueado: "bg-red-500/15 text-red-400",
};

// Factura (FEI), traslado entre bodegas (TB) o remision (RM3/RM2) — ver
// app.models.entrega.TipoDocumento en el backend.
const TIPOS_DOCUMENTO: TipoDocumento[] = ["FEI", "TB", "RM3", "RM2"];

const API_URL_HINT = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function FilaRevision({
  entrega,
  onGuardado,
}: {
  entrega: Entrega;
  onGuardado: () => void;
}) {
  const [tipo, setTipo] = useState<TipoDocumento>(entrega.tipo);
  const [indicativoNumero, setIndicativoNumero] = useState(entrega.indicativo_numero);
  const [cantidadEntregada, setCantidadEntregada] = useState(entrega.cantidad_entregada);
  const [cantidadPendiente, setCantidadPendiente] = useState(entrega.cantidad_pendiente);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const camposBajaConfianza = Object.entries(entrega.confianza_ia ?? {})
    .filter(([, valor]) => valor < 0.75)
    .map(([campo]) => campo);

  // Si no queda nada pendiente, no tiene sentido seguir tocando tipo/
  // indicativo/cantidad entregada — se bloquean. Pendiente en si queda
  // siempre editable, para poder deshacer un 0 puesto por error.
  const sinPendiente = cantidadPendiente === 0;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await revisarEntrega(entrega.id, {
        tipo,
        indicativo_numero: indicativoNumero,
        cantidad_entregada: cantidadEntregada,
        cantidad_pendiente: cantidadPendiente,
      });
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <tr className="bg-amber-500/5">
      <td colSpan={9} className="px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span>Revisar antes de aprobar — campos con baja confianza de la IA:</span>
            {camposBajaConfianza.length > 0 ? (
              <span className="font-mono text-amber-400">{camposBajaConfianza.join(", ")}</span>
            ) : (
              <span className="text-neutral-600">(ninguno — revisar por las dudas)</span>
            )}
            <a
              href={entrega.evidencia_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-orange-400 hover:underline"
            >
              Ver foto original ↗
            </a>
          </div>
          {entrega.detalle ? (
            <p className="text-xs text-neutral-500">
              Detalle (referencia de la IA, no editable): <span className="text-neutral-300">{entrega.detalle}</span>
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Tipo
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoDocumento)}
                disabled={sinPendiente}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
              >
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Indicativo/número
              <input
                value={indicativoNumero}
                onChange={(e) => setIndicativoNumero(e.target.value)}
                disabled={sinPendiente}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Cantidad (CANT)
              <input
                type="number"
                value={cantidadEntregada}
                onChange={(e) => setCantidadEntregada(Number(e.target.value))}
                disabled={sinPendiente}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Cantidad pendiente
              <input
                type="number"
                value={cantidadPendiente}
                onChange={(e) => setCantidadPendiente(Number(e.target.value))}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
          </div>
          {sinPendiente ? (
            <p className="text-xs text-neutral-600">
              Sin pendiente — tipo, indicativo/número y cantidad quedan bloqueados. Cambiá &quot;Cantidad
              pendiente&quot; si fue un error.
            </p>
          ) : null}
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
          <div>
            <button
              onClick={guardar}
              disabled={guardando}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {guardando ? "Guardando..." : "Guardar y aprobar"}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function DashboardPage() {
  // SWR dedupea llamadas concurrentes, reintenta ante error y revalida al
  // volver a la pestaña, ademas del polling — sin el useEffect/setInterval
  // manual que teniamos antes.
  const {
    data: entregas,
    error: entregasError,
    isLoading: entregasCargando,
    mutate: recargarEntregas,
  } = useSWR("entregas", fetchEntregas, { refreshInterval: 5000 });
  const {
    data: logs,
    isLoading: logsCargando,
    mutate: recargarLogs,
  } = useSWR("logs", fetchLogs, { refreshInterval: 5000 });

  const [enRevision, setEnRevision] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [enVivo, setEnVivo] = useState(false);

  // Realtime de Supabase: cuando entra/cambia una fila, revalidamos al
  // instante en vez de esperar el proximo tick de polling (que sigue
  // activo como red de seguridad si el socket se corta).
  useEffect(() => {
    const cliente = supabase;
    if (!cliente) return;

    const canal = cliente
      .channel("dashboard-entregas-logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "entregas" }, () => {
        recargarEntregas();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "logs" }, () => {
        recargarLogs();
      })
      .subscribe((status) => setEnVivo(status === "SUBSCRIBED"));

    return () => {
      cliente.removeChannel(canal);
    };
  }, [recargarEntregas, recargarLogs]);

  const error = entregasError instanceof Error ? entregasError.message : null;

  const termino = busqueda.trim().toLowerCase();
  const entregasFiltradas = !termino
    ? entregas
    : entregas?.filter((e) =>
        [e.tipo, e.indicativo_numero, e.sede_origen_nombre, e.operador_id]
          .filter(Boolean)
          .some((campo) => campo!.toLowerCase().includes(termino))
      );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Control logístico · multi-sede
          </p>
          <span
            className={`flex items-center gap-1.5 text-xs font-medium ${
              enVivo ? "text-emerald-400" : "text-neutral-600"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${enVivo ? "bg-emerald-400" : "bg-neutral-600"}`}
            />
            {enVivo ? "En vivo" : "Conectando..."}
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-neutral-100">Panel de despachos</h1>
        <p className="text-sm text-neutral-400">
          Entregas y auditoría en tiempo real — se actualiza al instante ante cualquier cambio.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudo conectar con el backend ({API_URL_HINT}): {error}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Entregas recientes
          </h2>
          <a
            href={EXPORT_CSV_URL}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
          >
            Descargar CSV (Excel)
          </a>
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por tipo, indicativo/número, sede u operador..."
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Indicativo/número</th>
                <th className="px-4 py-2 font-medium">Sede origen</th>
                <th className="px-4 py-2 font-medium">Detalle</th>
                <th className="px-4 py-2 font-medium">Cantidad (CANT)</th>
                <th className="px-4 py-2 font-medium">Pendiente</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Capturado</th>
                <th className="px-4 py-2 font-medium">Foto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {!entregasCargando && entregas?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-neutral-500">
                    Sin entregas todavía.
                  </td>
                </tr>
              ) : null}
              {!entregasCargando && termino && entregasFiltradas?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-neutral-500">
                    Sin resultados para &quot;{busqueda}&quot;.
                  </td>
                </tr>
              ) : null}
              {entregasFiltradas?.map((e) => (
                <>
                  <tr
                    key={e.id}
                    className={e.estado === "pendiente_revision" ? "cursor-pointer" : undefined}
                    onClick={() =>
                      e.estado === "pendiente_revision"
                        ? setEnRevision(enRevision === e.id ? null : e.id)
                        : undefined
                    }
                  >
                    <td className="px-4 py-2 font-mono text-neutral-300">{e.tipo || "—"}</td>
                    <td className="px-4 py-2 font-mono text-neutral-300">
                      {e.indicativo_numero || "—"}
                    </td>
                    <td className="px-4 py-2 text-neutral-300">
                      {e.sede_origen_nombre ?? e.sede_origen_id}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2 text-neutral-400" title={e.detalle}>
                      {e.detalle || "—"}
                    </td>
                    <td className="px-4 py-2 text-neutral-300">{e.cantidad_entregada}</td>
                    <td className="px-4 py-2 text-neutral-300">{e.cantidad_pendiente}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_CLASS[e.estado]}`}
                      >
                        {ESTADO_LABEL[e.estado]}
                        {e.estado === "pendiente_revision" ? " · revisar ↕" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-500">
                      {e.capturado_at ? new Date(e.capturado_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <a
                        href={e.evidencia_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-orange-400 hover:underline"
                      >
                        Ver foto ↗
                      </a>
                    </td>
                  </tr>
                  {enRevision === e.id ? (
                    <FilaRevision
                      key={`${e.id}-revision`}
                      entrega={e}
                      onGuardado={() => {
                        setEnRevision(null);
                        recargarEntregas();
                      }}
                    />
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Auditoría reciente
        </h2>
        <ul className="flex flex-col gap-1 rounded-lg border border-neutral-800 p-3 text-sm">
          {!logsCargando && logs?.length === 0 ? (
            <li className="text-neutral-500">Sin eventos registrados todavía.</li>
          ) : null}
          {logs?.map((log) => (
            <li key={log.id} className="flex items-center justify-between gap-3 text-neutral-400">
              <span className="font-mono text-neutral-300">{log.evento}</span>
              <span className="truncate text-neutral-500">
                {log.sede_id} · {log.actor_id} · {log.resultado}
              </span>
              <span className="shrink-0 text-neutral-600">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
