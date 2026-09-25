"use client";

// Catalogo codigo -> nombre de producto (ver apps/backend/app/services/productos.py):
// se auto-completa a medida que se procesan/corrigen facturas -- esta pantalla es
// solo para consultarlo/buscarlo y completar o corregir a mano lo que la
// extraccion automatica no pudo resolver. Sin login especial (a diferencia de
// /faia): no es informacion sensible, solo un catalogo interno.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { actualizarProducto, crearProducto, fetchProductos, type Producto } from "@/lib/api";
import { ErrorConReintento, EstadoVacio } from "@/components/ui";

export default function ProductosPage() {
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
    setEditandoId(producto.id);
    setNombreEditado(producto.nombre);
  };

  const guardarEdicion = async (id: string) => {
    if (!nombreEditado.trim()) return;
    setGuardandoEdicion(true);
    try {
      await actualizarProducto(id, nombreEditado.trim());
      setEditandoId(null);
      recargar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo corregir el nombre");
    } finally {
      setGuardandoEdicion(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Control logístico · catálogo
          </p>
          <h1 className="text-2xl font-semibold text-neutral-100">Catálogo de productos</h1>
          <p className="text-sm text-neutral-400">
            Se completa solo a partir de las facturas procesadas — acá podés buscarlo y corregir un
            nombre a mano si hace falta.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
        >
          ← Panel
        </Link>
      </header>

      {/* Agregar a mano + buscador, en una sola tarjeta de filtros, mismo
          patron que ranking/page.tsx. */}
      <section className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 sm:p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Agregar a mano</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] leading-none text-neutral-500">Código</span>
              <input
                value={codigoNuevo}
                onChange={(e) => setCodigoNuevo(e.target.value)}
                className="w-32 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 [color-scheme:dark]"
              />
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col gap-1">
              <span className="text-[10px] leading-none text-neutral-500">Nombre</span>
              <input
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 [color-scheme:dark]"
              />
            </label>
            <button
              onClick={agregar}
              disabled={agregando || !codigoNuevo.trim() || !nombreNuevo.trim()}
              className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white disabled:opacity-50"
            >
              {agregando ? "Agregando…" : "Agregar"}
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-neutral-500">Buscar por código o nombre</span>
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Ej. 75936 o sal blanca"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 [color-scheme:dark]"
          />
        </label>
        <p className="text-xs text-neutral-500">
          {isLoading
            ? "Cargando…"
            : `${productos?.length ?? 0} ${productos?.length === 1 ? "producto" : "productos"}${
                buscar ? ` para "${buscar}"` : ""
              }`}
        </p>
      </section>

      {error ? <ErrorConReintento mensaje="No se pudo cargar el catálogo." onReintentar={() => recargar()} /> : null}

      <section className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-100">Productos</h2>
          {productos && productos.length > 0 ? (
            <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
              {productos.length} {productos.length === 1 ? "producto" : "productos"}
            </span>
          ) : null}
        </header>

        {isLoading ? (
          <ul className="flex flex-col gap-1" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <div className="h-3 w-16 animate-pulse rounded bg-neutral-800" />
                <div
                  className="h-3 flex-1 animate-pulse rounded bg-neutral-800"
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
          <ul className="flex flex-col divide-y divide-neutral-800">
            {productos.map((producto) => (
              <li
                key={producto.id}
                className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm transition hover:bg-neutral-800/60"
              >
                <span className="w-24 shrink-0 font-mono text-xs text-neutral-500">{producto.codigo}</span>
                <div className="min-w-0 flex-1">
                  {editandoId === producto.id ? (
                    <input
                      autoFocus
                      value={nombreEditado}
                      onChange={(e) => setNombreEditado(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && guardarEdicion(producto.id)}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                    />
                  ) : (
                    <button
                      onClick={() => empezarEdicion(producto)}
                      className="truncate text-left text-neutral-200 hover:text-neutral-50"
                      title="Click para corregir el nombre"
                    >
                      {producto.nombre}
                    </button>
                  )}
                </div>
                <div className="shrink-0">
                  {editandoId === producto.id ? (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => guardarEdicion(producto.id)}
                        disabled={guardandoEdicion}
                        className="text-xs font-medium text-neutral-100 hover:text-white disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditandoId(null)}
                        className="text-xs font-medium text-neutral-500 hover:text-neutral-300"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
