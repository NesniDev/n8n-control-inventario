"use client";

import useSWR from "swr";
import { fetchEntregas, fetchLogs, type Entrega } from "@/lib/api";

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

const API_URL_HINT = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function DashboardPage() {
  // SWR dedupea llamadas concurrentes, reintenta ante error y revalida al
  // volver a la pestaña, ademas del polling — sin el useEffect/setInterval
  // manual que teniamos antes.
  const {
    data: entregas,
    error: entregasError,
    isLoading: entregasCargando,
  } = useSWR("entregas", fetchEntregas, { refreshInterval: 5000 });
  const { data: logs, isLoading: logsCargando } = useSWR("logs", fetchLogs, {
    refreshInterval: 5000,
  });

  const error = entregasError instanceof Error ? entregasError.message : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Control logístico · multi-sede
        </p>
        <h1 className="text-2xl font-semibold text-neutral-100">Panel de despachos</h1>
        <p className="text-sm text-neutral-400">
          Entregas y auditoría en tiempo (casi) real — actualiza cada 5 segundos.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudo conectar con el backend ({API_URL_HINT}): {error}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Entregas recientes
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Guía</th>
                <th className="px-4 py-2 font-medium">Sede origen</th>
                <th className="px-4 py-2 font-medium">Remitente → Destinatario</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Capturado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {!entregasCargando && entregas?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    Sin entregas todavía.
                  </td>
                </tr>
              ) : null}
              {entregas?.map((e) => (
                <tr key={e._id}>
                  <td className="px-4 py-2 font-mono text-neutral-300">{e.numero_guia || "—"}</td>
                  <td className="px-4 py-2 text-neutral-300">{e.sede_origen_id}</td>
                  <td className="px-4 py-2 text-neutral-300">
                    {e.remitente || "—"} → {e.destinatario || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_CLASS[e.estado]}`}>
                      {ESTADO_LABEL[e.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-neutral-500">
                    {e.timestamps?.capturado_at
                      ? new Date(e.timestamps.capturado_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
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
            <li key={log._id} className="flex items-center justify-between gap-3 text-neutral-400">
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
