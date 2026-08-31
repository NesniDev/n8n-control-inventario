"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  EXPORT_CSV_URL,
  EXPORT_XLSX_URL,
  actualizarItems,
  fetchEntregas,
  fetchHistorialEntrega,
  fetchLogs,
  revisarEntrega,
  type Entrega,
  type ItemEntrega,
  type LogEvent,
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

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// el backend); TB/RM3/RM2 no tienen sede dueña -- sugerencia rápida del
// datalist, no una restricción real (se puede escribir cualquier otro tipo).
const TIPOS_DOCUMENTO: TipoDocumento[] = ["FEI", "FV1", "EDP", "EDV", "TB", "RM3", "RM2"];

const API_URL_HINT = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function sumar(items: ItemEntrega[], campo: "cantidad_entregada" | "cantidad_pendiente") {
  return items.reduce((total, item) => total + item[campo], 0);
}

function esHoy(fechaIso: string | null | undefined): boolean {
  if (!fechaIso) return false;
  return new Date(fechaIso).toDateString() === new Date().toDateString();
}

function tienePendiente(entrega: Entrega): boolean {
  return entrega.items.some((item) => item.cantidad_pendiente > 0);
}

interface EventoHistorial {
  fecha: string;
  texto: string;
}

// Arma el historial de fechas de UN producto puntual a partir del historial
// completo de la entrega (logs con detalle.items trae la foto de TODOS los
// productos en cada evento -- aca se filtra solo el que corresponde). Asi se
// ve cada vez que cambio ese pendiente, aunque haya sido varias veces.
function historialDeItem(historial: LogEvent[], itemId: string): EventoHistorial[] {
  const ordenado = [...historial].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const eventos: EventoHistorial[] = [];
  for (const log of ordenado) {
    if (log.evento === "entrega_actualizada") {
      const items = log.detalle?.items as
        | { id: string; cantidad_entregada: number; cantidad_pendiente: number }[]
        | undefined;
      const encontrado = items?.find((i) => i.id === itemId);
      if (encontrado) {
        eventos.push({
          fecha: log.timestamp,
          texto: `Entregado ${encontrado.cantidad_entregada} · Pendiente ${encontrado.cantidad_pendiente}`,
        });
      }
    } else if (log.evento === "devolucion_registrada" && (log.detalle as { item_id?: string })?.item_id === itemId) {
      const detalle = log.detalle as { cantidad: number; motivo: string; resolucion: string };
      const resolucion = detalle.resolucion === "reposicion" ? "repuesto" : "reembolsado";
      eventos.push({
        fecha: log.timestamp,
        texto: `↩️ Devolución de ${detalle.cantidad} (${detalle.motivo}) — ${resolucion}`,
      });
    }
  }
  return eventos;
}

// Traduce un evento tecnico de `logs` a una frase que el dueño del negocio
// entiende sin conocer el pipeline interno. Los pasos puramente tecnicos de
// cada escaneo (foto_capturada, extraccion_ia, chequeo_duplicado,
// validacion, sync_tiempo_real, turnos_generados) son ruido para este feed
// -- devuelven null y quedan afuera (ver EventoLog en el backend para la
// lista completa de eventos que existen).
function describirEvento(log: LogEvent, entregasPorId: Map<string, Entrega>): string | null {
  const entrega = entregasPorId.get(log.entidad_id);
  const doc = entrega ? [entrega.tipo, entrega.indicativo_numero].filter(Boolean).join(" ") : null;
  const sede = entrega?.sede_origen_nombre ?? log.sede_id;

  switch (log.evento) {
    case "entrega_insertada":
      return `Nueva entrega registrada${doc ? ` — ${doc}` : ""} en ${sede}.`;
    case "entrega_actualizada": {
      const detalle = log.detalle as { items?: { cantidad_pendiente: number }[] } | undefined;
      const pendiente = detalle?.items?.reduce((total, i) => total + (i.cantidad_pendiente ?? 0), 0);
      return `Se confirmaron cantidades${doc ? ` de ${doc}` : ""}${
        pendiente !== undefined ? ` — quedan ${pendiente} pendientes` : ""
      }.`;
    }
    case "devolucion_registrada": {
      const detalle = log.detalle as { cantidad?: number; motivo?: string; resolucion?: string } | undefined;
      const resolucion = detalle?.resolucion === "reposicion" ? "se repone" : "se reembolsa el dinero";
      return `Devolución${doc ? ` en ${doc}` : ""} de ${detalle?.cantidad ?? "?"} unidades (${
        detalle?.motivo ?? "sin motivo"
      }) — ${resolucion}.`;
    }
    case "duplicado_bloqueado": {
      const detalle = log.detalle as { tipo?: string; indicativo_numero?: string } | undefined;
      return `Se bloqueó un reintento de "${detalle?.tipo ?? "?"} ${
        detalle?.indicativo_numero ?? ""
      }" — ese documento ya estaba completo.`;
    }
    case "revision_manual_aprobada":
      return `Un supervisor aprobó la revisión${doc ? ` de ${doc}` : ""}.`;
    case "entrega_cancelada":
      return `Se canceló una captura${doc ? ` de ${doc}` : ""} sin confirmar -- no quedó nada guardado.`;
    case "health_check_fallido":
      return "Aviso técnico: un chequeo de salud del sistema falló.";
    default:
      return null;
  }
}

type Tono = "neutral" | "bien" | "atencion" | "alerta";

const TONO_CLASE: Record<Tono, string> = {
  neutral: "border-neutral-800",
  bien: "border-emerald-500/30",
  atencion: "border-amber-500/30",
  alerta: "border-red-500/30",
};

const TONO_TEXTO: Record<Tono, string> = {
  neutral: "text-neutral-100",
  bien: "text-emerald-400",
  atencion: "text-amber-400",
  alerta: "text-red-400",
};

// Tarjeta de resumen -- una idea, un numero grande, sin que haga falta leer
// una tabla para entender como viene el dia.
function TarjetaResumen({
  titulo,
  valor,
  tono,
  detalle,
}: {
  titulo: string;
  valor: number | string;
  tono: Tono;
  detalle?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 rounded-lg border ${TONO_CLASE[tono]} bg-neutral-900/60 p-4`}>
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{titulo}</span>
      <span className={`text-2xl font-semibold ${TONO_TEXTO[tono]}`}>{valor}</span>
      {detalle ? <span className="text-xs text-neutral-500">{detalle}</span> : null}
    </div>
  );
}

function FilaRevision({
  entrega,
  onGuardado,
}: {
  entrega: Entrega;
  onGuardado: () => void;
}) {
  // string y no TipoDocumento: en la practica el tipo real no siempre es
  // uno de los conocidos -- son la sugerencia rapida del datalist, no un
  // limite (ver el <input list=...> mas abajo).
  const [tipo, setTipo] = useState(entrega.tipo);
  const [indicativoNumero, setIndicativoNumero] = useState(entrega.indicativo_numero);
  const [items, setItems] = useState<ItemEntrega[]>(entrega.items.map((i) => ({ ...i })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Historial de logs de esta entrega -- un solo fetch, compartido por todos
  // sus productos (ver historialDeItem para el filtrado por producto).
  const [historial, setHistorial] = useState<LogEvent[] | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState<string | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const alternarHistorial = async (itemId: string) => {
    const yaAbierto = historialAbierto === itemId;
    setHistorialAbierto(yaAbierto ? null : itemId);
    if (yaAbierto || historial !== null) return;
    setCargandoHistorial(true);
    try {
      setHistorial(await fetchHistorialEntrega(entrega.id));
    } catch {
      setHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  };

  const camposBajaConfianza = Object.entries(entrega.confianza_ia ?? {})
    .filter(([, valor]) => valor < 0.75)
    .map(([campo]) => campo);

  // Si no queda nada pendiente en ningun producto, no tiene sentido seguir
  // tocando tipo/indicativo — se bloquean. La cantidad pendiente de cada
  // item queda siempre editable, para poder deshacer un 0 puesto por error.
  const sinPendiente = items.length > 0 && items.every((item) => item.cantidad_pendiente === 0);

  const actualizarItem = (id: string, cambios: Partial<ItemEntrega>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...cambios } : item)));
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await revisarEntrega(entrega.id, { tipo, indicativo_numero: indicativoNumero });
      if (items.length > 0) {
        await actualizarItems(
          entrega.id,
          items.map((item) => ({
            id: item.id,
            descripcion: item.descripcion,
            cantidad_entregada: item.cantidad_entregada,
            cantidad_pendiente: item.cantidad_pendiente,
          })),
          "supervisor"
        );
      }
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
            {entrega.firma_url ? (
              <a
                href={entrega.firma_url}
                target="_blank"
                rel="noreferrer"
                className="text-orange-400 hover:underline"
              >
                Ver firma ↗
              </a>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Tipo
              <input
                value={tipo}
                onChange={(e) => setTipo(e.target.value.toUpperCase())}
                disabled={sinPendiente}
                list="tipos-documento-sugeridos"
                placeholder="FEI, EDP, TB u otro"
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
              />
              {/* Sugerencia rapida de los tipos conocidos -- el input igual
                  acepta cualquier otro valor, el datalist no restringe. */}
              <datalist id="tipos-documento-sugeridos">
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              N° de documento
              <input
                value={indicativoNumero}
                onChange={(e) => setIndicativoNumero(e.target.value)}
                disabled={sinPendiente}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Productos
            </span>
            {items.length === 0 ? (
              <p className="text-xs text-neutral-600">Sin productos registrados.</p>
            ) : (
              items.map((item) => {
                const eventosHistorial = historial ? historialDeItem(historial, item.id) : [];
                return (
                  <div key={item.id} className="rounded-md border border-neutral-800 p-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_140px]">
                      <label className="flex flex-col gap-1 text-xs text-neutral-500">
                        Descripción
                        <input
                          value={item.descripcion}
                          onChange={(e) => actualizarItem(item.id, { descripcion: e.target.value })}
                          disabled={sinPendiente}
                          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-neutral-500">
                        Entregado
                        <input
                          type="number"
                          value={item.cantidad_entregada}
                          onChange={(e) =>
                            actualizarItem(item.id, { cantidad_entregada: Number(e.target.value) })
                          }
                          disabled={sinPendiente}
                          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-neutral-500">
                        Pendiente
                        <input
                          type="number"
                          value={item.cantidad_pendiente}
                          onChange={(e) =>
                            actualizarItem(item.id, { cantidad_pendiente: Number(e.target.value) })
                          }
                          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                    </div>

                    <button
                      onClick={() => alternarHistorial(item.id)}
                      className="mt-2 text-xs text-orange-400 hover:underline"
                    >
                      🕒 {historialAbierto === item.id ? "Ocultar historial" : "Ver historial"}
                    </button>

                    {historialAbierto === item.id ? (
                      <div className="mt-2 flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-2 text-xs">
                        {cargandoHistorial ? (
                          <span className="text-neutral-500">Cargando...</span>
                        ) : eventosHistorial.length === 0 ? (
                          <span className="text-neutral-500">Sin cambios registrados todavía.</span>
                        ) : (
                          eventosHistorial.map((evento, i) => (
                            <div key={i} className="flex gap-2 text-neutral-400">
                              <span className="shrink-0 font-mono text-neutral-600">
                                {new Date(evento.fecha).toLocaleString()}
                              </span>
                              <span>{evento.texto}</span>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {sinPendiente ? (
            <p className="text-xs text-neutral-600">
              Sin pendiente en ningún producto — tipo e indicativo/número quedan bloqueados. Cambiá
              la pendiente de algún producto si fue un error.
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
  // activo como red de seguridad si el socket se corta). entrega_items
  // cambia aparte de entregas (ver PATCH /entregas/{id}/items), asi que
  // tambien hay que escucharla.
  useEffect(() => {
    const cliente = supabase;
    if (!cliente) return;

    const canal = cliente
      .channel("dashboard-entregas-logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "entregas" }, () => {
        recargarEntregas();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "entrega_items" }, () => {
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

  // --- Resumen del dia: todo esto se calcula de lo ya cargado, sin pedirle
  // nada nuevo al backend (ver el comentario de limit en lib/api.ts). ---
  const entregasPorId = useMemo(() => new Map((entregas ?? []).map((e) => [e.id, e])), [entregas]);
  const entregasHoy = useMemo(() => (entregas ?? []).filter((e) => esHoy(e.capturado_at)), [entregas]);
  const paraRevisar = useMemo(
    () => (entregas ?? []).filter((e) => e.estado === "pendiente_revision"),
    [entregas]
  );
  const conPendiente = useMemo(
    () => (entregas ?? []).filter((e) => tienePendiente(e) && e.estado !== "pendiente_revision"),
    [entregas]
  );
  const necesitanAtencion = useMemo(() => [...paraRevisar, ...conPendiente], [paraRevisar, conPendiente]);
  const devolucionesHoy = useMemo(
    () => (logs ?? []).filter((l) => l.evento === "devolucion_registrada" && esHoy(l.timestamp)),
    [logs]
  );
  const porSedeHoy = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const e of entregasHoy) {
      const nombre = e.sede_origen_nombre ?? e.sede_origen_id;
      mapa.set(nombre, (mapa.get(nombre) ?? 0) + 1);
    }
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }, [entregasHoy]);

  // Feed de actividad en lenguaje llano -- los eventos puramente tecnicos
  // (ver describirEvento) no aparecen aca.
  const actividad = useMemo(() => {
    return (logs ?? [])
      .map((log) => ({ log, texto: describirEvento(log, entregasPorId) }))
      .filter((x): x is { log: LogEvent; texto: string } => x.texto !== null)
      .slice(0, 25);
  }, [logs, entregasPorId]);

  const termino = busqueda.trim().toLowerCase();
  const entregasFiltradas = !termino
    ? entregas
    : entregas?.filter((e) =>
        [e.tipo, e.indicativo_numero, e.sede_origen_nombre, e.operador_id, ...e.items.map((i) => i.descripcion)]
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
          Así viene el negocio hoy, en las dos sedes — se actualiza solo, sin recargar la página.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudo conectar con el backend ({API_URL_HINT}): {error}
        </div>
      ) : null}

      {/* Resumen del dia -- lo primero que ve el dueño, sin leer una tabla. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Cómo va hoy</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TarjetaResumen
            titulo="Entregas hoy"
            valor={entregasHoy.length}
            tono="neutral"
            detalle={porSedeHoy.length > 0 ? porSedeHoy.map(([sede, n]) => `${sede}: ${n}`).join(" · ") : "Todavía sin movimiento"}
          />
          <TarjetaResumen
            titulo="Necesitan atención"
            valor={necesitanAtencion.length}
            tono={necesitanAtencion.length > 0 ? "atencion" : "bien"}
            detalle={necesitanAtencion.length > 0 ? "Revisión o entrega sin terminar" : "Todo al día"}
          />
          <TarjetaResumen
            titulo="Para revisar"
            valor={paraRevisar.length}
            tono={paraRevisar.length > 0 ? "atencion" : "bien"}
            detalle="La IA no estaba segura del todo"
          />
          <TarjetaResumen
            titulo="Devoluciones hoy"
            valor={devolucionesHoy.length}
            tono={devolucionesHoy.length > 0 ? "alerta" : "neutral"}
            detalle="Productos que volvieron"
          />
        </div>
      </section>

      {/* Lo que hay que mirar -- separado de "todas las entregas" para no
          tener que leer la tabla entera buscando que esta mal. */}
      {necesitanAtencion.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-amber-400">
            Necesita tu atención
          </h2>
          <div className="flex flex-col gap-2">
            {necesitanAtencion.map((e) => (
              <button
                key={e.id}
                onClick={() => setEnRevision(enRevision === e.id ? null : e.id)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left text-sm transition hover:bg-amber-500/10"
              >
                <span className="font-medium text-neutral-100">
                  {e.tipo} {e.indicativo_numero} · {e.sede_origen_nombre ?? e.sede_origen_id}
                </span>
                <span className="text-xs font-medium text-amber-400">
                  {e.estado === "pendiente_revision"
                    ? "La IA no está segura — revisar"
                    : `Faltan entregar ${sumar(e.items, "cantidad_pendiente")} unidades`}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              Todas las entregas
            </h2>
            <p className="text-xs text-neutral-600">Historial completo, ordenado por más reciente.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={EXPORT_XLSX_URL}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
            >
              📊 Reporte mensual (Excel)
            </a>
            <a
              href={EXPORT_CSV_URL}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
            >
              Descargar CSV (Excel)
            </a>
          </div>
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por tipo, número, sede, operador o producto..."
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">N° de documento</th>
                <th className="px-4 py-2 font-medium">Sede</th>
                <th className="px-4 py-2 font-medium">Productos</th>
                <th className="px-4 py-2 font-medium">Entregado</th>
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
              {entregasFiltradas?.map((e) => {
                const puedeActualizar = e.items.some((item) => item.cantidad_pendiente > 0);
                const puedeAbrir = e.estado === "pendiente_revision" || puedeActualizar;
                return (
                  <>
                    <tr
                      key={e.id}
                      className={puedeAbrir ? "cursor-pointer" : undefined}
                      onClick={() => (puedeAbrir ? setEnRevision(enRevision === e.id ? null : e.id) : undefined)}
                    >
                      <td className="px-4 py-2 font-mono text-neutral-300">{e.tipo || "—"}</td>
                      <td className="px-4 py-2 font-mono text-neutral-300">
                        {e.indicativo_numero || "—"}
                      </td>
                      <td className="px-4 py-2 text-neutral-300">
                        {e.sede_origen_nombre ?? e.sede_origen_id}
                      </td>
                      <td
                        className="max-w-[220px] truncate px-4 py-2 text-neutral-400"
                        title={e.items.map((i) => i.descripcion).join(", ")}
                      >
                        {e.items.length === 0
                          ? "—"
                          : `${e.items.length} producto${e.items.length === 1 ? "" : "s"}`}
                      </td>
                      <td className="px-4 py-2 text-neutral-300">{sumar(e.items, "cantidad_entregada")}</td>
                      <td className="px-4 py-2 text-neutral-300">{sumar(e.items, "cantidad_pendiente")}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_CLASS[e.estado]}`}
                        >
                          {ESTADO_LABEL[e.estado]}
                          {puedeAbrir ? " · revisar ↕" : ""}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Actividad reciente
          </h2>
          <p className="text-xs text-neutral-600">Qué fue pasando, en lenguaje simple.</p>
        </div>
        <ul className="flex flex-col divide-y divide-neutral-800 rounded-lg border border-neutral-800 p-1 text-sm">
          {!logsCargando && actividad.length === 0 ? (
            <li className="px-3 py-4 text-neutral-500">Sin actividad registrada todavía.</li>
          ) : null}
          {actividad.map(({ log, texto }) => (
            <li key={log.id} className="flex items-center justify-between gap-3 px-3 py-2 text-neutral-300">
              <span>{texto}</span>
              <span className="shrink-0 text-xs text-neutral-600">
                {new Date(log.timestamp).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
