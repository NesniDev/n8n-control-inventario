"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  actualizarSede,
  crearSede,
  eliminarSede,
  fetchSedesAdmin,
} from "@/lib/api";
import { ErrorConReintento, Panel } from "@/components/ui";
import {
  INPUT,
  BOTON_PRIMARIO,
  BOTON_LINK,
  BOTON_CANCELAR,
  AccionEliminar,
  Campo,
  Insignia,
  ejecutar,
  Cargando,
  Lista,
  FILA,
} from "./compartido";

export function SeccionSedes() {
  const { data, error, isLoading, mutate } = useSWR(["creador-sedes"], () => fetchSedesAdmin());
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [direccion, setDireccion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [direccionEdit, setDireccionEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(
      () => crearSede({ nombre: nombre.trim(), codigo: codigo.trim().toUpperCase(), direccion: direccion.trim() }),
      "Sede creada"
    );
    setEnviando(false);
    if (ok) {
      setNombre("");
      setCodigo("");
      setDireccion("");
      mutate();
    }
  };

  return (
    <Panel conRelleno={false} titulo="Sedes" subtitulo="Sedes de despachos (login de la app de bodega)." conteo={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4 sm:p-5">
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
        </Campo>
        <Campo etiqueta="Código (único)" className="w-32">
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} className={INPUT} />
        </Campo>
        <Campo etiqueta="Dirección" className="min-w-[160px] flex-1">
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={enviando || !nombre.trim() || !codigo.trim()} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear sede"}
        </button>
      </div>

      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} />
        </div>
      ) : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((sede) => (
            <li key={sede.id} className={FILA}>
              {editandoId === sede.id ? (
                <>
                  <input aria-label="Nombre" value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className={`${INPUT} min-w-[140px] flex-1`} />
                  <input aria-label="Dirección" value={direccionEdit} onChange={(e) => setDireccionEdit(e.target.value)} placeholder="Dirección" className={`${INPUT} min-w-[140px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    disabled={!nombreEdit.trim()}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarSede(sede.id, { nombre: nombreEdit.trim(), direccion: direccionEdit.trim() }), "Sede actualizada")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className={BOTON_CANCELAR} onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="w-20 shrink-0 text-sm tabular-nums text-muted">{sede.codigo}</span>
                  <span className="min-w-[140px] flex-1 text-ink">
                    {sede.nombre}
                    {sede.direccion ? <span className="ml-2 text-xs text-muted">{sede.direccion}</span> : null}
                  </span>
                  <Insignia activo={sede.activa} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={() => {
                      setEditandoId(sede.id);
                      setNombreEdit(sede.nombre);
                      setDireccionEdit(sede.direccion);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className={BOTON_LINK}
                   
                    onClick={async () => {
                      if (await ejecutar(() => actualizarSede(sede.id, { activa: !sede.activa }), sede.activa ? "Sede desactivada" : "Sede activada")) mutate();
                    }}
                  >
                    {sede.activa ? "Desactivar" : "Activar"}
                  </button>
                  <AccionEliminar
                    nombre={sede.nombre}
                    exito="Sede eliminada"
                    onEliminar={() => eliminarSede(sede.id)}
                    onDesactivar={sede.activa ? () => actualizarSede(sede.id, { activa: false }) : undefined}
                    exitoDesactivar="Sede desactivada"
                    onHecho={() => mutate()}
                  />
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </Panel>
  );
}
