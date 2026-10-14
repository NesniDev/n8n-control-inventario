"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  actualizarItems,
  eliminarEntrega,
  fetchHistorialEntrega,
  revisarEntrega,
  type Entrega,
  type ItemEntrega,
  type LogEvent,
  type Sede,
} from "@/lib/api";
import { useSesion } from "@/lib/SesionProvider";
import { Icono } from "@/components/ui";
import {
  TIPOS_DOCUMENTO,
  datetimeLocalAIso,
  historialDeItem,
  isoADatetimeLocal,
  tienePendiente,
} from "@/lib/entregas";
import { ModalConfirmar } from "./ModalConfirmar";

export function FilaRevision({
  entrega,
  sedes,
  onGuardado,
  columnas = 10,
}: {
  entrega: Entrega;
  // Para el selector de sede origen -- solo se usa cuando la entrega esta
  // pendiente_revision (ver el bloque de campos ampliados mas abajo).
  sedes: Sede[] | undefined;
  onGuardado: () => void;
  // Cantidad de columnas de la tabla donde se inserta la fila expandida.
  columnas?: number;
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
    <tr className="bg-warn-fill/10">
      <td colSpan={columnas} className="px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Revisa estos campos antes de aprobar:</span>
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
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
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
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
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
                  className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
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
                  className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Fecha/hora de captura
                <input
                  disabled={!puedeEditar}
                  type="datetime-local"
                  value={capturadoAt}
                  onChange={(e) => setCapturadoAt(e.target.value)}
                  className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
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
                    className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Traslado N°
                  <input
                    disabled={!puedeEditar}
                    value={trasladoIndicativoNumero}
                    onChange={(e) => setTrasladoIndicativoNumero(e.target.value)}
                    placeholder="Opcional"
                    className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
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
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">
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
                          disabled={(sinPendiente && !esAdmin) || !puedeEditar}
                          className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink disabled:opacity-40"
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
                          disabled={(sinPendiente && !esAdmin) || !puedeEditar}
                          className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink disabled:opacity-40"
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
                          className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
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

          {sinPendiente && !esAdmin ? (
            <p className="text-xs text-subtle">
              Sin pendiente en ningún producto — tipo e indicativo/número quedan bloqueados. Cambia
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
                className="rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-danger/10 disabled:opacity-50"
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
