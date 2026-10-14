"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  actualizarSupervisor,
  crearSupervisor,
  eliminarSupervisor,
  fetchSupervisoresAdmin,
  resetearPinSupervisor,
} from "@/lib/api";
import { ErrorConReintento, Panel } from "@/components/ui";
import {
  INPUT,
  BOTON_PRIMARIO,
  BOTON_LINK,
  BOTON_CANCELAR,
  AccionEliminar,
  PIN_VALIDO,
  Campo,
  Insignia,
  ejecutar,
  CambiarPin,
  Cargando,
  Lista,
  FILA,
} from "./compartido";

export function SeccionSupervisores() {
  const { data, error, isLoading, mutate } = useSWR(["creador-supervisores"], () => fetchSupervisoresAdmin());
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearSupervisor({ nombre: nombre.trim(), pin }), "Supervisor creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      setPin("");
      mutate();
    }
  };

  return (
    <Panel conRelleno={false} titulo="Supervisores" subtitulo="Resuelven las novedades de los traslados entre puntos." conteo={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4 sm:p-5">
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
        </Campo>
        <Campo etiqueta="PIN (4 a 6 dígitos)" className="w-32">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
           
            className={INPUT}
          />
        </Campo>
        <button onClick={agregar} disabled={enviando || !nombre.trim() || !PIN_VALIDO.test(pin)} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear supervisor"}
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
          {data.map((sup) => (
            <li key={sup.id} className={FILA}>
              {editandoId === sup.id ? (
                <>
                  <input aria-label="Nombre" value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className={`${INPUT} min-w-[140px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    disabled={!nombreEdit.trim()}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarSupervisor(sup.id, { nombre: nombreEdit.trim() }), "Supervisor actualizado")) {
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
                  <span className="min-w-[140px] flex-1 text-ink">{sup.nombre}</span>
                  <Insignia activo={sup.estado === "activo"} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={() => {
                      setEditandoId(sup.id);
                      setNombreEdit(sup.nombre);
                    }}
                  >
                    Editar
                  </button>
                  <CambiarPin onGuardar={(p) => resetearPinSupervisor(sup.id, p)} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={async () => {
                      const nuevo = sup.estado === "activo" ? "inactivo" : "activo";
                      if (await ejecutar(() => actualizarSupervisor(sup.id, { estado: nuevo }), nuevo === "activo" ? "Supervisor activado" : "Supervisor desactivado")) mutate();
                    }}
                  >
                    {sup.estado === "activo" ? "Desactivar" : "Activar"}
                  </button>
                  <AccionEliminar
                    nombre={sup.nombre}
                    exito="Supervisor eliminado"
                    onEliminar={() => eliminarSupervisor(sup.id)}
                    onDesactivar={sup.estado === "activo" ? () => actualizarSupervisor(sup.id, { estado: "inactivo" }) : undefined}
                    exitoDesactivar="Supervisor desactivado"
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
