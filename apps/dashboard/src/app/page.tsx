"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import { toast } from "sonner";
import {
  descargarExport,
  type FormatoExport,
  TIPOS_REMISION,
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
import { useSesion } from "@/lib/SesionProvider";
import { Boton, EncabezadoPagina, EstadoVacio, Icono, Pildora, TarjetaConHeader, type TonoPildora } from "@/components/ui";

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// el backend); TB9/RM3/RM2/RSF no tienen sede dueña -- sugerencia rápida del
// datalist, no una restricción real (se puede escribir cualquier otro tipo).
const TIPOS_DOCUMENTO: TipoDocumento[] = ["FEI", "FV1", "EDP", "EDV", "TB9", "RM3", "RM2", "RSF"];

const API_URL_HINT = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Cuantas entregas se muestran por grupo en "Necesita tu atención" antes de
// pedir "Ver todas" -- con hasta 150 entregas cargadas, mostrar todo de una
// es una pared de botones inmanejable.
const LIMITE_ATENCION = 5;

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

// "Sede " es solo una convencion humana al nombrar una sede (ver comentario
// en apps/backend/app/services/duplicates.py sobre sedes.codigo vs nombre),
// no una regla del sistema -- se saca el prefijo solo para mostrar, nunca se
// toca el dato real en la base.
function nombreSedeCorto(nombre: string | null): string | null {
  if (!nombre) return nombre;
  return nombre.replace(/^Sede\s+/i, "");
}

// Convierte el rango de calendario (inputs <input type="date">, formato
// "YYYY-MM-DD" o "" si no se eligio) a los ISO que espera fetchEntregas.
// "hasta" se lleva al final de ese dia (23:59:59.999 local) porque el
// backend filtra con capturado_at <= hasta -- sin esto se perderian las
// entregas capturadas despues de medianoche del dia elegido.
function fechasCalendarioAISO(desde: string, hasta: string): { desde?: string; hasta?: string } {
  const resultado: { desde?: string; hasta?: string } = {};
  if (desde) {
    const [anio, mes, dia] = desde.split("-").map(Number);
    resultado.desde = new Date(anio, mes - 1, dia).toISOString();
  }
  if (hasta) {
    const [anio, mes, dia] = hasta.split("-").map(Number);
    resultado.hasta = new Date(anio, mes - 1, dia, 23, 59, 59, 999).toISOString();
  }
  return resultado;
}

// Etiqueta/color que se muestra al usuario -- no es 1:1 con el estado real
// en la DB: "procesada" se separa visualmente en "Procesada" (nada
// pendiente) y "Pendiente" (sin terminar), para que se entienda de un
// vistazo si falta algo sin tener que abrir la fila.
function estadoVisual(entrega: Entrega): { etiqueta: string; tono: TonoPildora } {
  if (entrega.estado === "pendiente_revision") {
    return { etiqueta: "Pendiente de revisión", tono: "warn" };
  }
  if (entrega.estado === "duplicado_bloqueado") {
    return { etiqueta: "Duplicado bloqueado", tono: "error" };
  }
  if (tienePendiente(entrega)) {
    return { etiqueta: "Pendiente", tono: "warn" };
  }
  return { etiqueta: "Procesada", tono: "ok" };
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
        // retirado_por es del documento completo, no por item -- se agrega
        // al texto de todos los items confirmados en esa misma visita (ver
        // RetiradoPor en el backend, solo presente si esa visita se firmo).
        const retiradoPor = log.detalle?.retirado_por as { nombre: string; telefono: string } | null | undefined;
        const sufijoRetira = retiradoPor ? ` · Retirado por ${retiradoPor.nombre} (${retiradoPor.telefono})` : "";
        eventos.push({
          fecha: log.timestamp,
          texto: `Entregado ${encontrado.cantidad_entregada} · Pendiente ${encontrado.cantidad_pendiente}${sufijoRetira}`,
        });
      }
    } else if (log.evento === "devolucion_registrada" && (log.detalle as { item_id?: string })?.item_id === itemId) {
      const detalle = log.detalle as { cantidad: number; motivo: string; resolucion: string };
      const resolucion = detalle.resolucion === "reposicion" ? "repuesto" : "reembolsado";
      eventos.push({
        fecha: log.timestamp,
        texto: `Devolución de ${detalle.cantidad} (${detalle.motivo}) — ${resolucion}`,
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
      const detalle = log.detalle as
        | { items?: { cantidad_pendiente: number }[]; retirado_por?: { nombre: string; telefono: string } | null }
        | undefined;
      const pendiente = detalle?.items?.reduce((total, i) => total + (i.cantidad_pendiente ?? 0), 0);
      const retiro = detalle?.retirado_por
        ? ` Retiró ${detalle.retirado_por.nombre} (${detalle.retirado_por.telefono}).`
        : "";
      return `Se confirmaron cantidades${doc ? ` de ${doc}` : ""}${
        pendiente !== undefined ? ` — quedan ${pendiente} pendientes` : ""
      }.${retiro}`;
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

// Barra de color arriba de la tarjeta -- mismo patron que Indicador en
// ranking/page.tsx (el color nunca es la unica pista: el titulo y el valor
// siempre llevan texto al lado).
const TONO_ACENTO: Record<Tono, string> = {
  neutral: "#a3a3a3",
  bien: "#059669",
  atencion: "#f59e0b",
  alerta: "#ef4444",
};

const TONO_TEXTO: Record<Tono, string> = {
  neutral: "text-ink",
  bien: "text-ok-fg",
  atencion: "text-warn",
  alerta: "text-danger-fg",
};

// Tarjeta de resumen (KPI) -- una idea, un numero grande, sin que haga falta
// leer una tabla para entender como viene el dia. Mismo cascaron que
// Indicador (rounded-xl border-line bg-surface p-4), pero con
// valor mas chico (estos numeros suelen ser de 1-2 digitos) y clickeable.
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
      className={`relative flex flex-col gap-1.5 overflow-hidden rounded-xl border border-line bg-surface p-4 pt-5 text-left transition-colors duration-150 hover:border-line-strong ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: TONO_ACENTO[tono] }} aria-hidden />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{titulo}</span>
      <span className={`text-4xl font-semibold leading-none tabular-nums tracking-tight ${TONO_TEXTO[tono]}`}>{valor}</span>
      {detalle ? <span className="truncate text-xs text-muted">{detalle}</span> : null}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCerrar}>
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-surface p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-ink">{titulo}</h3>
        <p className="text-sm text-muted">{mensaje}</p>
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="peligro" onClick={onConfirmar}>
            {textoConfirmar}
          </Boton>
        </div>
      </div>
    </div>
  );
}

function FilaRevision({
  entrega,
  sedes,
  onGuardado,
}: {
  entrega: Entrega;
  // Para el selector de sede origen -- solo se usa cuando la entrega esta
  // pendiente_revision (ver el bloque de campos ampliados mas abajo).
  sedes: Sede[] | undefined;
  onGuardado: () => void;
}) {
  // string y no TipoDocumento: en la practica el tipo real no siempre es
  // uno de los conocidos -- son la sugerencia rapida del datalist, no un
  // limite (ver el <input list=...> mas abajo).
  // Rol de la sesion: admin/supervisor corrigen y aprueban, solo admin
  // cancela (borrado definitivo); "consulta" ve todo en solo lectura.
  const { esAdmin, puedeEditar } = useSesion();
  const [tipo, setTipo] = useState(entrega.tipo);
  const [indicativoNumero, setIndicativoNumero] = useState(entrega.indicativo_numero);
  const [items, setItems] = useState<ItemEntrega[]>(entrega.items.map((i) => ({ ...i })));
  // Nota a nivel documento completo (distinta de la nota por producto, que
  // vive en cada item de la lista de abajo) -- su propia seccion en el JSX.
  const [notaGeneral, setNotaGeneral] = useState(entrega.nota_general ?? "");
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

  // aprobar=false: guarda las correcciones (cabecera + items) sin tocar el
  // estado -- para poder corregir un dato en pendiente_revision sin
  // aprobarla todavia, o para una entrega con items pendientes que ya esta
  // "procesada" (nunca tiene sentido forzarle el estado). aprobar=true:
  // ademas la deja como "procesada" -- solo se ofrece para pendiente_revision
  // (ver botones mas abajo).
  const guardar = async (aprobar: boolean) => {
    setGuardando(true);
    try {
      // sede_origen_id/operador_id/capturado_at/traslado_* solo tienen
      // sentido corregirlos en pendiente_revision (ver bloque condicional
      // del JSX) -- para el resto de las entregas (conPendiente) se manda
      // solo lo de siempre.
      const camposRevision: Parameters<typeof revisarEntrega>[1] = {
        tipo,
        indicativo_numero: indicativoNumero,
        aprobar,
      };
      if (entrega.estado === "pendiente_revision") {
        camposRevision.sede_origen_id = sedeOrigenId || undefined;
        camposRevision.operador_id = operadorId || undefined;
        camposRevision.capturado_at = datetimeLocalAIso(capturadoAt);
        camposRevision.traslado_tipo = trasladoTipo || undefined;
        camposRevision.traslado_indicativo_numero = trasladoIndicativoNumero || undefined;
      }
      await revisarEntrega(entrega.id, camposRevision);
      // Tambien dispara si SOLO cambio la nota general (items vacio no
      // rompe nada del lado del backend, ver aplicar_actualizacion_items) --
      // si no, guardar una nota general sin tocar cantidades no haria nada.
      const notaGeneralCambio = notaGeneral.trim() !== (entrega.nota_general ?? "").trim();
      if (items.length > 0 || notaGeneralCambio) {
        await actualizarItems(
          entrega.id,
          items.map((item) => ({
            id: item.id,
            descripcion: item.descripcion,
            cantidad_entregada: item.cantidad_entregada,
            cantidad_pendiente: item.cantidad_pendiente,
          })),
          notaGeneralCambio ? notaGeneral : undefined
        );
      }
      toast.success(aprobar ? "Entrega aprobada" : "Entrega guardada");
      onGuardado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  // Cancelar/eliminar el pedido -- SIEMPRE via el borrado definitivo
  // (solo rol admin), nunca via DELETE /entregas/{id} (el que
  // comparte el movil para "cancelar sin confirmar" desde Confirmando): ese
  // otro endpoint exige que nada este confirmado todavia, y aflojarlo
  // dejaria que un bodeguero real borre sin querer una entrega con historial
  // ya confirmado. Este boton es exclusivo del dashboard y borra aunque ya
  // haya algo parcialmente entregado (para limpiar pruebas) -- el backend
  // solo protege una entrega ya 100% completada (ver eliminar_entrega_
  // definitivo, responde 409 en ese caso). El boton de abajo ya se renderiza
  // solo cuando puedeCancelar aplica (ver el JSX mas abajo). Se llama desde
  // ModalConfirmar una vez que el usuario confirma ahi.
  const puedeCancelar = entrega.estado === "pendiente_revision" || tienePendiente(entrega);
  const cancelarPedido = async () => {
    setConfirmandoBorrado(false);
    setGuardando(true);
    try {
      await eliminarEntrega(entrega.id);
      toast.success("Pedido cancelado");
      onGuardado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cancelar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <tr className="bg-warn/5">
      <td colSpan={11} className="px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Revisar antes de aprobar — campos con baja confianza de la IA:</span>
            {camposBajaConfianza.length > 0 ? (
              <span className="font-mono text-warn">{camposBajaConfianza.join(", ")}</span>
            ) : (
              <span className="text-subtle">(ninguno — revisar por las dudas)</span>
            )}
            <a
              href={entrega.evidencia_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-info hover:underline"
            >
              Ver foto original<Icono nombre="externo" />
            </a>
            {entrega.traslado_url ? (
              <a
                href={entrega.traslado_url}
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                Ver traslado<Icono nombre="externo" />
              </a>
            ) : null}
            {entrega.firma_url ? (
              <a
                href={entrega.firma_url}
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                Ver firma<Icono nombre="externo" />
              </a>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Tipo
              <input
                disabled={!puedeEditar}
                value={tipo}
                onChange={(e) => setTipo(e.target.value.toUpperCase())}
                list="tipos-documento-sugeridos"
                placeholder="FEI, EDP, TB u otro"
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
              />
              {/* Sugerencia rapida de los tipos conocidos -- el input igual
                  acepta cualquier otro valor, el datalist no restringe. */}
              <datalist id="tipos-documento-sugeridos">
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              N° de documento
              <input
                disabled={!puedeEditar}
                value={indicativoNumero}
                onChange={(e) => setIndicativoNumero(e.target.value)}
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
              />
            </label>
          </div>

          {entrega.estado === "pendiente_revision" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Sede origen
                <select
                  disabled={!puedeEditar}
                  value={sedeOrigenId}
                  onChange={(e) => setSedeOrigenId(e.target.value)}
                  className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
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
              <label className="flex flex-col gap-1 text-xs text-muted">
                Operador
                <input
                  disabled={!puedeEditar}
                  value={operadorId}
                  onChange={(e) => setOperadorId(e.target.value)}
                  className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Fecha/hora de captura
                <input
                  disabled={!puedeEditar}
                  type="datetime-local"
                  value={capturadoAt}
                  onChange={(e) => setCapturadoAt(e.target.value)}
                  className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Traslado tipo
                  <input
                    disabled={!puedeEditar}
                    value={trasladoTipo}
                    onChange={(e) => setTrasladoTipo(e.target.value.toUpperCase())}
                    placeholder="Opcional"
                    className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Traslado N°
                  <input
                    disabled={!puedeEditar}
                    value={trasladoIndicativoNumero}
                    onChange={(e) => setTrasladoIndicativoNumero(e.target.value)}
                    placeholder="Opcional"
                    className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {/* Nota a nivel documento completo -- su propia caja, separada de
              la lista de productos de abajo (cada uno tiene su propia nota
              por item, que es un campo distinto). */}
          <div className="flex flex-col gap-1 rounded-md border border-line bg-page p-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Nota general de la factura
              <textarea
                disabled={!puedeEditar}
                value={notaGeneral}
                onChange={(e) => setNotaGeneral(e.target.value)}
                placeholder="Observación general sobre todo el documento (opcional)"
                rows={2}
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Productos
            </span>
            {items.length === 0 ? (
              <p className="text-xs text-subtle">Sin productos registrados.</p>
            ) : (
              items.map((item) => {
                const eventosHistorial = historial ? historialDeItem(historial, item.id) : [];
                return (
                  <div key={item.id} className="rounded-md border border-line p-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_140px]">
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        Descripción
                        <input
                          value={item.descripcion}
                          onChange={(e) => actualizarItem(item.id, { descripcion: e.target.value })}
                          disabled={sinPendiente || !puedeEditar}
                          className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark] disabled:opacity-40"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        Entregado
                        <input
                          type="number"
                          value={item.cantidad_entregada}
                          onChange={(e) =>
                            actualizarItem(item.id, { cantidad_entregada: Number(e.target.value) })
                          }
                          disabled={sinPendiente || !puedeEditar}
                          className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark] disabled:opacity-40"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        Pendiente
                        <input
                          disabled={!puedeEditar}
                          type="number"
                          value={item.cantidad_pendiente}
                          onChange={(e) =>
                            actualizarItem(item.id, { cantidad_pendiente: Number(e.target.value) })
                          }
                          className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark]"
                        />
                      </label>
                    </div>

                    <button
                      onClick={() => alternarHistorial(item.id)}
                      className="mt-2 text-xs text-info hover:underline"
                    >
                      <Icono nombre="reloj" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />{historialAbierto === item.id ? "Ocultar historial" : "Ver historial"}
                    </button>

                    {historialAbierto === item.id ? (
                      <div className="mt-2 flex flex-col gap-1 rounded-md border border-line bg-surface p-2 text-xs">
                        {cargandoHistorial ? (
                          <span className="text-muted">Cargando...</span>
                        ) : eventosHistorial.length === 0 ? (
                          <span className="text-muted">Sin cambios registrados todavía.</span>
                        ) : (
                          eventosHistorial.map((evento, i) => (
                            <div key={i} className="flex gap-2 text-muted">
                              <span className="shrink-0 font-mono text-subtle">
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
            <p className="text-xs text-subtle">
              Sin pendiente en ningún producto — tipo e indicativo/número quedan bloqueados. Cambiá
              la pendiente de algún producto si fue un error.
            </p>
          ) : null}
          {!puedeEditar ? (
            <p className="text-xs text-subtle">Tu rol es de consulta: puedes ver esta entrega, pero no modificarla.</p>
          ) : null}
          <div className="flex gap-2">
            {puedeEditar ? (
            <button
              onClick={() => guardar(false)}
              disabled={guardando}
              className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface-2 disabled:opacity-50"
            >
              {guardando ? "Guardando..." : "Guardar"}
            </button>
            ) : null}
            {puedeEditar && entrega.estado === "pendiente_revision" ? (
              <button
                onClick={() => guardar(true)}
                disabled={guardando}
                className="rounded-md bg-ok px-3 py-1.5 text-xs font-semibold text-ok-on transition hover:bg-ok-hover disabled:opacity-50"
              >
                {guardando ? "Guardando..." : "Aprobar"}
              </button>
            ) : null}
            {esAdmin && puedeCancelar ? (
              <button
                onClick={() => setConfirmandoBorrado(true)}
                disabled={guardando}
                className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-red-500/10 disabled:opacity-50"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </div>
        {confirmandoBorrado ? (
          <ModalConfirmar
            titulo="Cancelar pedido"
            mensaje="¿Cancelar por completo este pedido? Esta acción no se puede deshacer."
            textoConfirmar="Cancelar pedido"
            onConfirmar={cancelarPedido}
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
// Fecha y hora en horario de Colombia, ej. "28 sept 2026, 8:15 a. m." --
// explicito para que no dependa del idioma/zona del navegador de quien mira.
const FORMATO_FECHA_HORA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

function formatearFechaHora(fecha: string | null | undefined): string {
  return fecha ? FORMATO_FECHA_HORA.format(new Date(fecha)) : "—";
}

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

  // Bodegueros DISTINTOS que confirmaron cantidades -- entregas.bodeguero_id
  // solo guarda el ULTIMO (se pisa en cada visita, ver aplicar_actualizacion_items
  // en el backend), asi que si mas de una persona atendio visitas distintas
  // de este mismo documento, la columna sola no lo muestra. Se arma desde el
  // historial en su lugar (cada entrega_actualizada ya trae actor_id/
  // actor_nombre). null mientras el historial todavia esta cargando -- ahi
  // se usa como fallback el ultimo bodeguero de la fila (entrega.bodeguero_nombre).
  // Se excluye punto_venta: tambien genera entrega_actualizada (sin items) al
  // marcar FAIA, pero nunca confirma cantidades, asi que no es bodeguero.
  // Cada visita de bodega que confirmo cantidades, en orden -- base tanto de
  // la lista de bodegueros como de la seccion "Fechas" (una fila por entrega,
  // asi se ve cuando el documento se entrego en varias visitas).
  const visitasBodega =
    historial === null
      ? null
      : historial
          .filter((log) => log.evento === "entrega_actualizada" && log.actor_rol !== "punto_venta")
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const bodeguerosHistorial =
    visitasBodega === null
      ? null
      : Array.from(
          new Map(visitasBodega.map((log) => [log.actor_id, log.actor_nombre ?? log.actor_id] as const)).values()
        );

  // Fotos disponibles como miniatura -- solo las que la entrega realmente
  // trae (traslado y firma son opcionales). Si evidencia_creacion_url existe
  // y es DISTINTA de evidencia_url, alguien (tipicamente bodega) volvio a
  // fotografiar al confirmar -- mostramos las dos por separado, etiquetando
  // la original segun quien la tomo (operador_rol). Si son iguales (nadie la
  // reemplazo, ej. flujo de un solo operador) no se duplica la miniatura.
  const huboRefoto =
    entrega.evidencia_creacion_url != null && entrega.evidencia_creacion_url !== entrega.evidencia_url;
  const fotos = [
    huboRefoto
      ? {
          url: entrega.evidencia_creacion_url as string,
          etiqueta: entrega.operador_rol === "punto_venta" ? "Punto de venta" : "Foto inicial",
        }
      : null,
    { url: entrega.evidencia_url, etiqueta: huboRefoto ? "Bodega" : "Foto" },
    entrega.traslado_url ? { url: entrega.traslado_url, etiqueta: "Traslado" } : null,
    entrega.firma_url ? { url: entrega.firma_url, etiqueta: "Firma" } : null,
  ].filter((f): f is { url: string; etiqueta: string } => f !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">
              {entrega.tipo} {entrega.indicativo_numero}
            </h3>
            <Pildora tono={estadoVisual(entrega).tono} className="mt-1">
              {estadoVisual(entrega).etiqueta}
            </Pildora>
          </div>
          <button onClick={onCerrar} className="text-muted hover:text-ink" aria-label="Cerrar">
            <Icono nombre="cerrar" className="h-5 w-5" />
          </button>
        </div>

        {/* Datos clave en tarjetas, no en una lista de texto -- de un vistazo
            se entiende quien/donde/cuando sin tener que leer renglon por
            renglon. */}
        <div className="flex flex-col gap-2 text-sm">
          {/* flex-wrap en vez de grid-cols-2: cada tarjeta ocupa solo el
              ancho de su texto, y si las tres no entran en una fila, la que
              sobra salta sola a la siguiente. */}
          <div className="flex flex-wrap gap-2">
            <div className="rounded-md border border-line bg-page p-2">
              <span className="block text-xs text-muted">Sede</span>
              <span className="whitespace-nowrap text-ink">
                {entrega.sede_origen_nombre ?? entrega.sede_origen_id}
              </span>
            </div>
            <div className="rounded-md border border-line bg-page p-2">
              <span className="block text-xs text-muted">Operador</span>
              <span className="whitespace-nowrap text-ink">
                {entrega.operador_nombre ?? entrega.operador_id}
              </span>
            </div>
            <div className="rounded-md border border-line bg-page p-2">
              <span className="block text-xs text-muted">
                {bodeguerosHistorial && bodeguerosHistorial.length > 1 ? "Bodegueros" : "Bodeguero"}
              </span>
              <span className="text-ink">
                {bodeguerosHistorial && bodeguerosHistorial.length > 0
                  ? bodeguerosHistorial.join(", ")
                  : (entrega.bodeguero_nombre ?? entrega.bodeguero_id ?? "NE")}
              </span>
            </div>
          </div>
        </div>

        {/* Fechas: cuando se subio el documento (punto de venta u operador
            que lo creo) y cada entrega de bodega por separado -- si se
            entrego en varias visitas, aparece una fila por visita. */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Fechas</span>
          <ol className="flex flex-col divide-y divide-line rounded-md border border-line bg-page text-sm">
            <li className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="flex flex-col">
                <span className="text-ink">
                  {entrega.operador_rol === "punto_venta" ? "Subido por punto de venta" : "Capturado"}
                </span>
                <span className="text-xs text-muted">{entrega.operador_nombre ?? entrega.operador_id}</span>
              </div>
              <span className="whitespace-nowrap text-right text-soft">
                {formatearFechaHora(entrega.capturado_at)}
              </span>
            </li>
            {visitasBodega === null ? (
              <li className="px-3 py-2 text-xs text-muted">Cargando entregas...</li>
            ) : visitasBodega.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted">Todavía no se entregó en bodega.</li>
            ) : (
              visitasBodega.map((log, i) => (
                <li key={log.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-ink">
                      {visitasBodega.length > 1 ? `Entrega ${i + 1} de ${visitasBodega.length}` : "Entregado en bodega"}
                    </span>
                    <span className="text-xs text-muted">{log.actor_nombre ?? log.actor_id ?? "—"}</span>
                  </div>
                  <span className="whitespace-nowrap text-right text-ok-fg">
                    {formatearFechaHora(log.timestamp)}
                  </span>
                </li>
              ))
            )}
          </ol>
        </div>

        {/* Nota a nivel documento completo (distinta de la nota por
            producto, que se ve mas abajo dentro de cada item) -- en su
            propia seccion para no confundirla con esas. */}
        {entrega.nota_general?.trim() ? (
          <div className="flex flex-col gap-1 rounded-md border border-line bg-page p-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Nota general</span>
            <span className="whitespace-pre-wrap text-ink">{entrega.nota_general}</span>
          </div>
        ) : null}

        {/* Miniaturas en vez de links de texto -- se entiende de un vistazo
            que evidencia hay sin tener que abrir cada una. */}
        {fotos.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Evidencia</span>
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
                    className="h-24 w-full rounded-md border border-line object-cover transition group-hover:border-info/60"
                  />
                  <span className="text-center text-xs text-muted group-hover:text-info">
                    {foto.etiqueta}<Icono nombre="externo" />
                  </span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Productos</span>
          {entrega.items.length === 0 ? (
            <p className="text-xs text-subtle">Sin productos registrados.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {entrega.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-soft">{item.descripcion}</span>
                  <span className="flex shrink-0 items-center gap-1 text-ok-fg">
                    <Icono nombre="check" className="h-3.5 w-3.5" /> {item.cantidad_entregada}
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
            className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted hover:text-ink"
          >
            <span>Historial {historial ? `(${eventosHistorial.length})` : ""}</span>
            <Icono nombre={historialAbierto ? "arriba" : "abajo"} className="h-4 w-4" />
          </button>
          {historialAbierto ? (
            <div className="flex flex-col gap-3 rounded-md border border-line bg-page p-3 text-xs">
              {cargandoHistorial ? (
                <span className="text-muted">Cargando...</span>
              ) : eventosHistorial.length === 0 ? (
                <span className="text-muted">Sin cambios registrados todavía.</span>
              ) : (
                eventosHistorial.map(({ log, texto }, i) => (
                  <div key={log.id} className="flex gap-2">
                    <div className="flex flex-col items-center">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-info" />
                      {i < eventosHistorial.length - 1 ? (
                        <span className="w-px flex-1 bg-surface-2" />
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-0.5 pb-2">
                      <span className="font-mono text-subtle">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <span className="text-soft">{texto}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCerrar}>
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-red-500/40 bg-surface p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-danger-fg">Eliminar TODOS los productos</h3>
        <p className="text-sm text-muted">
          Esto borra permanentemente todas las entregas, sus productos y todo el historial de logs. No
          se puede deshacer.
        </p>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Escribí &quot;{PALABRA_CONFIRMACION_LIMPIEZA}&quot; para confirmar
          <input
            value={palabra}
            onChange={(e) => setPalabra(e.target.value)}
            disabled={limpiando}
            className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink [color-scheme:dark] disabled:opacity-40"
          />
        </label>
        {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar} disabled={limpiando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" onClick={confirmar} disabled={!habilitado || limpiando}>
            {limpiando ? "Eliminando..." : "Eliminar todo"}
          </Boton>
        </div>
      </div>
    </div>
  );
}

// Realtime es la via principal de actualizacion; el polling queda como red de
// seguridad (30s en vivo, 5s si el socket esta caido).
const POLLING_EN_VIVO_MS = 30000;
const POLLING_SIN_REALTIME_MS = 5000;

// Revalida "entregas" y todas las variantes filtradas de la tabla.
const revalidarEntregas = () =>
  mutateGlobal((key) => key === "entregas" || (Array.isArray(key) && key[0] === "entregas-tabla"));

export default function DashboardPage() {
  const [enVivo, setEnVivo] = useState(false);
  const refreshInterval = enVivo ? POLLING_EN_VIVO_MS : POLLING_SIN_REALTIME_MS;
  // SWR dedupea llamadas concurrentes, reintenta ante error y revalida al
  // volver a la pestaña, ademas del polling — sin el useEffect/setInterval
  // manual que teniamos antes.
  const { data: entregas, error: entregasError } = useSWR("entregas", () => fetchEntregas(), {
    refreshInterval,
  });
  const {
    data: logs,
    isLoading: logsCargando,
    mutate: recargarLogs,
  } = useSWR("logs", fetchLogs, { refreshInterval });
  // Para el selector de sede origen en la edicion ampliada de FilaRevision --
  // no cambia seguido, no hace falta refreshInterval.
  const { data: sedes } = useSWR("sedes", fetchSedes);

  // Filtro por rango de fechas (calendario, ver fechasCalendarioAISO) y por
  // sede de la seccion "Todas las entregas" -- fuente de datos SEPARADA de
  // `entregas` (el hook base) para que "Cómo va hoy" y "Necesita tu
  // atención" queden siempre fijos en hoy/todas las sedes, sin importar lo
  // que se elija aca. "" en desde/hasta equivale a "Todo" (sin filtrar).
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [sedeFiltro, setSedeFiltro] = useState<string>("todas");
  const [limiteTabla, setLimiteTabla] = useState(150);
  const [busqueda, setBusqueda] = useState("");

  // Reset del limite al cambiar cualquiera de los filtros -- se hace en los
  // propios manejadores y no en un useEffect, para no disparar un setState
  // sincronico dentro de un efecto (react-hooks/set-state-in-effect).
  const cambiarFechaDesde = (valor: string) => {
    setFechaDesde(valor);
    setLimiteTabla(150);
  };
  const cambiarFechaHasta = (valor: string) => {
    setFechaHasta(valor);
    setLimiteTabla(150);
  };
  const limpiarFechas = () => {
    setFechaDesde("");
    setFechaHasta("");
    setLimiteTabla(150);
  };
  const cambiarSedeFiltro = (nuevaSede: string) => {
    setSedeFiltro(nuevaSede);
    setLimiteTabla(150);
  };

  // El buscador le pega al backend (busca en todo el historico, no solo en
  // las `limiteTabla` filas ya cargadas -- ver GET /entregas?busqueda=) --
  // se debounce 300ms para no mandar un request por cada tecla.
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setBusquedaDebounced(busqueda.trim()), 300);
    return () => clearTimeout(id);
  }, [busqueda]);
  const cambiarBusqueda = (valor: string) => {
    setBusqueda(valor);
    setLimiteTabla(150);
  };

  // Con los filtros por defecto la peticion es identica a la del hook base
  // (/entregas?limit=150): se comparte la key para que SWR la dedupee.
  const tablaPorDefecto =
    !fechaDesde && !fechaHasta && sedeFiltro === "todas" && !busquedaDebounced && limiteTabla === 150;
  const { data: entregasTabla, isLoading: entregasTablaCargando } = useSWR(
    tablaPorDefecto
      ? "entregas"
      : ["entregas-tabla", fechaDesde, fechaHasta, sedeFiltro, busquedaDebounced, limiteTabla],
    tablaPorDefecto
      ? () => fetchEntregas()
      : () =>
          fetchEntregas({
            sedeId: sedeFiltro === "todas" ? undefined : sedeFiltro,
            ...fechasCalendarioAISO(fechaDesde, fechaHasta),
            busqueda: busquedaDebounced || undefined,
            limit: limiteTabla,
          }),
    { refreshInterval }
  );

  const [enRevision, setEnRevision] = useState<string | null>(null);
  // "Necesita tu atención" arranca colapsado a los N mas urgentes por grupo
  // -- con hasta 150 entregas cargadas, mostrar todo de una hacia una pared
  // de botones inmanejable. Cada grupo se expande por separado.
  const [verTodoRevision, setVerTodoRevision] = useState(false);
  const [verTodoPendiente, setVerTodoPendiente] = useState(false);
  // Filtro por categoria, aparte del buscador de texto libre (ver
  // entregasFiltradas mas abajo y las tarjetas/botones que lo setean).
  const [filtroEstado, setFiltroEstado] = useState<"todas" | "revision" | "pendiente" | "procesada">(
    "todas"
  );
  // Filtro por flujo (despachos vs. remisiones RM2/RM3/RSF), aparte del filtro de
  // estado y del buscador -- se combinan con AND (ver entregasFiltradas).
  const [filtroFlujo, setFiltroFlujo] = useState<"todos" | "despachos" | "remisiones">("todos");
  // Entrega mostrada en el detalle visual de solo lectura (ver
  // ModalDetalleEntrega mas abajo) -- solo se abre para entregas ya
  // `procesada` sin nada pendiente, donde no tiene sentido el flujo
  // editable de FilaRevision.
  const [entregaDetalle, setEntregaDetalle] = useState<Entrega | null>(null);

  // Rol de la sesion: la zona de peligro y el borrado son solo admin, y el
  // link a Administracion tambien (el backend lo exige igual, 403 si no).
  // Consulta (!puedeEditar) no ve lo que es para actuar: "Necesita tu
  // atencion" ni la tarjeta "Para revision" (la IA no estaba segura).
  const { esAdmin, puedeEditar } = useSesion();

  const [limpiezaModalAbierta, setLimpiezaModalAbierta] = useState(false);
  // Export en curso (los exports piden sesion: se bajan por fetch, no por link).
  const [descargando, setDescargando] = useState<FormatoExport | null>(null);
  const descargar = async (formato: FormatoExport) => {
    setDescargando(formato);
    try {
      await descargarExport(formato);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar el archivo");
    } finally {
      setDescargando(null);
    }
  };
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
        revalidarEntregas();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "entrega_items" }, () => {
        revalidarEntregas();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "logs" }, () => {
        recargarLogs();
      })
      .subscribe((status) => setEnVivo(status === "SUBSCRIBED"));

    return () => {
      cliente.removeChannel(canal);
    };
  }, [recargarLogs]);

  const error = entregasError instanceof Error ? entregasError.message : null;

  // --- Resumen del dia: todo esto se calcula de lo ya cargado, sin pedirle
  // nada nuevo al backend (ver el comentario de limit en lib/api.ts). ---
  const entregasPorId = useMemo(() => new Map((entregas ?? []).map((e) => [e.id, e])), [entregas]);
  const entregasHoy = useMemo(() => (entregas ?? []).filter((e) => esHoy(e.capturado_at)), [entregas]);
  const remisionesHoy = useMemo(
    () => entregasHoy.filter((e) => TIPOS_REMISION.includes(e.tipo.toUpperCase())),
    [entregasHoy]
  );
  // Ordenadas por capturado_at ascendente -- lo mas viejo esperando primero
  // es lo mas urgente, y es el orden en el que "Necesita tu atención" las
  // muestra (ver mas abajo).
  const paraRevisar = useMemo(
    () =>
      (entregas ?? [])
        .filter((e) => e.estado === "pendiente_revision")
        .sort((a, b) => a.capturado_at.localeCompare(b.capturado_at)),
    [entregas]
  );
  const conPendiente = useMemo(
    () =>
      (entregas ?? [])
        .filter((e) => tienePendiente(e) && e.estado !== "pendiente_revision")
        .sort((a, b) => a.capturado_at.localeCompare(b.capturado_at)),
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

  // El texto libre ya se filtro en el backend (ver busquedaDebounced /
  // GET /entregas?busqueda=), asi que aca solo quedan filtroEstado (arriba) y
  // filtroFlujo.
  const entregasFiltradas = useMemo(() => {
    if (filtroFlujo === "todos") return entregasPorEstado;
    const esRemision = (tipo: string) => TIPOS_REMISION.includes(tipo.toUpperCase());
    return entregasPorEstado?.filter((e) => esRemision(e.tipo) === (filtroFlujo === "remisiones"));
  }, [entregasPorEstado, filtroFlujo]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <EncabezadoPagina
        sobretitulo="Control logístico · multi-sede"
        titulo="Panel de despachos"
        descripcion="Así viene el negocio hoy, en las dos sedes — se actualiza solo, sin recargar la página."
        acciones={
          <span
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              enVivo ? "border-ok/50 text-ok-fg" : "border-line-strong text-subtle"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${enVivo ? "bg-ok-fg" : "bg-subtle"}`}
            />
            {enVivo ? "En vivo" : "Conectando..."}
          </span>
        }
      />

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-danger-fg">
          No se pudo conectar con el backend ({API_URL_HINT}): {error}
        </div>
      ) : null}

      {/* Resumen del dia -- lo primero que ve el dueño, sin leer una tabla. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Cómo va hoy</h2>
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${puedeEditar ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          <TarjetaResumen
            titulo="Entregas hoy"
            valor={entregasHoy.length}
            tono="neutral"
            detalle={porSedeHoy.length > 0 ? porSedeHoy.map(([sede, n]) => `${sede}: ${n}`).join(" · ") : "Todavía sin movimiento"}
          />
          <TarjetaResumen
            titulo="Remisiones hoy"
            valor={remisionesHoy.length}
            tono="neutral"
            detalle={remisionesHoy.length > 0 ? "RM2 / RM3 / RSF capturadas" : "Todavía sin movimiento"}
            onClick={() => setFiltroFlujo("remisiones")}
          />
          {puedeEditar ? (
            <TarjetaResumen
              titulo="Para revisión"
              valor={paraRevisar.length}
              tono={paraRevisar.length > 0 ? "atencion" : "bien"}
              detalle="La IA no estaba segura del todo"
              onClick={() => setFiltroEstado("revision")}
            />
          ) : null}
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
      {!puedeEditar ? null : entregas === undefined && !entregasError ? (
        // Reserva la altura tipica de la seccion cargada para que no empuje
        // lo de abajo cuando llegan los datos.
        <section className="flex flex-col gap-4" aria-busy>
          <h2 className="text-sm font-medium uppercase tracking-wide text-warn">
            Necesita tu atención
          </h2>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Sin terminar</h3>
            {Array.from({ length: LIMITE_ATENCION }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />
            ))}
            <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
          </div>
        </section>
      ) : paraRevisar.length === 0 && conPendiente.length === 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-warn">
            Necesita tu atención
          </h2>
          <p className="text-sm text-muted">Todo al día: no hay entregas en revisión ni sin terminar.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-warn">
            Necesita tu atención
          </h2>
          {paraRevisar.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                En revisión{paraRevisar.length > LIMITE_ATENCION ? ` (${paraRevisar.length})` : ""}
              </h3>
              {(verTodoRevision ? paraRevisar : paraRevisar.slice(0, LIMITE_ATENCION)).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEnRevision(enRevision === e.id ? null : e.id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left text-sm transition hover:bg-amber-500/10"
                >
                  <span className="font-medium text-ink">
                    {e.tipo} {e.indicativo_numero} · {e.sede_origen_nombre ?? e.sede_origen_id}
                  </span>
                  <span className="text-xs font-medium text-warn">La IA no está segura — revisar</span>
                </button>
              ))}
              {paraRevisar.length > LIMITE_ATENCION ? (
                <button
                  onClick={() => setVerTodoRevision((v) => !v)}
                  className="self-start text-xs font-medium text-muted hover:text-warn"
                >
                  {verTodoRevision ? "Ver menos" : `Ver todas (${paraRevisar.length})`}
                </button>
              ) : null}
            </div>
          ) : null}
          {conPendiente.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                Sin terminar{conPendiente.length > LIMITE_ATENCION ? ` (${conPendiente.length})` : ""}
              </h3>
              {(verTodoPendiente ? conPendiente : conPendiente.slice(0, LIMITE_ATENCION)).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEnRevision(enRevision === e.id ? null : e.id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left text-sm transition hover:bg-amber-500/10"
                >
                  <span className="font-medium text-ink">
                    {e.tipo} {e.indicativo_numero} · {e.sede_origen_nombre ?? e.sede_origen_id}
                  </span>
                  <span className="text-xs font-medium text-warn">
                    Faltan entregar {sumar(e.items, "cantidad_pendiente")} unidades
                  </span>
                </button>
              ))}
              {conPendiente.length > LIMITE_ATENCION ? (
                <button
                  onClick={() => setVerTodoPendiente((v) => !v)}
                  className="self-start text-xs font-medium text-muted hover:text-warn"
                >
                  {verTodoPendiente ? "Ver menos" : `Ver todas (${conPendiente.length})`}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Todas las entregas
            </h2>
            <p className="text-xs text-subtle">Historial completo, ordenado por más reciente.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => descargar("xlsx")}
              disabled={descargando !== null}
              className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft transition hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
            >
              <Icono nombre="descarga" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
              {descargando === "xlsx" ? "Descargando…" : "Reporte mensual (Excel)"}
            </button>
            <button
              type="button"
              onClick={() => descargar("csv")}
              disabled={descargando !== null}
              className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft transition hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
            >
              {descargando === "csv" ? "Descargando…" : "Descargar CSV (Excel)"}
            </button>
          </div>
        </div>

        {/* Tarjeta de filtros -- mismo patron que ranking/page.tsx: buscador
            arriba, controles segmentados abajo, resumen "Mostrando" al pie. */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
          <input
            value={busqueda}
            onChange={(e) => cambiarBusqueda(e.target.value)}
            placeholder="Buscar por tipo, número, sede, operador o producto..."
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-xs text-ink placeholder:text-subtle [color-scheme:dark]"
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtro por categoria, aparte del buscador -- se combina con AND
                (ver entregasPorEstado/entregasFiltradas). */}
            <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-page p-1">
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
                  aria-pressed={filtroEstado === opcion.valor}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    filtroEstado === opcion.valor
                      ? "bg-brand-gold text-brand-ink"
                      : "text-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {opcion.etiqueta}
                </button>
              ))}
            </div>
            {/* Filtro por flujo: despachos vs. remisiones (RM2/RM3/RSF). */}
            <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-page p-1">
              {(
                [
                  { valor: "todos", etiqueta: "Todos" },
                  { valor: "despachos", etiqueta: "Despachos" },
                  { valor: "remisiones", etiqueta: "Remisiones" },
                ] as const
              ).map((opcion) => (
                <button
                  key={opcion.valor}
                  onClick={() => setFiltroFlujo(opcion.valor)}
                  aria-pressed={filtroFlujo === opcion.valor}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    filtroFlujo === opcion.valor
                      ? "bg-brand-gold text-brand-ink"
                      : "text-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {opcion.etiqueta}
                </button>
              ))}
            </div>
            {/* Filtro por rango de fechas -- calendario libre (desde/hasta),
                con "Todo" para volver a no filtrar (ver fechasCalendarioAISO).
                Se combina con AND junto al resto de filtros de esta tabla. */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-page px-2 py-1">
              <label className="flex flex-col items-start">
                <span className="text-[10px] leading-none text-muted">Desde</span>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => cambiarFechaDesde(e.target.value)}
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
                  onChange={(e) => cambiarFechaHasta(e.target.value)}
                  min={fechaDesde || undefined}
                  className="rounded bg-transparent px-1 py-1 text-xs text-ink [color-scheme:dark]"
                />
              </label>
              <button
                onClick={limpiarFechas}
                aria-pressed={!fechaDesde && !fechaHasta}
                className={`ml-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  !fechaDesde && !fechaHasta
                    ? "bg-brand-gold text-brand-ink"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                Todo
              </button>
            </div>
            {/* Filtro por sede -- opt-in, no oculta que existen las demas
                (default "todas"). */}
            <select
              value={sedeFiltro}
              onChange={(e) => cambiarSedeFiltro(e.target.value)}
              className="rounded-lg border border-line bg-page px-3 py-2 text-xs text-ink [color-scheme:dark]"
            >
              <option value="todas">Todas las sedes</option>
              {(sedes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted">
            Mostrando{" "}
            <span className="font-medium text-soft">{entregasFiltradas?.length ?? 0}</span>{" "}
            {entregasFiltradas?.length === 1 ? "entrega" : "entregas"}
            {entregasTablaCargando ? <span className="ml-2 text-subtle">actualizando…</span> : null}
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Número</th>
                <th className="px-4 py-3 font-semibold">Sede</th>
                <th className="px-4 py-3 font-semibold">Bodeguero</th>
                <th className="px-4 py-3 font-semibold">Productos</th>
                <th className="px-4 py-3 text-right font-semibold">Entregas</th>
                <th className="px-4 py-3 text-right font-semibold">Entregado</th>
                <th className="px-4 py-3 text-right font-semibold">Pendiente</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Capturado</th>
                <th className="px-4 py-3 font-semibold">Foto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!entregasTablaCargando && entregasTabla?.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-muted">
                    Sin entregas todavía.
                  </td>
                </tr>
              ) : null}
              {!entregasTablaCargando && busquedaDebounced && entregasFiltradas?.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-muted">
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
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer transition-colors duration-150 hover:bg-surface-2"
                      onClick={() =>
                        puedeEditar
                          ? setEnRevision(enRevision === e.id ? null : e.id)
                          : setEntregaDetalle(e)
                      }
                    >
                      <td className="px-4 py-3 font-mono text-soft">{e.tipo || "—"}</td>
                      <td className="px-4 py-3 font-mono text-soft">
                        {e.indicativo_numero || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-soft">
                        {nombreSedeCorto(e.sede_origen_nombre) ?? e.sede_origen_id}
                      </td>
                      <td className="px-4 py-3 text-soft">
                        {e.bodeguero_nombre ?? e.bodeguero_id ?? "NE"}
                      </td>
                      <td
                        className="max-w-[220px] truncate px-4 py-3 text-muted"
                        title={e.items.map((i) => i.descripcion).join(", ")}
                      >
                        {e.items.length === 0
                          ? "—"
                          : `${e.items.length} producto${e.items.length === 1 ? "" : "s"}`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-soft">
                        {sumar(e.items, "cantidad_entregada") + sumar(e.items, "cantidad_pendiente")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-soft">{sumar(e.items, "cantidad_entregada")}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-soft">{sumar(e.items, "cantidad_pendiente")}</td>
                      <td className="px-4 py-3">
                        <Pildora tono={estadoVisual(e).tono} className="whitespace-nowrap">
                          {estadoVisual(e).etiqueta}
                        </Pildora>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {e.capturado_at ? new Date(e.capturado_at).toLocaleString() : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {/* Un solo boton, no un link de texto por foto -- abre
                            el mismo modal de detalle (ya arma la galeria de
                            evidencia/traslado/firma), disponible aunque la
                            fila este en estado editable (donde el click en la
                            fila abre FilaRevision en vez del modal). */}
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setEntregaDetalle(e);
                          }}
                          className="rounded-md border border-info/40 px-2 py-1 text-xs font-medium text-info transition hover:bg-info/10"
                        >
                          Ver fotos
                        </button>
                      </td>
                    </tr>
                    {enRevision === e.id ? (
                      <FilaRevision
                        key={`${e.id}-revision`}
                        entrega={e}
                        sedes={sedes}
                        onGuardado={() => {
                          setEnRevision(null);
                          revalidarEntregas();
                        }}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {entregasTabla?.length === limiteTabla ? (
          <button
            onClick={() => setLimiteTabla((l) => l + 150)}
            className="self-center rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft transition hover:bg-surface-2"
          >
            Cargar más
          </button>
        ) : null}
      </section>

      <TarjetaConHeader
        titulo="Actividad reciente"
        subtitulo="Qué fue pasando, en lenguaje simple."
        pildora={!logsCargando ? `${actividad.length}` : undefined}
      >
        {!logsCargando && actividad.length === 0 ? (
          <EstadoVacio titulo="Sin actividad registrada todavía." />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {actividad.map(({ log, texto }) => (
              <li
                key={log.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm text-soft transition hover:bg-surface-2/60"
              >
                <span>{texto}</span>
                <span className="shrink-0 text-xs text-subtle">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TarjetaConHeader>

      {esAdmin ? (
      <section className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-danger-fg">Zona de peligro</h2>
          <p className="text-xs text-muted">
            Borra permanentemente todas las entregas, productos y logs del sistema. Pensado para
            resetear datos de prueba -- no toca las fotos ya subidas a Storage.
          </p>
        </div>
        <div>
          <button
            onClick={() => setLimpiezaModalAbierta(true)}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-red-500/10 disabled:opacity-50"
          >
            Eliminar TODOS los productos
          </button>
        </div>
        {limpiezaResultado ? (
          <p className="text-xs text-muted">
            Última limpieza: {limpiezaResultado.entregas_borradas} entregas y{" "}
            {limpiezaResultado.logs_borrados} logs borrados.
          </p>
        ) : null}
      </section>
      ) : null}

      {entregaDetalle ? (
        <ModalDetalleEntrega entrega={entregaDetalle} onCerrar={() => setEntregaDetalle(null)} />
      ) : null}

      {limpiezaModalAbierta ? (
        <ModalConfirmarLimpieza
          onCerrar={() => setLimpiezaModalAbierta(false)}
          onConfirmar={async () => {
            const resultado = await eliminarTodasLasEntregas();
            setLimpiezaResultado(resultado);
            setLimpiezaModalAbierta(false);
            toast.success(
              `Se eliminaron ${resultado.entregas_borradas} entregas y ${resultado.logs_borrados} logs`
            );
            revalidarEntregas();
            recargarLogs();
          }}
        />
      ) : null}
    </main>
  );
}
