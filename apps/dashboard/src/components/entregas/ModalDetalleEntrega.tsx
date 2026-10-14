"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { eliminarEntrega, fetchHistorialEntrega, type Entrega, type LogEvent } from "@/lib/api";
import { useSesion } from "@/lib/SesionProvider";
import { Icono, Pildora } from "@/components/ui";
import {
  describirCambioAdmin,
  describirEvento,
  esCorreccionAdmin,
  estadoVisual,
  formatearFechaHora,
  nombreActorAdmin,
  nombreBodeguero,
  type CambioAdmin,
} from "@/lib/entregas";
import { Folio } from "./Folio";
import { IconoModificadaAdmin } from "./IconoModificadaAdmin";
import { ModalConfirmar } from "./ModalConfirmar";
import { ModalEditarEntrega } from "./ModalEditarEntrega";
import { VisorFotos } from "./VisorFotos";

// Detalle visual para comparar las fotos de una entrega con los datos
// extraidos: visor grande a la izquierda (arriba en movil) y panel de datos
// a la derecha (abajo en movil). Admin puede editar o eliminar desde aqui.
export function ModalDetalleEntrega({
  entrega,
  onCerrar,
  onEliminado,
  onEditado,
}: {
  entrega: Entrega;
  onCerrar: () => void;
  onEliminado: () => void;
  onEditado: () => void;
}) {
  // Solo admin puede borrar o editar una entrega ya completada (ver
  // eliminar_entrega_definitivo en el backend, que tambien lo exige).
  const { esAdmin } = useSesion();
  const [editando, setEditando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const eliminar = async () => {
    setConfirmandoBorrado(false);
    setEliminando(true);
    try {
      await eliminarEntrega(entrega.id);
      toast.success("Entrega eliminada");
      onEliminado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setEliminando(false);
    }
  };
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
  // Mientras se edita o se confirma un borrado, Escape cierra solo ese
  // dialogo interno, no el detalle.
  useEffect(() => {
    const alPresionarTecla = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (editando) setEditando(false);
      else if (confirmandoBorrado) setConfirmandoBorrado(false);
      else onCerrar();
    };
    document.addEventListener("keydown", alPresionarTecla);
    return () => document.removeEventListener("keydown", alPresionarTecla);
  }, [onCerrar, editando, confirmandoBorrado]);

  // Accesibilidad del dialogo: el foco entra al abrirlo y vuelve al boton que
  // lo abrio ("Ver fotos") al cerrarlo.
  const idTitulo = useId();
  const dialogoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const disparador = document.activeElement as HTMLElement | null;
    dialogoRef.current?.focus();
    return () => {
      if (disparador && disparador.isConnected) disparador.focus();
    };
  }, []);

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
  // Las visitas marcadas desde_punto_venta se excluyen: las registro un
  // bodeguero pero no las entrego bodega (se listan aparte, abajo).
  const entregadoDesdePuntoVenta = (log: LogEvent) =>
    (log.detalle as { desde_punto_venta?: boolean } | undefined)?.desde_punto_venta === true;
  const entregadoDesdeOtraBodega = (log: LogEvent) =>
    (log.detalle as { desde_otra_bodega?: boolean } | undefined)?.desde_otra_bodega === true;
  const visitasBodega =
    historial === null
      ? null
      : historial
          .filter(
            (log) =>
              log.evento === "entrega_actualizada" &&
              log.actor_rol !== "punto_venta" &&
              !entregadoDesdePuntoVenta(log) &&
              !entregadoDesdeOtraBodega(log) &&
              !esCorreccionAdmin(log)
          )
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  // Correcciones manuales desde el dashboard -- seccion "Cambios del admin".
  const correccionesAdmin =
    historial === null
      ? []
      : historial
          .filter(esCorreccionAdmin)
          .map((log) => ({ log, cambios: (log.detalle as { cambios?: CambioAdmin[] } | undefined)?.cambios }))
          // Guardados que no cambiaron nada (ej. "Guardar" sin tocar campos)
          // no son un cambio que mostrar.
          .filter(({ cambios }) => cambios === undefined || cambios.length > 0)
          .sort((a, b) => new Date(a.log.timestamp).getTime() - new Date(b.log.timestamp).getTime());
  const visitasPuntoVenta =
    historial === null
      ? []
      : historial
          .filter((log) => log.evento === "entrega_actualizada" && entregadoDesdePuntoVenta(log))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const visitasOtraBodega =
    historial === null
      ? []
      : historial
          .filter((log) => log.evento === "entrega_actualizada" && entregadoDesdeOtraBodega(log))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const bodeguerosHistorial =
    visitasBodega === null
      ? null
      : Array.from(
          new Map(visitasBodega.map((log) => [log.actor_id, log.actor_nombre ?? log.actor_id] as const)).values()
        );

  // Fotos disponibles -- solo las que la entrega realmente trae (traslado y
  // firma son opcionales). Si evidencia_creacion_url existe y es DISTINTA de
  // evidencia_url, alguien (tipicamente bodega) volvio a fotografiar al
  // confirmar -- se muestran las dos por separado, etiquetando la original
  // segun quien la tomo (operador_rol). Si son iguales (nadie la reemplazo,
  // ej. flujo de un solo operador) no se duplica.
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

  // Titulo pequeno de cada seccion del panel lateral.
  const tituloSeccion = "text-xs font-medium uppercase tracking-wide text-muted";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-night/70 sm:p-4"
      onClick={onCerrar}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden bg-surface outline-none sm:h-[92vh] sm:max-w-[1200px] sm:rounded-lg sm:border sm:border-line"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={idTitulo} className="min-w-0 truncate">
            <Folio tipo={entrega.tipo} numero={entrega.indicativo_numero} tamano="modal" />
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {esAdmin ? (
              <button
                onClick={() => setEditando(true)}
                disabled={eliminando}
                className="rounded-md border border-info/40 px-3 py-1.5 text-xs font-medium text-info transition hover:bg-info/10 disabled:opacity-50"
              >
                Editar
              </button>
            ) : null}
            {esAdmin ? (
              <button
                onClick={() => setConfirmandoBorrado(true)}
                disabled={eliminando}
                className="rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-danger/10 disabled:opacity-50"
              >
                {eliminando ? "Eliminando..." : "Eliminar"}
              </button>
            ) : null}
            <button
              onClick={onCerrar}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
              aria-label="Cerrar"
            >
              <Icono nombre="cerrar" className="h-5 w-5" />
            </button>
          </div>
        </div>
        {editando ? (
          <ModalEditarEntrega entrega={entrega} onCerrar={() => setEditando(false)} onGuardado={onEditado} />
        ) : null}
        {confirmandoBorrado ? (
          <ModalConfirmar
            titulo="Eliminar entrega"
            mensaje={`¿Eliminar por completo ${entrega.tipo} ${entrega.indicativo_numero}? Ya está entregada: desaparece del historial y del reporte mensual. Esta acción no se puede deshacer.`}
            textoConfirmar="Eliminar entrega"
            onConfirmar={eliminar}
            onCerrar={() => setConfirmandoBorrado(false)}
          />
        ) : null}

        {/* Cuerpo: visor de fotos como area principal (arriba en movil,
            izquierda en escritorio) y panel de datos para compararlas. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="flex shrink-0 flex-col p-4 lg:min-w-0 lg:flex-1 lg:shrink">
            <VisorFotos fotos={fotos} teclado={!editando && !confirmandoBorrado} />
          </div>

          <aside className="flex flex-col gap-5 border-t border-line p-4 lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="flex flex-wrap items-center gap-2">
              <Folio tipo={entrega.tipo} numero={entrega.indicativo_numero} />
              <Pildora tono={estadoVisual(entrega).tono}>{estadoVisual(entrega).etiqueta}</Pildora>
              {entrega.modificada_por_admin ? (
                <span className="flex items-center gap-1 text-xs text-warn">
                  <IconoModificadaAdmin /> Modificada por el admin
                </span>
              ) : null}
            </div>

            {/* Datos clave en lista compacta con filas separadas por linea. */}
            <dl className="flex flex-col divide-y divide-line rounded-md border border-line text-sm">
              <div className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="text-muted">Sede</dt>
                <dd className="text-right text-ink">{entrega.sede_origen_nombre ?? entrega.sede_origen_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="text-muted">Operador</dt>
                <dd className="text-right text-ink">{entrega.operador_nombre ?? entrega.operador_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="text-muted">
                  {bodeguerosHistorial && bodeguerosHistorial.length > 1 ? "Bodegueros" : "Bodeguero"}
                </dt>
                <dd className="text-right text-ink">
                  {bodeguerosHistorial && bodeguerosHistorial.length > 0
                    ? bodeguerosHistorial.join(", ")
                    : nombreBodeguero(entrega)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="text-muted">Capturado</dt>
                <dd className="text-right text-ink">{formatearFechaHora(entrega.capturado_at)}</dd>
              </div>
            </dl>

            {/* Productos extraidos: lo que hay que comparar contra la foto. */}
            <section className="flex flex-col gap-2">
              <h3 className={tituloSeccion}>Productos</h3>
              {entrega.items.length === 0 ? (
                <p className="text-xs text-subtle">Sin productos registrados.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                  {entrega.items.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 text-soft">{item.descripcion}</span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                        <span className="flex items-center gap-1 text-sm text-ok-fg">
                          <Icono nombre="check" className="h-3.5 w-3.5" />
                          <span className="sr-only">Entregado</span> {item.cantidad_entregada}
                        </span>
                        {item.cantidad_pendiente > 0 ? (
                          <span className="text-muted">Pendiente {item.cantidad_pendiente}</span>
                        ) : null}
                        {(item.cantidad_no_entregada ?? 0) > 0 ? (
                          <span className="text-muted">No entregado {item.cantidad_no_entregada}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Nota a nivel documento completo (distinta de la nota por
                producto) -- en su propia seccion para no confundirla. */}
            {entrega.nota_general?.trim() ? (
              <section className="flex flex-col gap-1 rounded-md border border-line bg-page p-3 text-sm">
                <h3 className={tituloSeccion}>Nota general</h3>
                <span className="whitespace-pre-wrap text-ink">{entrega.nota_general}</span>
              </section>
            ) : null}

            {/* Fechas: cuando se subio el documento y cada entrega de bodega
                por separado -- si se entrego en varias visitas, aparece una
                fila por visita. */}
            <section className="flex flex-col gap-2">
              <h3 className={tituloSeccion}>Fechas</h3>
              <ol className="flex flex-col divide-y divide-line rounded-md border border-line text-sm">
                <li className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-ink">
                      {entrega.operador_rol === "punto_venta" ? "Subido por punto de venta" : "Capturado"}
                    </span>
                    <span className="text-xs text-muted">{entrega.operador_nombre ?? entrega.operador_id}</span>
                  </div>
                  <span className="text-right text-soft">{formatearFechaHora(entrega.capturado_at)}</span>
                </li>
                {visitasBodega === null ? (
                  <li className="px-3 py-2 text-xs text-muted">Cargando entregas...</li>
                ) : visitasBodega.length === 0 ? (
                  visitasPuntoVenta.length === 0 && visitasOtraBodega.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-muted">Todavía no se entregó en bodega.</li>
                  ) : null
                ) : (
                  visitasBodega.map((log, i) => (
                    <li key={log.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-ink">
                          {visitasBodega.length > 1 ? `Entrega ${i + 1} de ${visitasBodega.length}` : "Entregado en bodega"}
                        </span>
                        <span className="text-xs text-muted">{log.actor_nombre ?? log.actor_id ?? "—"}</span>
                      </div>
                      <span className="text-right text-ok-fg">{formatearFechaHora(log.timestamp)}</span>
                    </li>
                  ))
                )}
                {visitasPuntoVenta.map((log) => (
                  <li key={log.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-ink">Punto de venta</span>
                      <span className="text-xs text-muted">Registró {log.actor_nombre ?? log.actor_id ?? "—"}</span>
                    </div>
                    <span className="text-right text-ok-fg">{formatearFechaHora(log.timestamp)}</span>
                  </li>
                ))}
                {visitasOtraBodega.map((log) => (
                  <li key={log.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-ink">Otra bodega</span>
                      <span className="text-xs text-muted">Registró {log.actor_nombre ?? log.actor_id ?? "—"}</span>
                    </div>
                    <span className="text-right text-ok-fg">{formatearFechaHora(log.timestamp)}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Correcciones manuales desde el dashboard: quien corrigio,
                cuando y que valor cambio. Los logs de antes de este registro
                no traen el detalle del cambio. */}
            {correccionesAdmin.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className={tituloSeccion}>Cambios del admin</h3>
                <ol className="flex flex-col divide-y divide-line rounded-md border border-line text-sm">
                  {correccionesAdmin.map(({ log, cambios }) => (
                    <li key={log.id} className="flex flex-col gap-1 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-ink">{nombreActorAdmin(log)}</span>
                        <span className="text-right text-warn">{formatearFechaHora(log.timestamp)}</span>
                      </div>
                      {cambios ? (
                        <ul className="flex flex-col gap-0.5 text-xs text-muted">
                          {cambios.map((cambio, i) => (
                            <li key={i}>{describirCambioAdmin(cambio)}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-subtle">Corrección sin detalle (registrada antes de guardar los cambios).</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {/* Historial colapsado por defecto -- no obliga a leerlo si solo
                se vino a ver las fotos. Linea de tiempo con puntos. */}
            <section className="flex flex-col gap-2">
              <button
                onClick={() => setHistorialAbierto((v) => !v)}
                aria-expanded={historialAbierto}
                className="flex items-center justify-between text-sm font-medium text-muted hover:text-ink"
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
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
