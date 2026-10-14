// Utilidades puras de "Entregas" (/entregas) y su detalle: calculos sobre
// entregas, textos legibles del historial y la revalidacion global de SWR.
// Sin JSX (los componentes viven en components/entregas).

// Filtros de /entregas que viven en la URL (?estado=...&flujo=...) y que
// tambien fijan las tarjetas del resumen.
export type FiltroEstado = "todas" | "revision" | "pendiente" | "procesada";
export type FiltroFlujo = "todos" | "despachos" | "remisiones";

import { mutate as mutateGlobal } from "swr";
import type { Entrega, ItemEntrega, LogEvent, TipoDocumento } from "@/lib/api";
import type { TonoPildora } from "@/components/ui";

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// el backend); TB9/RM3/RM2/RSF no tienen sede dueña -- sugerencia rápida del
// datalist, no una restricción real (se puede escribir cualquier otro tipo).
export const TIPOS_DOCUMENTO: TipoDocumento[] = ["FEI", "FV1", "EDP", "EDV", "TB9", "RM3", "RM2", "RSF"];

export const API_URL_HINT = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function sumar(items: ItemEntrega[], campo: "cantidad_entregada" | "cantidad_pendiente") {
  return items.reduce((total, item) => total + item[campo], 0);
}

export function esHoy(fechaIso: string | null | undefined): boolean {
  if (!fechaIso) return false;
  return new Date(fechaIso).toDateString() === new Date().toDateString();
}

export function tienePendiente(entrega: Entrega): boolean {
  return entrega.items.some((item) => item.cantidad_pendiente > 0);
}

// "Sede " es solo una convencion humana al nombrar una sede (ver comentario
// en apps/backend/app/services/duplicates.py sobre sedes.codigo vs nombre),
// no una regla del sistema -- se saca el prefijo solo para mostrar, nunca se
// toca el dato real en la base.
export function nombreSedeCorto(nombre: string | null): string | null {
  if (!nombre) return nombre;
  return nombre.replace(/^Sede\s+/i, "");
}

// Convierte el rango de calendario (inputs <input type="date">, formato
// "YYYY-MM-DD" o "" si no se eligio) a los ISO que espera fetchEntregas.
// "hasta" se lleva al final de ese dia (23:59:59.999 local) porque el
// backend filtra con capturado_at <= hasta -- sin esto se perderian las
// entregas capturadas despues de medianoche del dia elegido.
export function fechasCalendarioAISO(desde: string, hasta: string): { desde?: string; hasta?: string } {
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
export function estadoVisual(entrega: Entrega): { etiqueta: string; tono: TonoPildora } {
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
export function isoADatetimeLocal(fechaIso: string | null | undefined): string {
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
export function datetimeLocalAIso(valor: string): string | undefined {
  if (!valor) return undefined;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return undefined;
  return fecha.toISOString();
}

// Actor del dashboard (no un empleado de bodega): "dashboard:<usuario>" con
// sesion, o el "supervisor" fijo de antes del login.
export function esActorDashboard(actorId: string | null | undefined): boolean {
  return actorId != null && (actorId.startsWith("dashboard:") || actorId === "supervisor");
}

// Correccion manual hecha desde el dashboard -- no es una visita de bodega,
// se muestra aparte en "Cambios del admin". Los logs nuevos traen
// detalle.correccion_dashboard; los viejos se reconocen por el actor/sede.
export function esCorreccionAdmin(log: LogEvent): boolean {
  if (log.evento === "revision_manual_aprobada") return true;
  if (log.evento !== "entrega_actualizada") return false;
  return (
    (log.detalle as { correccion_dashboard?: boolean } | undefined)?.correccion_dashboard === true ||
    log.sede_id === "dashboard" ||
    esActorDashboard(log.actor_id)
  );
}

export function nombreActorAdmin(log: LogEvent): string {
  if (log.actor_id.startsWith("dashboard:")) return log.actor_id.slice("dashboard:".length);
  return log.actor_nombre ?? log.actor_id;
}

// Bodeguero a mostrar: nunca el usuario del dashboard (una correccion del
// admin no lo convierte en quien entrego).
export function nombreBodeguero(entrega: Entrega): string {
  if (entrega.bodeguero_nombre) return entrega.bodeguero_nombre;
  if (!entrega.bodeguero_id || esActorDashboard(entrega.bodeguero_id)) return "NE";
  return entrega.bodeguero_id;
}


export interface CambioAdmin {
  campo: string;
  antes: string | number;
  despues: string | number;
  producto?: string;
}

export const NOMBRES_CAMPO: Record<string, string> = {
  descripcion: "Nombre",
  cantidad_entregada: "Entregado",
  cantidad_pendiente: "Pendiente",
  tipo: "Tipo",
  indicativo_numero: "N° de documento",
  sede_origen_id: "Sede origen",
  operador_id: "Operador",
  capturado_at: "Fecha de captura",
  traslado_tipo: "Traslado tipo",
  traslado_indicativo_numero: "Traslado N°",
};

export function describirCambioAdmin(cambio: CambioAdmin): string {
  const campo = NOMBRES_CAMPO[cambio.campo] ?? cambio.campo;
  const prefijo = cambio.producto && cambio.campo !== "descripcion" ? `${cambio.producto}: ` : "";
  return `${prefijo}${campo}: ${cambio.antes === "" ? "—" : cambio.antes} → ${cambio.despues === "" ? "—" : cambio.despues}`;
}

export interface EventoHistorial {
  fecha: string;
  texto: string;
}

// Arma el historial de fechas de UN producto puntual a partir del historial
// completo de la entrega (logs con detalle.items trae la foto de TODOS los
// productos en cada evento -- aca se filtra solo el que corresponde). Asi se
// ve cada vez que cambio ese pendiente, aunque haya sido varias veces.
export function historialDeItem(historial: LogEvent[], itemId: string): EventoHistorial[] {
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
        const sufijoRetira = retiradoPor ? `. Retirado por ${retiradoPor.nombre} (${retiradoPor.telefono})` : "";
        const prefijoAdmin = esCorreccionAdmin(log) ? `Corrección de ${nombreActorAdmin(log)}. ` : "";
        eventos.push({
          fecha: log.timestamp,
          texto: `${prefijoAdmin}Entregado ${encontrado.cantidad_entregada}, pendiente ${encontrado.cantidad_pendiente}${sufijoRetira}`,
        });
      }
    } else if (log.evento === "devolucion_registrada" && (log.detalle as { item_id?: string })?.item_id === itemId) {
      const detalle = log.detalle as { cantidad: number; motivo: string; motivo_detalle?: string | null; resolucion: string };
      const resolucion =
        detalle.resolucion === "reposicion"
          ? "repuesto"
          : detalle.resolucion === "no_lo_lleva"
            ? "no lo lleva"
            : "reembolsado";
      eventos.push({
        fecha: log.timestamp,
        texto: `Devolución de ${detalle.cantidad} (${motivoDevolucionLegible(detalle.motivo, detalle.motivo_detalle)}) — ${resolucion}`,
      });
    } else if (log.evento === "item_no_entregado" && (log.detalle as { item_id?: string })?.item_id === itemId) {
      const detalle = log.detalle as { cantidad: number; motivo: string; motivo_detalle?: string | null };
      eventos.push({
        fecha: log.timestamp,
        texto: `No se entrega ${detalle.cantidad} (${motivoNoEntregadoLegible(detalle.motivo, detalle.motivo_detalle)})`,
      });
    }
  }
  return eventos;
}

// Mismos valores que MotivoNoEntregado en el backend (app/models/no_entregado.py).
export const MOTIVOS_NO_ENTREGADO: Record<string, string> = {
  facturado_de_mas: "Facturado de más",
  producto_equivocado: "Producto equivocado",
  // Ya no se ofrece al registrar, pero hay logs viejos con este valor.
  sin_existencia: "Sin existencia",
  otro: "Otro",
};

// Si el motivo es "otro" y el operador escribio por que, se muestra ese texto
// en vez de "Otro".
export function motivoNoEntregadoLegible(motivo: string | undefined, detalle?: string | null): string {
  if (motivo === "otro" && detalle) return detalle;
  return motivo ? (MOTIVOS_NO_ENTREGADO[motivo] ?? motivo) : "sin motivo";
}

// Mismos valores que MotivoDevolucion en el backend (app/models/devolucion.py).
export const MOTIVOS_DEVOLUCION: Record<string, string> = {
  danado: "Dañado",
  equivocado: "Equivocado",
  vencido: "Vencido",
  no_era_lo_pedido: "No era lo pedido",
  otro: "Otro",
};

export function motivoDevolucionLegible(motivo: string | undefined, detalle?: string | null): string {
  if (motivo === "otro" && detalle) return detalle;
  return motivo ? (MOTIVOS_DEVOLUCION[motivo] ?? motivo) : "sin motivo";
}

// Traduce un evento tecnico de `logs` a una frase que el dueño del negocio
// entiende sin conocer el pipeline interno. Los pasos puramente tecnicos de
// cada escaneo (foto_capturada, extraccion_ia, chequeo_duplicado,
// validacion, sync_tiempo_real, turnos_generados) son ruido para este feed
// -- devuelven null y quedan afuera (ver EventoLog en el backend para la
// lista completa de eventos que existen).
export function describirEvento(log: LogEvent, entregasPorId: Map<string, Entrega>): string | null {
  const entrega = entregasPorId.get(log.entidad_id);
  const doc = entrega ? [entrega.tipo, entrega.indicativo_numero].filter(Boolean).join(" ") : null;
  const sede = entrega?.sede_origen_nombre ?? log.sede_id;

  switch (log.evento) {
    case "entrega_insertada":
      return `Nueva entrega registrada${doc ? ` — ${doc}` : ""} en ${sede}.`;
    case "entrega_actualizada": {
      const detalle = log.detalle as
        | {
            items?: { cantidad_pendiente: number; desde_punto_venta?: boolean; desde_otra_bodega?: boolean }[];
            retirado_por?: { nombre: string; telefono: string } | null;
            desde_punto_venta?: boolean;
            desde_otra_bodega?: boolean;
          }
        | undefined;
      if (esCorreccionAdmin(log)) {
        const cambios = (log.detalle as { cambios?: CambioAdmin[] } | undefined)?.cambios;
        return `${nombreActorAdmin(log)} corrigió${doc ? ` ${doc}` : ""} desde el dashboard${
          cambios ? ` (${cambios.length} ${cambios.length === 1 ? "cambio" : "cambios"})` : ""
        }.`;
      }
      // Cierre "desde el punto de venta": lo registro el bodeguero (actor del
      // log) pero no lo entrego bodega.
      if (detalle?.desde_punto_venta) {
        return `Entregado todo desde el punto de venta${doc ? ` — ${doc}` : ""} (registró ${
          log.actor_nombre ?? log.actor_id ?? "?"
        }).`;
      }
      // Idem para remisiones entregadas por otra bodega.
      if (detalle?.desde_otra_bodega) {
        return `Entregado todo desde otra bodega${doc ? ` — ${doc}` : ""} (registró ${
          log.actor_nombre ?? log.actor_id ?? "?"
        }).`;
      }
      const pendiente = detalle?.items?.reduce((total, i) => total + (i.cantidad_pendiente ?? 0), 0);
      const retiro = detalle?.retirado_por
        ? ` Retiró ${detalle.retirado_por.nombre} (${detalle.retirado_por.telefono}).`
        : "";
      // Visita mixta: algunos productos los entrego el punto de venta.
      const nPuntoVenta = detalle?.items?.filter((i) => i.desde_punto_venta).length ?? 0;
      const puntoVenta =
        nPuntoVenta > 0
          ? ` Además, ${nPuntoVenta} ${nPuntoVenta === 1 ? "producto entregado" : "productos entregados"} en el punto de venta`
          : "";
      const nOtraBodega = detalle?.items?.filter((i) => i.desde_otra_bodega).length ?? 0;
      const otraBodega =
        nOtraBodega > 0
          ? ` Además, ${nOtraBodega} ${nOtraBodega === 1 ? "producto entregado" : "productos entregados"} en otra bodega`
          : "";
      return `Se confirmaron cantidades${doc ? ` de ${doc}` : ""}${
        pendiente !== undefined ? ` — quedan ${pendiente} pendientes` : ""
      }.${retiro}${puntoVenta}${otraBodega}`;
    }
    case "devolucion_registrada": {
      const detalle = log.detalle as
        | { cantidad?: number; motivo?: string; motivo_detalle?: string | null; resolucion?: string }
        | undefined;
      const resolucion =
        detalle?.resolucion === "reposicion"
          ? "se repone"
          : detalle?.resolucion === "no_lo_lleva"
            ? "el cliente no lo lleva"
            : "se reembolsa el dinero";
      return `Devolución${doc ? ` en ${doc}` : ""} de ${detalle?.cantidad ?? "?"} unidades (${motivoDevolucionLegible(
        detalle?.motivo,
        detalle?.motivo_detalle
      )}) — ${resolucion}.`;
    }
    case "item_no_entregado": {
      const detalle = log.detalle as
        | { cantidad?: number; producto?: string; motivo?: string; motivo_detalle?: string | null }
        | undefined;
      return `No se entregaron ${detalle?.cantidad ?? "?"} de ${detalle?.producto ?? "un producto"}${
        doc ? ` en ${doc}` : ""
      } (${motivoNoEntregadoLegible(detalle?.motivo, detalle?.motivo_detalle)}).`;
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

// Fecha y hora en horario de Colombia, ej. "28 sept 2026, 8:15 a. m." --
// explicito para que no dependa del idioma/zona del navegador de quien mira.
export const FORMATO_FECHA_HORA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

export function formatearFechaHora(fecha: string | null | undefined): string {
  return fecha ? FORMATO_FECHA_HORA.format(new Date(fecha)) : "—";
}

// Realtime es la via principal de actualizacion; el polling queda como red de
// seguridad (30s en vivo, 5s si el socket esta caido).
export const POLLING_EN_VIVO_MS = 30000;
export const POLLING_SIN_REALTIME_MS = 5000;

// Revalida "entregas" y todas las variantes filtradas de la tabla.
export const revalidarEntregas = () =>
  mutateGlobal((key) => key === "entregas" || (Array.isArray(key) && key[0] === "entregas-tabla"));
