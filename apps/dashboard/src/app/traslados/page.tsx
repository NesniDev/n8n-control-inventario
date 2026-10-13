"use client";

// Panel de traslados entre puntos (ver apps/backend/app/services/traslados_puntos.py):
// tabla de traslados y hojas anuladas con su numero Syscafe (pendientes primero),
// filtros por punto/estado/fechas, detalle en modal al hacer clic en una fila y
// feed de "Actividad reciente". Mismo lenguaje visual que el Panel de bodega
// (app/page.tsx). admin/supervisor registran o corrigen el Syscafe en linea o
// desde el detalle; consulta lo ve en solo lectura.

import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  asignarSyscafeDashboard,
  fetchActividadTraslados,
  fetchPuntosPublicos,
  fetchTrasladoDetalle,
  listarTrasladosSyscafe,
  type ActividadTraslado,
  type FilaTrasladoSyscafe,
  type TrasladoDetalle,
} from "@/lib/api";
import {
  EncabezadoPagina,
  ErrorConReintento,
  EstadoVacio,
  Icono,
  Pildora,
  TarjetaConHeader,
  type TonoPildora,
} from "@/components/ui";
import { useSesion } from "@/lib/SesionProvider";
import { areaEfectiva } from "@/lib/sesion";

const ESTADOS: Record<string, { texto: string; tono: TonoPildora }> = {
  en_transito: { texto: "En tránsito", tono: "warn" },
  recibido: { texto: "Recibido", tono: "ok" },
  recibido_con_novedad: { texto: "Con novedad", tono: "error" },
  anulada: { texto: "Anulada", tono: "neutro" },
};

function referencia(fila: Pick<FilaTrasladoSyscafe, "tipo" | "numero_talonario" | "talonario_id" | "consecutivo">): string {
  if (fila.numero_talonario && (fila.tipo === "anulada" || fila.talonario_id)) return fila.numero_talonario;
  return `TP-${String(fila.consecutivo ?? 0).padStart(6, "0")}`;
}

// "2026-10-13" -> "13/10/2026" sin pasar por Date (evita el corrimiento de zona horaria).
function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso;
}

function fechaHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export default function TrasladosPage() {
  const { usuario, puedeEditar } = useSesion();
  // Supervisores de area "bodega" no pueden escribir Syscafe (el backend responde 403).
  const puedeAsignar = puedeEditar && ["todo", "traslados"].includes(areaEfectiva(usuario));
  const [puntoId, setPuntoId] = useState("");
  const [estado, setEstado] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const { data: puntos } = useSWR("puntos-publicos", fetchPuntosPublicos);
  const {
    data: filas,
    error,
    isLoading,
    mutate: recargar,
  } = useSWR(
    ["traslados-syscafe", puntoId, soloPendientes, fechaDesde, fechaHasta],
    () =>
      listarTrasladosSyscafe({
        puntoId: puntoId || undefined,
        pendientes: soloPendientes,
        desde: fechaDesde || undefined,
        hasta: fechaHasta || undefined,
      }),
    { refreshInterval: 5000 },
  );
  const {
    data: actividad,
    isLoading: actividadCargando,
    mutate: recargarActividad,
  } = useSWR("traslados-actividad", () => fetchActividadTraslados(50), { refreshInterval: 5000 });

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valorEditado, setValorEditado] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [anuladaDetalle, setAnuladaDetalle] = useState<FilaTrasladoSyscafe | null>(null);

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
      recargarActividad();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el número Syscafe");
    } finally {
      setGuardando(false);
    }
  };

  const abrirFila = (fila: FilaTrasladoSyscafe) => {
    if (fila.tipo === "anulada") setAnuladaDetalle(fila);
    else setDetalleId(fila.id);
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <EncabezadoPagina
        sobretitulo="Control logístico · traslados"
        titulo="Panel de traslados"
        descripcion="Cada traslado de talonario con su número en Syscafe (formato CÓDIGO-NÚMERO, por ejemplo NBR-945). Los pendientes aparecen primero; haz clic en una fila para ver el detalle."
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
        {/* Rango de fechas -- mismo patron que el Panel de bodega: desde/hasta
            con "Todo" para volver a no filtrar. */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-page px-2 py-1">
          <label className="flex flex-col items-start">
            <span className="text-[10px] leading-none text-muted">Desde</span>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              max={fechaHasta || undefined}
              className="rounded bg-transparent px-1 py-1 text-xs text-ink [color-scheme:dark]"
            />
          </label>
          <span className="px-1 text-xs text-subtle">–</span>
          <label className="flex flex-col items-start">
            <span className="text-[10px] leading-none text-muted">Hasta</span>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              min={fechaDesde || undefined}
              className="rounded bg-transparent px-1 py-1 text-xs text-ink [color-scheme:dark]"
            />
          </label>
          <button
            onClick={() => {
              setFechaDesde("");
              setFechaHasta("");
            }}
            aria-pressed={!fechaDesde && !fechaHasta}
            className={`ml-1 cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition ${
              !fechaDesde && !fechaHasta
                ? "bg-brand-gold text-brand-ink"
                : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            Todo
          </button>
        </div>
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
                    <tr
                      key={`${fila.tipo}:${fila.id}`}
                      tabIndex={0}
                      onClick={() => abrirFila(fila)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && e.key === "Enter") abrirFila(fila);
                      }}
                      className="cursor-pointer transition hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none"
                    >
                      <td className="px-2 py-2.5 text-ink">{fila.punto_origen_nombre ?? "—"}</td>
                      <td className="px-2 py-2.5 font-mono text-xs text-ink">{referencia(fila)}</td>
                      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
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
                            {puedeAsignar ? (
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

      <TarjetaConHeader
        titulo="Actividad reciente"
        subtitulo="Qué fue pasando con los traslados, en lenguaje simple."
        pildora={!actividadCargando ? `${actividad?.length ?? 0}` : undefined}
      >
        {!actividadCargando && (actividad?.length ?? 0) === 0 ? (
          <EstadoVacio titulo="Sin actividad registrada todavía." />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {(actividad ?? []).map((a: ActividadTraslado, i) => (
              <li
                key={`${a.tipo}:${a.momento}:${i}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm text-soft transition hover:bg-surface-2/60"
              >
                <span>{a.texto}</span>
                <span className="shrink-0 text-xs text-subtle">{fechaHora(a.momento)}</span>
              </li>
            ))}
          </ul>
        )}
      </TarjetaConHeader>

      {detalleId ? (
        <ModalDetalleTraslado
          id={detalleId}
          puedeAsignar={puedeAsignar}
          onCerrar={() => setDetalleId(null)}
          onCambio={() => {
            recargar();
            recargarActividad();
          }}
        />
      ) : null}

      {anuladaDetalle ? <ModalAnulada fila={anuladaDetalle} onCerrar={() => setAnuladaDetalle(null)} /> : null}
    </main>
  );
}

// Cascaron comun de los modales: fondo oscuro, cierre con Escape / clic afuera / X.
function ModalBase({
  titulo,
  pildora,
  ancho = "max-w-2xl",
  onCerrar,
  children,
}: {
  titulo: string;
  pildora?: ReactNode;
  ancho?: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const alPresionarTecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alPresionarTecla);
    return () => document.removeEventListener("keydown", alPresionarTecla);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`flex max-h-[85vh] w-full ${ancho} flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5`}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">{titulo}</h3>
            {pildora ? <div className="mt-1 flex items-center gap-2">{pildora}</div> : null}
          </div>
          <button onClick={onCerrar} className="cursor-pointer text-muted hover:text-ink" aria-label="Cerrar">
            <Icono nombre="cerrar" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{etiqueta}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

function ModalAnulada({ fila, onCerrar }: { fila: FilaTrasladoSyscafe; onCerrar: () => void }) {
  return (
    <ModalBase
      titulo={`Hoja ${referencia(fila)}`}
      ancho="max-w-md"
      onCerrar={onCerrar}
      pildora={<Pildora tono="neutro">Anulada</Pildora>}
    >
      <div className="grid grid-cols-2 gap-4">
        <Dato etiqueta="Punto">{fila.punto_origen_nombre ?? "—"}</Dato>
        <Dato etiqueta="Fecha">{fechaHora(fila.created_at)}</Dato>
        <Dato etiqueta="Anulada por">{fila.anulado_por_nombre ?? "—"}</Dato>
      </div>
      <Dato etiqueta="Motivo">{fila.motivo ?? "—"}</Dato>
    </ModalBase>
  );
}

function ModalDetalleTraslado({
  id,
  puedeAsignar,
  onCerrar,
  onCambio,
}: {
  id: string;
  puedeAsignar: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { data: t, error, mutate } = useSWR(["traslado-detalle", id], () => fetchTrasladoDetalle(id), {
    refreshInterval: 5000,
  });
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);

  const guardar = async (nuevo: string | null) => {
    setGuardando(true);
    try {
      await asignarSyscafeDashboard(id, nuevo);
      toast.success(nuevo ? "Número Syscafe guardado" : "Número Syscafe borrado");
      setEditando(false);
      await mutate();
      onCambio();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el número Syscafe");
    } finally {
      setGuardando(false);
    }
  };

  const info = t ? (ESTADOS[t.estado] ?? { texto: t.estado, tono: "neutro" as TonoPildora }) : null;

  return (
    <ModalBase
      titulo={t ? `Traslado ${referencia({ tipo: "traslado", ...t })}` : "Traslado"}
      onCerrar={onCerrar}
      pildora={info ? <Pildora tono={info.tono}>{info.texto}</Pildora> : undefined}
    >
      {error ? (
        <ErrorConReintento mensaje="No se pudo cargar el detalle del traslado." onReintentar={() => mutate()} />
      ) : !t ? (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Dato etiqueta="Origen → destino">
              {t.punto_origen_nombre ?? "—"} → {t.punto_destino_nombre ?? "—"}
            </Dato>
            <Dato etiqueta="Fecha">{fechaCorta(t.fecha)}</Dato>
            <Dato etiqueta="Transportador">{t.transportador_nombre || "—"}</Dato>
            <Dato etiqueta="Talonario">
              <span className="font-mono text-xs">{referencia({ tipo: "traslado", ...t })}</span>
            </Dato>
            <Dato etiqueta="Número Syscafe">
              {editando ? (
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={valor}
                    onChange={(e) => setValor(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") guardar(valor.trim() || null);
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditando(false);
                      }
                    }}
                    placeholder="NBR-945"
                    aria-label="Número Syscafe"
                    className="w-32 rounded-md border border-line-strong bg-page px-2 py-1 font-mono text-xs text-ink"
                  />
                  <button
                    onClick={() => guardar(valor.trim() || null)}
                    disabled={guardando}
                    className="cursor-pointer text-xs font-medium text-ink disabled:opacity-50"
                  >
                    {guardando ? "Guardando…" : "Guardar"}
                  </button>
                  <button
                    onClick={() => setEditando(false)}
                    className="cursor-pointer text-xs font-medium text-muted hover:text-ink"
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {t.numero_syscafe ? (
                    <span className="font-mono text-xs font-medium">{t.numero_syscafe}</span>
                  ) : (
                    <Pildora tono="warn">Pendiente</Pildora>
                  )}
                  {puedeAsignar ? (
                    <>
                      <button
                        onClick={() => {
                          setValor(t.numero_syscafe ?? "");
                          setEditando(true);
                        }}
                        className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink"
                      >
                        {t.numero_syscafe ? "Editar" : "Registrar"}
                      </button>
                      {t.numero_syscafe ? (
                        <button
                          onClick={() => guardar(null)}
                          disabled={guardando}
                          className="cursor-pointer text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
                        >
                          Borrar
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </span>
              )}
            </Dato>
            {t.numero_syscafe_at ? (
              <Dato etiqueta="Syscafe registrado">
                {t.numero_syscafe_por ?? "—"} · {fechaHora(t.numero_syscafe_at)}
              </Dato>
            ) : null}
            <Dato etiqueta="Creado por">
              {t.creado_por_nombre ?? "—"} · {fechaHora(t.created_at)}
            </Dato>
            <Dato etiqueta="Recibido por">
              {t.recibido_at ? `${t.recibido_por_nombre ?? "—"} · ${fechaHora(t.recibido_at)}` : "Aún sin recibir"}
            </Dato>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-soft">Productos</h4>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-2 py-1.5 font-medium">Producto</th>
                    <th className="px-2 py-1.5 font-medium">Marca</th>
                    <th className="px-2 py-1.5 font-medium">Present.</th>
                    <th className="px-2 py-1.5 text-right font-medium">Enviada</th>
                    <th className="px-2 py-1.5 text-right font-medium">Recibida</th>
                    <th className="px-2 py-1.5 font-medium">Vence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {t.items.map((it) => {
                    const diferente = it.cantidad_recibida !== null && it.cantidad_recibida !== it.cantidad;
                    return (
                      <tr key={it.id} className="align-top">
                        <td className="px-2 py-2 text-ink">
                          {it.producto}
                          {it.novedad ? <p className="text-xs text-danger-fg">Novedad: {it.novedad}</p> : null}
                        </td>
                        <td className="px-2 py-2 text-xs text-muted">{it.marca || "—"}</td>
                        <td className="px-2 py-2 text-xs text-muted">{it.presentacion || "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-ink">{it.cantidad}</td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${diferente ? "font-semibold text-danger-fg" : "text-ink"}`}
                        >
                          {it.cantidad_recibida ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-xs text-muted">
                          {it.fecha_vencimiento ? fechaCorta(it.fecha_vencimiento) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {t.observaciones ? <Dato etiqueta="Observaciones">{t.observaciones}</Dato> : null}
          <NovedadYSolucion t={t} />
          <Imagenes t={t} />
        </>
      )}
    </ModalBase>
  );
}

function NovedadYSolucion({ t }: { t: TrasladoDetalle }) {
  if (!t.novedad && !t.novedad_estado) return null;
  const resuelta = t.novedad_estado === "resuelta";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-page p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-soft">Novedad</h4>
        <Pildora tono={resuelta ? "ok" : "error"}>{resuelta ? "Resuelta" : "Pendiente"}</Pildora>
      </div>
      <p className="text-sm text-ink">{t.novedad ?? "Diferencia de cantidad en la recepción."}</p>
      {resuelta ? (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Solución{t.consecutivo_solucion ? ` · ${t.consecutivo_solucion}` : ""}
          </span>
          <p className="text-sm text-ink">{t.solucion ?? "—"}</p>
          <p className="text-xs text-muted">
            {t.solucionado_por_nombre ?? "Supervisión"} · {fechaHora(t.solucionado_at)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Foto del talonario y firmas: el backend guarda URLs publicas de Storage (las
// arma la app movil con getPublicUrl), asi que se muestran tal cual.
function Imagenes({ t }: { t: TrasladoDetalle }) {
  const imagenes = [
    { url: t.foto_talonario_url, etiqueta: "Talonario" },
    { url: t.firma_despacha_url, etiqueta: "Firma despacha" },
    { url: t.firma_transporta_url, etiqueta: "Firma transporta" },
    { url: t.firma_recibe_url, etiqueta: "Firma recibe" },
  ].filter((i): i is { url: string; etiqueta: string } => Boolean(i.url));
  if (imagenes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-soft">Fotos y firmas</h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {imagenes.map((img) => (
          <a
            key={img.etiqueta}
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-1 text-xs text-muted hover:text-ink"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- URLs publicas de Storage, igual que la evidencia de entregas */}
            <img
              src={img.url}
              alt={img.etiqueta}
              loading="lazy"
              className="h-24 w-full rounded-lg border border-line bg-white object-contain"
            />
            {img.etiqueta}
          </a>
        ))}
      </div>
    </div>
  );
}
