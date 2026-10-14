"use client";

// Catalogo codigo -> nombre de producto (ver apps/backend/app/services/productos.py):
// se auto-completa a medida que se procesan/corrigen facturas -- esta pantalla es
// solo para consultarlo/buscarlo y completar o corregir a mano lo que la
// extraccion automatica no pudo resolver. Requiere sesion del panel; crear y
// corregir es solo para admin/supervisor (consulta lo ve en solo lectura).

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { actualizarProducto, crearProducto, eliminarProducto, fetchProductos, type Producto } from "@/lib/api";
import { claseBoton, EncabezadoPagina, ErrorConReintento, EstadoVacio } from "@/components/ui";
import { AccionEliminar } from "@/components/creador/compartido";
import { useSesion } from "@/lib/SesionProvider";

export default function ProductosPage() {
  const { puedeEditar } = useSesion();
  const [buscar, setBuscar] = useState("");
  const {
    data: productos,
    error,
    isLoading,
    mutate: recargar,
  } = useSWR(["productos", buscar], () => fetchProductos(buscar || undefined));

  const [codigoNuevo, setCodigoNuevo] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [agregando, setAgregando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [codigoEditado, setCodigoEditado] = useState("");
  const [nombreEditado, setNombreEditado] = useState("");
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  const agregar = async () => {
    if (!codigoNuevo.trim() || !nombreNuevo.trim()) return;
    setAgregando(true);
    try {
      await crearProducto({ codigo: codigoNuevo.trim(), nombre: nombreNuevo.trim() });
      toast.success("Producto agregado");
      setCodigoNuevo("");
      setNombreNuevo("");
      recargar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar el producto");
    } finally {
      setAgregando(false);
    }
  };

  const empezarEdicion = (producto: Producto) => {
    if (!puedeEditar) return;
    setEditandoId(producto.id);
    setCodigoEditado(producto.codigo);
    setNombreEditado(producto.nombre);
  };

  const guardarEdicion = async (producto: Producto) => {
    const codigo = codigoEditado.trim();
    const nombre = nombreEditado.trim();
    if (!codigo || !nombre) return;
    if (codigo === producto.codigo && nombre === producto.nombre) {
      setEditandoId(null);
      return;
    }
    setGuardandoEdicion(true);
    try {
      await actualizarProducto(producto.id, {
        ...(codigo !== producto.codigo ? { codigo } : {}),
        ...(nombre !== producto.nombre ? { nombre } : {}),
      });
      toast.success("Producto actualizado");
      setEditandoId(null);
      recargar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar el producto");
    } finally {
      setGuardandoEdicion(false);
    }
  };

  const contador = isLoading
    ? "Cargando…"
    : `${productos?.length ?? 0} ${productos?.length === 1 ? "producto" : "productos"}${
        buscar ? ` para "${buscar}"` : ""
      }`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <EncabezadoPagina
        titulo="Catálogo de productos"
        descripcion="Busca un producto por código o nombre. El catálogo se completa solo con las facturas procesadas y, si tu rol lo permite, puedes corregir el código o el nombre a mano."
      />

      {/* Buscador y alta manual, en una sola banda con divisiones. */}
      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-1.5 p-4">
          <label htmlFor="productos-buscar" className="text-sm font-medium text-soft">
            Buscar por código o nombre
          </label>
          <input
            id="productos-buscar"
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Ej. 75936 o sal blanca"
            className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
          />
          <p className="text-xs text-muted" aria-live="polite">
            {contador}
          </p>
        </div>
        {puedeEditar ? (
          <div className="flex flex-col gap-2 border-t border-line p-4">
            <h2 className="text-sm font-semibold text-ink">Agregar a mano</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="producto-codigo-nuevo" className="text-sm font-medium text-soft">
                  Código
                </label>
                <input
                  id="producto-codigo-nuevo"
                  value={codigoNuevo}
                  onChange={(e) => setCodigoNuevo(e.target.value)}
                  className="min-h-11 w-36 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                />
              </div>
              <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <label htmlFor="producto-nombre-nuevo" className="text-sm font-medium text-soft">
                  Nombre
                </label>
                <input
                  id="producto-nombre-nuevo"
                  value={nombreNuevo}
                  onChange={(e) => setNombreNuevo(e.target.value)}
                  className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                />
              </div>
              <button
                onClick={agregar}
                disabled={agregando || !codigoNuevo.trim() || !nombreNuevo.trim()}
                className={claseBoton("primario", "min-h-11")}
              >
                {agregando ? "Agregando…" : "Agregar"}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <ErrorConReintento mensaje="No se pudo cargar el catálogo." onReintentar={() => recargar()} /> : null}

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        {isLoading ? (
          <ul className="flex flex-col divide-y divide-line" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex min-h-11 items-center gap-3 px-4 py-3">
                <div className="h-4 w-20 animate-pulse rounded bg-surface-2" />
                <div
                  className="h-3 flex-1 animate-pulse rounded bg-surface-2"
                  style={{ maxWidth: `${60 - i * 5}%` }}
                />
              </li>
            ))}
          </ul>
        ) : !productos || productos.length === 0 ? (
          <EstadoVacio
            titulo={buscar ? "Ningún producto coincide con la búsqueda." : "Todavía no hay productos cargados."}
            ayuda={buscar ? "Prueba con otro código o nombre." : "Se completa solo al procesar facturas."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">Productos del catálogo</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th scope="col" className="w-36 px-4 py-3 font-medium">
                    Código
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Nombre
                  </th>
                  {puedeEditar ? (
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Acciones
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {productos.map((producto) => (
                  <tr key={producto.id} className="min-h-11 transition-colors duration-150 hover:bg-surface-2">
                    {editandoId === producto.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={codigoEditado}
                            onChange={(e) => setCodigoEditado(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") guardarEdicion(producto);
                              if (e.key === "Escape") setEditandoId(null);
                            }}
                            aria-label="Código"
                            className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            autoFocus
                            value={nombreEditado}
                            onChange={(e) => setNombreEditado(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") guardarEdicion(producto);
                              if (e.key === "Escape") setEditandoId(null);
                            }}
                            aria-label="Nombre"
                            className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="whitespace-nowrap px-4 py-2">
                          <span className="cifra text-[16px] text-ink">{producto.codigo}</span>
                        </td>
                        <td className="px-4 py-2 text-ink">{producto.nombre}</td>
                      </>
                    )}
                    {puedeEditar ? (
                      <td className="px-4 py-2">
                        {editandoId === producto.id ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => guardarEdicion(producto)}
                              disabled={guardandoEdicion || !codigoEditado.trim() || !nombreEditado.trim()}
                              className={claseBoton("primario")}
                            >
                              {guardandoEdicion ? "Guardando…" : "Guardar"}
                            </button>
                            <button onClick={() => setEditandoId(null)} className={claseBoton("fantasma")}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => empezarEdicion(producto)}
                              aria-label={`Editar ${producto.codigo}`}
                              className={claseBoton("secundario")}
                            >
                              Editar
                            </button>
                            <AccionEliminar
                              nombre={`${producto.codigo} ${producto.nombre} del catálogo`}
                              exito="Producto eliminado"
                              onEliminar={() => eliminarProducto(producto.id)}
                              onHecho={() => recargar()}
                            />
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
