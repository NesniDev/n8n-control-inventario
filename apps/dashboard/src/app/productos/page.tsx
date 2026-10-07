"use client";

// Catalogo codigo -> nombre de producto (ver apps/backend/app/services/productos.py):
// se auto-completa a medida que se procesan/corrigen facturas -- esta pantalla es
// solo para consultarlo/buscarlo y completar o corregir a mano lo que la
// extraccion automatica no pudo resolver. Requiere sesion del panel; crear y
// corregir es solo para admin/supervisor (consulta lo ve en solo lectura).

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { actualizarProducto, crearProducto, fetchProductos, type Producto } from "@/lib/api";
import { EncabezadoPagina, ErrorConReintento, EstadoVacio } from "@/components/ui";
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

  return (
    <main className="mx-auto flex w-full flex-1 max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <EncabezadoPagina
        sobretitulo="Control logístico · catálogo"
        titulo="Catálogo de productos"
        descripcion="Se completa solo a partir de las facturas procesadas — aquí puedes buscarlo y, si tu rol lo permite, corregir el código o el nombre a mano."
      />

      {/* Agregar a mano + buscador, en una sola tarjeta de filtros, mismo
          patron que ranking/page.tsx. */}
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
        {puedeEditar ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Agregar a mano</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] leading-none text-muted">Código</span>
              <input
                value={codigoNuevo}
                onChange={(e) => setCodigoNuevo(e.target.value)}
                className="w-32 rounded-lg border border-line bg-page px-2 py-1.5 text-xs text-ink [color-scheme:dark]"
              />
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col gap-1">
              <span className="text-[10px] leading-none text-muted">Nombre</span>
              <input
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                className="rounded-lg border border-line bg-page px-2 py-1.5 text-xs text-ink [color-scheme:dark]"
              />
            </label>
            <button
              onClick={agregar}
              disabled={agregando || !codigoNuevo.trim() || !nombreNuevo.trim()}
              className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-brand-gold px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:bg-gold-hover disabled:opacity-50"
            >
              {agregando ? "Agregando…" : "Agregar"}
            </button>
          </div>
        </div>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-muted">Buscar por código o nombre</span>
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Ej. 75936 o sal blanca"
            className="rounded-lg border border-line bg-page px-3 py-2 text-xs text-ink [color-scheme:dark]"
          />
        </label>
        <p className="text-xs text-muted">
          {isLoading
            ? "Cargando…"
            : `${productos?.length ?? 0} ${productos?.length === 1 ? "producto" : "productos"}${
                buscar ? ` para "${buscar}"` : ""
              }`}
        </p>
      </section>

      {error ? <ErrorConReintento mensaje="No se pudo cargar el catálogo." onReintentar={() => recargar()} /> : null}

      <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Productos</h2>
          {productos && productos.length > 0 ? (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
              {productos.length} {productos.length === 1 ? "producto" : "productos"}
            </span>
          ) : null}
        </header>

        {isLoading ? (
          <ul className="flex flex-col gap-1" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <div className="h-3 w-16 animate-pulse rounded bg-surface-2" />
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
            ayuda={buscar ? "Probá con otro código o nombre." : "Se completa solo al procesar facturas."}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {productos.map((producto) => (
              <li
                key={producto.id}
                className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm transition hover:bg-surface-2/60"
              >
                {editandoId === producto.id ? (
                  <>
                    <input
                      value={codigoEditado}
                      onChange={(e) => setCodigoEditado(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") guardarEdicion(producto);
                        if (e.key === "Escape") setEditandoId(null);
                      }}
                      aria-label="Código"
                      className="w-24 shrink-0 rounded-md border border-line-strong bg-page px-2 py-1 font-mono text-xs text-ink"
                    />
                    <input
                      autoFocus
                      value={nombreEditado}
                      onChange={(e) => setNombreEditado(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") guardarEdicion(producto);
                        if (e.key === "Escape") setEditandoId(null);
                      }}
                      aria-label="Nombre"
                      className="min-w-0 flex-1 rounded-md border border-line-strong bg-page px-2 py-1 text-sm text-ink"
                    />
                  </>
                ) : (
                  <>
                    <span className="w-24 shrink-0 font-mono text-xs text-muted">{producto.codigo}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{producto.nombre}</span>
                  </>
                )}
                {puedeEditar ? (
                  <div className="shrink-0">
                    {editandoId === producto.id ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => guardarEdicion(producto)}
                          disabled={guardandoEdicion || !codigoEditado.trim() || !nombreEditado.trim()}
                          className="cursor-pointer text-xs font-medium text-ink hover:text-ink disabled:opacity-50"
                        >
                          {guardandoEdicion ? "Guardando…" : "Guardar"}
                        </button>
                        <button
                          onClick={() => setEditandoId(null)}
                          className="cursor-pointer text-xs font-medium text-muted hover:text-ink"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => empezarEdicion(producto)}
                        className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink"
                      >
                        Editar
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
