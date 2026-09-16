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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-3">
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
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
        >
          ← Panel
        </Link>
      </header>

      <section className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
        <h2 className="text-sm font-medium text-neutral-200">Agregar a mano</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Código
            <input
              value={codigoNuevo}
              onChange={(e) => setCodigoNuevo(e.target.value)}
              className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-xs text-neutral-500">
            Nombre
            <input
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <button
            onClick={agregar}
            disabled={agregando || !codigoNuevo.trim() || !nombreNuevo.trim()}
            className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
          >
            {agregando ? "Agregando..." : "Agregar"}
          </button>
        </div>
      </section>

      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Buscar por código o nombre
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Ej. 75936 o sal blanca"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
      </label>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudo cargar el catálogo.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Código</th>
              <th className="px-4 py-2 font-medium">Nombre</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {isLoading ? (
              <tr>
                <td className="px-4 py-3 text-neutral-500" colSpan={3}>
                  Cargando...
                </td>
              </tr>
            ) : !productos || productos.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-neutral-500" colSpan={3}>
                  {buscar ? "Ningún producto coincide con la búsqueda." : "Todavía no hay productos cargados."}
                </td>
              </tr>
            ) : (
              productos.map((producto) => (
                <tr key={producto.id}>
                  <td className="px-4 py-2 font-mono text-neutral-300">{producto.codigo}</td>
                  <td className="px-4 py-2 text-neutral-300">
                    {editandoId === producto.id ? (
                      <input
                        autoFocus
                        value={nombreEditado}
                        onChange={(e) => setNombreEditado(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && guardarEdicion(producto.id)}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                      />
                    ) : (
                      <button
                        onClick={() => empezarEdicion(producto)}
                        className="text-left hover:text-orange-400"
                        title="Click para corregir el nombre"
                      >
                        {producto.nombre}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {editandoId === producto.id ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => guardarEdicion(producto.id)}
                          disabled={guardandoEdicion}
                          className="text-xs font-medium text-orange-400 hover:text-orange-300 disabled:opacity-50"
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
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
