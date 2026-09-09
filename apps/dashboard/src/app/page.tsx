"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  EXPORT_CSV_URL,
  EXPORT_XLSX_URL,
  actualizarItems,
  eliminarEntrega,
  eliminarTodasLasEntregas,
  fetchEntregas,
  fetchHistorialEntrega,
  fetchLogs,
  fetchSedes,
  revisarEntrega,
  type Entrega,
  type ItemEntrega,
  type LogEvent,
  type Sede,
  type TipoDocumento,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";

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

type Rango = "hoy" | "semana" | "mes" | "todo";

// Ventanas MOVILES (ultimos N dias corridos), no semana/mes calendario --
// mismo criterio que ya usa esHoy con toDateString(). No hay que igualar la
// semana ISO que usa generar_turnos.py: es un concepto distinto, sin relacion
// con este filtro de la tabla "Todas las entregas".
function rangoAFechas(rango: Rango): { desde?: string; hasta?: string } {
  const ahora = new Date();
  if (rango === "hoy") {
    const medianocheLocal = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    return { desde: medianocheLocal.toISOString() };
  }
  if (rango === "semana") {
    return { desde: new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() };
  }
  if (rango === "mes") {
    return { desde: new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() };
  }
  return {};
}

// Etiqueta/color que se muestra al usuario -- no es 1:1 con el estado real
// en la DB: "procesada" se separa visualmente en "Procesada" (nada
// pendiente) y "Pendiente" (sin terminar), para que se entienda de un
// vistazo si falta algo sin tener que abrir la fila.
function estadoVisual(entrega: Entrega): { etiqueta: string; clase: string } {
  if (entrega.estado === "pendiente_revision") {
    return { etiqueta: "Pendiente de revisión", clase: "bg-amber-500/15 text-amber-400" };
  }
  if (entrega.estado === "duplicado_bloqueado") {
    return { etiqueta: "Duplicado bloqueado", clase: "bg-red-500/15 text-red-400" };
  }
  if (tienePendiente(entrega)) {
    return { etiqueta: "Pendiente", clase: "bg-amber-500/15 text-amber-400" };
  }
  return { etiqueta: "Procesada", clase: "bg-emerald-500/15 text-emerald-400" };
}

// Convierte un ISO del backend al formato que espera <input type="datetime-local">
// ("YYYY-MM-DDTHH:mm"), en la hora LOCAL del navegador (no UTC) -- Date ya
// hace esa conversion al leer los campos con get* en vez de getUTC*.
function isoADatetimeLocal(fechaIso: string | null | undefined): string {
  if (!fechaIso) return "";
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(
    fecha.getHours()
  )}:${pad(fecha.getMinutes())}`;
}

// Camino inverso: el valor de datetime-local no trae timezone -- new Date()
// lo interpreta en la hora local del navegador, que es lo que queremos.
function datetimeLocalAIso(valor: string): string | undefined {
  if (!valor) return undefined;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return undefined;
  return fecha.toISOString();
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
  onClick,
}: {
  titulo: string;
  valor: number | string;
  tono: Tono;
  detalle?: string;
  // Cuando viene, la tarjeta funciona como filtro rapido (ver filtroEstado
  // en DashboardPage) -- ademas del buscador de texto libre.
  onClick?: () => void;
}) {
  const Contenedor = onClick ? "button" : "div";
  return (
    <Contenedor
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-lg border text-left ${TONO_CLASE[tono]} bg-neutral-900/60 p-4 ${
        onClick ? "cursor-pointer transition hover:bg-neutral-900" : ""
      }`}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{titulo}</span>
      <span className={`text-2xl font-semibold ${TONO_TEXTO[tono]}`}>{valor}</span>
      {detalle ? <span className="text-xs text-neutral-500">{detalle}</span> : null}
    </Contenedor>
  );
}

// Modal de confirmacion generico -- mismo patron visual que ModalConfirmarLimpieza
// (overlay fijo + tarjeta centrada), para acciones destructivas puntuales que
// no ameritan el flujo de palabra exacta de la limpieza total.
function ModalConfirmar({
  titulo,
  mensaje,
  textoConfirmar = "Confirmar",
  onConfirmar,
  onCerrar,
}: {
  titulo: string;
  mensaje: string;
  textoConfirmar?: string;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onCerrar}>
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-neutral-100">{titulo}</h3>
        <p className="text-sm text-neutral-400">{mensaje}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCerrar}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilaRevision({
  entrega,
  adminToken,
  sedes,
  onGuardado,
}: {
  entrega: Entrega;
  adminToken: string;
  // Para el selector de sede origen -- solo se usa cuando la entrega esta
  // pendiente_revision (ver el bloque de campos ampliados mas abajo).
  sedes: Sede[] | undefined;
  onGuardado: () => void;
}) {
  // string y no TipoDocumento: en la practica el tipo real no siempre es
  // uno de los conocidos -- son la sugerencia rapida del datalist, no un
  // limite (ver el <input list=...> mas abajo).
  const [tipo, setTipo] = useState(entrega.tipo);
  const [indicativoNumero, setIndicativoNumero] = useState(entrega.indicativo_numero);
  const [items, setItems] = useState<ItemEntrega[]>(entrega.items.map((i) => ({ ...i })));
  // Campos de cabecera ampliados -- solo editables cuando la entrega esta
  // pendiente_revision (ver el bloque condicional en el JSX). Se excluyen
  // deliberadamente evidencia/firma/traslado_url por pedido explicito.
  const [sedeOrigenId, setSedeOrigenId] = useState(entrega.sede_origen_id);
  const [operadorId, setOperadorId] = useState(entrega.operador_id);
  const [capturadoAt, setCapturadoAt] = useState(() => isoADatetimeLocal(entrega.capturado_at));
  const [trasladoTipo, setTrasladoTipo] = useState(entrega.traslado_tipo ?? "");
  const [trasladoIndicativoNumero, setTrasladoIndicativoNumero] = useState(
    entrega.traslado_indicativo_numero ?? ""
  );
  const [guardando, setGuardando] = useState(false);
  // Controla el modal de confirmacion del borrado definitivo (ver
  // eliminarDefinitivamente mas abajo) -- reemplaza el window.confirm previo.
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
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
    try {
      // sede_origen_id/operador_id/capturado_at/traslado_* solo tienen
      // sentido corregirlos en pendiente_revision (ver bloque condicional
      // del JSX) -- para el resto de las entregas (conPendiente) se manda
      // solo lo de siempre.
      const camposRevision: Parameters<typeof revisarEntrega>[1] = {
        tipo,
        indicativo_numero: indicativoNumero,
      };
      if (entrega.estado === "pendiente_revision") {
        camposRevision.sede_origen_id = sedeOrigenId || undefined;
        camposRevision.operador_id = operadorId || undefined;
        camposRevision.capturado_at = datetimeLocalAIso(capturadoAt);
        camposRevision.traslado_tipo = trasladoTipo || undefined;
        camposRevision.traslado_indicativo_numero = trasladoIndicativoNumero || undefined;
      }
      await revisarEntrega(entrega.id, camposRevision);
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
      toast.success("Entrega guardada");
      onGuardado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  // Borrado definitivo -- solo tiene sentido para pendiente_revision (el
  // backend rechaza cualquier otro estado con 409); el boton de abajo ya se
  // renderiza solo bajo esa condicion. Se llama desde ModalConfirmar una vez
  // que el usuario confirma ahi (ver el JSX mas abajo).
  const eliminarDefinitivamente = async () => {
    setConfirmandoBorrado(false);
    setGuardando(true);
    try {
      await eliminarEntrega(entrega.id, adminToken);
      toast.success("Entrega eliminada");
      onGuardado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
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
            {entrega.traslado_url ? (
              <a
                href={entrega.traslado_url}
                target="_blank"
                rel="noreferrer"
                className="text-orange-400 hover:underline"
              >
                Ver traslado ↗
              </a>
            ) : null}
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
                list="tipos-documento-sugeridos"
                placeholder="FEI, EDP, TB u otro"
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
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
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
          </div>

          {entrega.estado === "pendiente_revision" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Sede origen
                <select
                  value={sedeOrigenId}
                  onChange={(e) => setSedeOrigenId(e.target.value)}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                >
                  <option value={sedeOrigenId}>{entrega.sede_origen_nombre ?? sedeOrigenId}</option>
                  {(sedes ?? [])
                    .filter((s) => s.id !== sedeOrigenId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Operador
                <input
                  value={operadorId}
                  onChange={(e) => setOperadorId(e.target.value)}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Fecha/hora de captura
                <input
                  type="datetime-local"
                  value={capturadoAt}
                  onChange={(e) => setCapturadoAt(e.target.value)}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-neutral-500">
                  Traslado tipo
                  <input
                    value={trasladoTipo}
                    onChange={(e) => setTrasladoTipo(e.target.value.toUpperCase())}
                    placeholder="Opcional"
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-neutral-500">
                  Traslado N°
                  <input
                    value={trasladoIndicativoNumero}
                    onChange={(e) => setTrasladoIndicativoNumero(e.target.value)}
                    placeholder="Opcional"
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                  />
                </label>
              </div>
            </div>
          ) : null}

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
          <div className="flex gap-2">
            <button
              onClick={guardar}
              disabled={guardando}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {guardando ? "Guardando..." : "Guardar y aprobar"}
            </button>
            {entrega.estado === "pendiente_revision" ? (
              <button
                onClick={() => setConfirmandoBorrado(true)}
                disabled={guardando || !adminToken}
                title={!adminToken ? "Cargá el token de administrador arriba" : undefined}
                className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </div>
        {confirmandoBorrado ? (
          <ModalConfirmar
            titulo="Eliminar entrega"
            mensaje="¿Eliminar por completo esta entrega? Esta acción no se puede deshacer."
            textoConfirmar="Eliminar"
            onConfirmar={eliminarDefinitivamente}
            onCerrar={() => setConfirmandoBorrado(false)}
          />
        ) : null}
      </td>
    </tr>
  );
}

// Detalle visual de solo lectura para una entrega ya `procesada` sin nada
// pendiente -- a diferencia de FilaRevision no se puede editar nada, es para
// entender de un vistazo que paso con el documento (fotos como miniatura en
// vez de links de texto, historial como linea de tiempo colapsable).
function ModalDetalleEntrega({
  entrega,
  onCerrar,
}: {
  entrega: Entrega;
  onCerrar: () => void;
}) {
  // historial === null es el estado "cargando" -- evita un setState
  // sincronico al entrar al efecto (regla react-hooks/set-state-in-effect).
  const [historial, setHistorial] = useState<LogEvent[] | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const cargandoHistorial = historial === null;

  useEffect(() => {
    let cancelado = false;
    fetchHistorialEntrega(entrega.id)
      .then((data) => {
        if (!cancelado) setHistorial(data);
      })
      .catch(() => {
        if (!cancelado) setHistorial([]);
      });
    return () => {
      cancelado = true;
    };
  }, [entrega.id]);

  // Cerrar con Escape ademas del click en el fondo/la X.
  useEffect(() => {
    const alPresionarTecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alPresionarTecla);
    return () => document.removeEventListener("keydown", alPresionarTecla);
  }, [onCerrar]);

  // describirEvento espera un mapa de entregas por id -- aca alcanza con la
  // propia entrega del modal, ya que el historial es siempre de ella.
  const entregasPorId = useMemo(() => new Map([[entrega.id, entrega]]), [entrega]);
  const eventosHistorial = (historial ?? [])
    .map((log) => ({ log, texto: describirEvento(log, entregasPorId) }))
    .filter((x): x is { log: LogEvent; texto: string } => x.texto !== null);

  // Fotos disponibles como miniatura -- solo las que la entrega realmente
  // trae (traslado y firma son opcionales).
  const fotos = [
    { url: entrega.evidencia_url, etiqueta: "Foto" },
    entrega.traslado_url ? { url: entrega.traslado_url, etiqueta: "Traslado" } : null,
    entrega.firma_url ? { url: entrega.firma_url, etiqueta: "Firma" } : null,
  ].filter((f): f is { url: string; etiqueta: string } => f !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-neutral-100">
              {entrega.tipo} {entrega.indicativo_numero}
            </h3>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${estadoVisual(entrega).clase}`}
            >
              {estadoVisual(entrega).etiqueta}
            </span>
          </div>
          <button onClick={onCerrar} className="text-neutral-500 hover:text-neutral-300" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* Datos clave en tarjetas, no en una lista de texto -- de un vistazo
            se entiende quien/donde/cuando sin tener que leer renglon por
            renglon. */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
            <span className="block text-xs text-neutral-500">Sede</span>
            <span className="text-neutral-200">{entrega.sede_origen_nombre ?? entrega.sede_origen_id}</span>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
            <span className="block text-xs text-neutral-500">Operador</span>
            <span className="text-neutral-200">{entrega.operador_id}</span>
          </div>
          <div className="col-span-2 rounded-md border border-neutral-800 bg-neutral-950 p-2">
            <span className="block text-xs text-neutral-500">Capturado</span>
            <span className="text-neutral-200">
              {entrega.capturado_at ? new Date(entrega.capturado_at).toLocaleString() : "—"}
            </span>
          </div>
        </div>

        {/* Miniaturas en vez de links de texto -- se entiende de un vistazo
            que evidencia hay sin tener que abrir cada una. */}
        {fotos.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Evidencia</span>
            <div className="grid grid-cols-3 gap-2">
              {fotos.map((foto) => (
                <a
                  key={foto.url}
                  href={foto.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col gap-1"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- fotos
                      vienen de Supabase Storage, no del dominio de Next. */}
                  <img
                    src={foto.url}
                    alt={foto.etiqueta}
                    className="h-24 w-full rounded-md border border-neutral-800 object-cover transition group-hover:border-orange-400/60"
                  />
                  <span className="text-center text-xs text-neutral-500 group-hover:text-orange-400">
                    {foto.etiqueta} ↗
                  </span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Productos</span>
          {entrega.items.length === 0 ? (
            <p className="text-xs text-neutral-600">Sin productos registrados.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-800 rounded-md border border-neutral-800">
              {entrega.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-neutral-300">{item.descripcion}</span>
                  <span className="flex shrink-0 items-center gap-1 text-emerald-400">
                    ✓ {item.cantidad_entregada}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Historial colapsado por defecto -- interactivo, no obliga a leerlo
            si solo se vino a ver las fotos. Linea de tiempo con puntos en vez
            de filas planas de texto. */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setHistorialAbierto((v) => !v)}
            className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
          >
            <span>Historial {historial ? `(${eventosHistorial.length})` : ""}</span>
            <span>{historialAbierto ? "▲" : "▼"}</span>
          </button>
          {historialAbierto ? (
            <div className="flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
              {cargandoHistorial ? (
                <span className="text-neutral-500">Cargando...</span>
              ) : eventosHistorial.length === 0 ? (
                <span className="text-neutral-500">Sin cambios registrados todavía.</span>
              ) : (
                eventosHistorial.map(({ log, texto }, i) => (
                  <div key={log.id} className="flex gap-2">
                    <div className="flex flex-col items-center">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-orange-400" />
                      {i < eventosHistorial.length - 1 ? (
                        <span className="w-px flex-1 bg-neutral-800" />
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-0.5 pb-2">
                      <span className="font-mono text-neutral-600">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <span className="text-neutral-300">{texto}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const ADMIN_TOKEN_STORAGE_KEY = "despachos_admin_token";
const PALABRA_CONFIRMACION_LIMPIEZA = "ELIMINAR TODO";

// "Zona de peligro" -- borra TODAS las entregas y logs. Mismo patron visual
// que los otros modales (overlay fijo + tarjeta centrada), pero exige
// escribir una palabra exacta para habilitar el boton de confirmar.
function ModalConfirmarLimpieza({
  onConfirmar,
  onCerrar,
}: {
  onConfirmar: () => Promise<void>;
  onCerrar: () => void;
}) {
  const [palabra, setPalabra] = useState("");
  const [limpiando, setLimpiando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const habilitado = palabra.trim() === PALABRA_CONFIRMACION_LIMPIEZA;

  const confirmar = async () => {
    setLimpiando(true);
    setError(null);
    try {
      await onConfirmar();
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : "Error al limpiar";
      // El error se mantiene visible DENTRO del modal (para que no se pierda
      // mientras sigue abierto) y ademas se dispara un toast, en linea con
      // el resto del feedback de esta pantalla.
      setError(mensaje);
      toast.error(mensaje);
      setLimpiando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onCerrar}>
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-red-500/40 bg-neutral-900 p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-red-400">Eliminar TODOS los productos</h3>
        <p className="text-sm text-neutral-400">
          Esto borra permanentemente todas las entregas, sus productos y todo el historial de logs. No
          se puede deshacer.
        </p>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Escribí &quot;{PALABRA_CONFIRMACION_LIMPIEZA}&quot; para confirmar
          <input
            value={palabra}
            onChange={(e) => setPalabra(e.target.value)}
            disabled={limpiando}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
          />
        </label>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCerrar}
            disabled={limpiando}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!habilitado || limpiando}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {limpiando ? "Eliminando..." : "Eliminar todo"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  // SWR dedupea llamadas concurrentes, reintenta ante error y revalida al
  // volver a la pestaña, ademas del polling — sin el useEffect/setInterval
  // manual que teniamos antes.
  const {
    data: entregas,
    error: entregasError,
    mutate: recargarEntregas,
  } = useSWR("entregas", fetchEntregas, { refreshInterval: 5000 });
  const {
    data: logs,
    isLoading: logsCargando,
    mutate: recargarLogs,
  } = useSWR("logs", fetchLogs, { refreshInterval: 5000 });
  // Para el selector de sede origen en la edicion ampliada de FilaRevision --
  // no cambia seguido, no hace falta refreshInterval.
  const { data: sedes } = useSWR("sedes", fetchSedes);

  // Filtro por rango de fechas y por sede de la seccion "Todas las entregas"
  // -- fuente de datos SEPARADA de `entregas` (el hook base) para que "Cómo
  // va hoy" y "Necesita tu atención" queden siempre fijos en hoy/todas las
  // sedes, sin importar lo que se elija aca.
  const [rango, setRango] = useState<Rango>("todo");
  const [sedeFiltro, setSedeFiltro] = useState<string>("todas");
  const [limiteTabla, setLimiteTabla] = useState(150);

  // Reset del limite al cambiar cualquiera de los dos filtros -- se hace en
  // los propios manejadores (cambiarRango/cambiarSedeFiltro) y no en un
  // useEffect, para no disparar un setState sincronico dentro de un efecto
  // (react-hooks/set-state-in-effect).
  const cambiarRango = (nuevoRango: Rango) => {
    setRango(nuevoRango);
    setLimiteTabla(150);
  };
  const cambiarSedeFiltro = (nuevaSede: string) => {
    setSedeFiltro(nuevaSede);
    setLimiteTabla(150);
  };

  const { data: entregasTabla, isLoading: entregasTablaCargando } = useSWR(
    ["entregas-tabla", rango, sedeFiltro, limiteTabla],
    () =>
      fetchEntregas({
        sedeId: sedeFiltro === "todas" ? undefined : sedeFiltro,
        ...rangoAFechas(rango),
        limit: limiteTabla,
      }),
    { refreshInterval: 5000 }
  );

  const [enRevision, setEnRevision] = useState<string | null>(null);
  // Filtro por categoria, aparte del buscador de texto libre (ver
  // entregasFiltradas mas abajo y las tarjetas/botones que lo setean).
  const [filtroEstado, setFiltroEstado] = useState<"todas" | "revision" | "pendiente" | "procesada">(
    "todas"
  );
  // Entrega mostrada en el detalle visual de solo lectura (ver
  // ModalDetalleEntrega mas abajo) -- solo se abre para entregas ya
  // `procesada` sin nada pendiente, donde no tiene sentido el flujo
  // editable de FilaRevision.
  const [entregaDetalle, setEntregaDetalle] = useState<Entrega | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [enVivo, setEnVivo] = useState(false);

  // Token de administrador para los endpoints de borrado (ver
  // _verificar_token_admin en el backend) -- persistido en localStorage para
  // no tener que pegarlo de nuevo en cada visita.
  const [adminToken, setAdminToken] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
    } catch {
      // localStorage puede fallar (modo privado, storage lleno) -- no es
      // critico, el token simplemente no persiste entre visitas.
    }
  }, [adminToken]);

  const [limpiezaModalAbierta, setLimpiezaModalAbierta] = useState(false);
  const [limpiezaResultado, setLimpiezaResultado] = useState<{
    entregas_borradas: number;
    logs_borrados: number;
  } | null>(null);

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

  // Filtro por categoria (ver filtroEstado) -- se combina con AND junto al
  // buscador de texto libre, aplicado despues. Fuente: entregasTabla (hook
  // separado del resumen, ver mas arriba), no `entregas`.
  const entregasPorEstado = useMemo(() => {
    if (filtroEstado === "todas") return entregasTabla;
    if (filtroEstado === "revision") return entregasTabla?.filter((e) => e.estado === "pendiente_revision");
    if (filtroEstado === "pendiente") {
      return entregasTabla?.filter((e) => tienePendiente(e) && e.estado !== "pendiente_revision");
    }
    return entregasTabla?.filter((e) => e.estado === "procesada" && !tienePendiente(e));
  }, [entregasTabla, filtroEstado]);

  const termino = busqueda.trim().toLowerCase();
  const entregasFiltradas = !termino
    ? entregasPorEstado
    : entregasPorEstado?.filter((e) =>
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

      {/* Habilita "Cancelar" en la cola de revision y la zona de peligro de
          abajo -- ver _verificar_token_admin en el backend. */}
      <label className="flex max-w-xs flex-col gap-1 text-xs text-neutral-500">
        Token de administrador
        <input
          type="password"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
          placeholder="Requerido para borrar entregas"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
        />
      </label>

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
            titulo="Para revisión"
            valor={paraRevisar.length}
            tono={paraRevisar.length > 0 ? "atencion" : "bien"}
            detalle="La IA no estaba segura del todo"
            onClick={() => setFiltroEstado("revision")}
          />
          <TarjetaResumen
            titulo="Sin terminar"
            valor={conPendiente.length}
            tono={conPendiente.length > 0 ? "atencion" : "bien"}
            detalle="Entregas con algo pendiente"
            onClick={() => setFiltroEstado("pendiente")}
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
          tener que leer la tabla entera buscando que esta mal. Dos subgrupos
          separados (en vez de la mezcla anterior) para distinguir revision
          de la IA vs. entregas sin terminar. */}
      {paraRevisar.length > 0 || conPendiente.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-amber-400">
            Necesita tu atención
          </h2>
          {paraRevisar.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                En revisión
              </h3>
              {paraRevisar.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEnRevision(enRevision === e.id ? null : e.id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left text-sm transition hover:bg-amber-500/10"
                >
                  <span className="font-medium text-neutral-100">
                    {e.tipo} {e.indicativo_numero} · {e.sede_origen_nombre ?? e.sede_origen_id}
                  </span>
                  <span className="text-xs font-medium text-amber-400">La IA no está segura — revisar</span>
                </button>
              ))}
            </div>
          ) : null}
          {conPendiente.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Sin terminar
              </h3>
              {conPendiente.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEnRevision(enRevision === e.id ? null : e.id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left text-sm transition hover:bg-amber-500/10"
                >
                  <span className="font-medium text-neutral-100">
                    {e.tipo} {e.indicativo_numero} · {e.sede_origen_nombre ?? e.sede_origen_id}
                  </span>
                  <span className="text-xs font-medium text-amber-400">
                    Faltan entregar {sumar(e.items, "cantidad_pendiente")} unidades
                  </span>
                </button>
              ))}
            </div>
          ) : null}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por tipo, número, sede, operador o producto..."
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 sm:flex-1"
          />
          {/* Filtro por categoria, aparte del buscador -- se combina con AND
              (ver entregasPorEstado/entregasFiltradas). */}
          <div className="flex flex-wrap gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-1">
            {(
              [
                { valor: "todas", etiqueta: "Todas" },
                { valor: "revision", etiqueta: "En revisión" },
                { valor: "pendiente", etiqueta: "Sin terminar" },
                { valor: "procesada", etiqueta: "Procesadas" },
              ] as const
            ).map((opcion) => (
              <button
                key={opcion.valor}
                onClick={() => setFiltroEstado(opcion.valor)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  filtroEstado === opcion.valor
                    ? "bg-emerald-600 text-white"
                    : "text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>
          {/* Filtro por rango de fechas -- ventana movil, no calendario (ver
              rangoAFechas). Se combina con AND junto al resto de filtros de
              esta tabla. */}
          <div className="flex flex-wrap gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-1">
            {(
              [
                { valor: "hoy", etiqueta: "Hoy" },
                { valor: "semana", etiqueta: "7 días" },
                { valor: "mes", etiqueta: "30 días" },
                { valor: "todo", etiqueta: "Todo" },
              ] as const
            ).map((opcion) => (
              <button
                key={opcion.valor}
                onClick={() => cambiarRango(opcion.valor)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  rango === opcion.valor
                    ? "bg-emerald-600 text-white"
                    : "text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>
          {/* Filtro por sede -- opt-in, no oculta que existen las demas
              (default "todas"). */}
          <select
            value={sedeFiltro}
            onChange={(e) => cambiarSedeFiltro(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300"
          >
            <option value="todas">Todas las sedes</option>
            {(sedes ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
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
              {!entregasTablaCargando && entregasTabla?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-neutral-500">
                    Sin entregas todavía.
                  </td>
                </tr>
              ) : null}
              {!entregasTablaCargando && termino && entregasFiltradas?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-neutral-500">
                    Sin resultados para &quot;{busqueda}&quot;.
                  </td>
                </tr>
              ) : null}
              {entregasFiltradas?.map((e) => {
                // Una entrega totalmente procesada (sin nada pendiente) ya no
                // se corrige a mano de rutina -- abre el detalle visual de
                // solo lectura en vez del flujo editable de FilaRevision.
                const puedeEditar = e.estado === "pendiente_revision" || tienePendiente(e);
                return (
                  <>
                    <tr
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() =>
                        puedeEditar
                          ? setEnRevision(enRevision === e.id ? null : e.id)
                          : setEntregaDetalle(e)
                      }
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
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${estadoVisual(e).clase}`}
                        >
                          {estadoVisual(e).etiqueta}
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
                        {e.traslado_url ? (
                          <a
                            href={e.traslado_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            className="ml-2 text-orange-400 hover:underline"
                          >
                            Ver traslado ↗
                          </a>
                        ) : null}
                      </td>
                    </tr>
                    {enRevision === e.id ? (
                      <FilaRevision
                        key={`${e.id}-revision`}
                        entrega={e}
                        adminToken={adminToken}
                        sedes={sedes}
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
        {entregasTabla?.length === limiteTabla ? (
          <button
            onClick={() => setLimiteTabla((l) => l + 150)}
            className="self-center rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
          >
            Cargar más
          </button>
        ) : null}
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

      <section className="flex flex-col gap-3 rounded-lg border border-red-500/30 p-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-red-400">Zona de peligro</h2>
          <p className="text-xs text-neutral-500">
            Borra permanentemente todas las entregas, productos y logs del sistema. Pensado para
            resetear datos de prueba -- no toca las fotos ya subidas a Storage.
          </p>
        </div>
        <div>
          <button
            onClick={() => setLimpiezaModalAbierta(true)}
            disabled={!adminToken}
            title={!adminToken ? "Cargá el token de administrador arriba" : undefined}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          >
            Eliminar TODOS los productos
          </button>
        </div>
        {limpiezaResultado ? (
          <p className="text-xs text-neutral-500">
            Última limpieza: {limpiezaResultado.entregas_borradas} entregas y{" "}
            {limpiezaResultado.logs_borrados} logs borrados.
          </p>
        ) : null}
      </section>

      {entregaDetalle ? (
        <ModalDetalleEntrega entrega={entregaDetalle} onCerrar={() => setEntregaDetalle(null)} />
      ) : null}

      {limpiezaModalAbierta ? (
        <ModalConfirmarLimpieza
          onCerrar={() => setLimpiezaModalAbierta(false)}
          onConfirmar={async () => {
            const resultado = await eliminarTodasLasEntregas(adminToken);
            setLimpiezaResultado(resultado);
            setLimpiezaModalAbierta(false);
            toast.success(
              `Se eliminaron ${resultado.entregas_borradas} entregas y ${resultado.logs_borrados} logs`
            );
            recargarEntregas();
            recargarLogs();
          }}
        />
      ) : null}
    </main>
  );
}
