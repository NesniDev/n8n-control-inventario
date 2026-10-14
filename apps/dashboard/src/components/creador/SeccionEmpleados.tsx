"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  type EmpleadoAdmin,
  type RolEmpleado,
  actualizarEmpleado,
  crearEmpleado,
  eliminarEmpleado,
  fetchEmpleadosAdmin,
  fetchSedesAdmin,
  resetearPinEmpleado,
} from "@/lib/api";
import { ErrorConReintento, Panel } from "@/components/ui";
import {
  INPUT,
  BOTON_PRIMARIO,
  BOTON_LINK,
  BOTON_CANCELAR,
  AccionEliminar,
  ROLES,
  etiquetaRol,
  PIN_VALIDO,
  Campo,
  Insignia,
  ejecutar,
  CambiarPin,
  Cargando,
  Lista,
  FILA,
} from "./compartido";

export function SeccionEmpleados() {
  const { data, error, isLoading, mutate } = useSWR(["creador-empleados"], () => fetchEmpleadosAdmin());
  const { data: sedes } = useSWR(["creador-sedes"], () => fetchSedesAdmin());
  const [nombre, setNombre] = useState("");
  const [sedeId, setSedeId] = useState("");
  const [rol, setRol] = useState<RolEmpleado>("operador");
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ nombre: string; sede_id: string; rol: RolEmpleado }>({
    nombre: "",
    sede_id: "",
    rol: "operador",
  });

  const nombreSede = (id: string) => sedes?.find((s) => s.id === id)?.nombre ?? id;
  const sedesActivas = sedes?.filter((s) => s.activa) ?? [];

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearEmpleado({ nombre: nombre.trim(), sede_id: sedeId, rol, pin }), "Empleado creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      setPin("");
      mutate();
    }
  };

  const guardarEdicion = async (empleado: EmpleadoAdmin) => {
    const ok = await ejecutar(() => actualizarEmpleado(empleado.id, edit), "Empleado actualizado");
    if (ok) {
      setEditandoId(null);
      mutate();
    }
  };

  return (
    <Panel conRelleno={false} titulo="Empleados (bodega)" subtitulo="Quienes inician sesión con PIN en la app de despachos." conteo={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4 sm:p-5">
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
        </Campo>
        <Campo etiqueta="Sede">
          <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} className={INPUT}>
            <option value="">Elegir…</option>
            {sedesActivas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as RolEmpleado)} className={INPUT}>
            {ROLES.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.etiqueta}
              </option>
            ))}
          </select>
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
        <button onClick={agregar} disabled={enviando || !nombre.trim() || !sedeId || !PIN_VALIDO.test(pin)} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear empleado"}
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
          {data.map((empleado) => (
            <li key={empleado.id} className={FILA}>
              {editandoId === empleado.id ? (
                <>
                  <input aria-label="Nombre" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} className={`${INPUT} min-w-[140px] flex-1`} />
                  <select aria-label="Sede" value={edit.sede_id} onChange={(e) => setEdit({ ...edit, sede_id: e.target.value })} className={INPUT}>
                    {(sedes ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Rol" value={edit.rol} onChange={(e) => setEdit({ ...edit, rol: e.target.value as RolEmpleado })} className={INPUT}>
                    {ROLES.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.etiqueta}
                      </option>
                    ))}
                  </select>
                  <button className={BOTON_LINK} disabled={!edit.nombre.trim()} onClick={() => guardarEdicion(empleado)}>
                    Guardar
                  </button>
                  <button className={BOTON_CANCELAR} onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[140px] flex-1 text-ink">
                    {empleado.nombre}
                    <span className="ml-2 text-xs text-muted">
                      {nombreSede(empleado.sede_id)}, {etiquetaRol(empleado.rol)}
                    </span>
                  </span>
                  <Insignia activo={empleado.estado === "activo"} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={() => {
                      setEditandoId(empleado.id);
                      setEdit({ nombre: empleado.nombre, sede_id: empleado.sede_id, rol: empleado.rol });
                    }}
                  >
                    Editar
                  </button>
                  <CambiarPin onGuardar={(p) => resetearPinEmpleado(empleado.id, p)} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={async () => {
                      const nuevo = empleado.estado === "activo" ? "inactivo" : "activo";
                      if (await ejecutar(() => actualizarEmpleado(empleado.id, { estado: nuevo }), nuevo === "activo" ? "Empleado activado" : "Empleado desactivado")) mutate();
                    }}
                  >
                    {empleado.estado === "activo" ? "Desactivar" : "Activar"}
                  </button>
                  <AccionEliminar
                    nombre={empleado.nombre}
                    exito="Empleado eliminado"
                    onEliminar={() => eliminarEmpleado(empleado.id)}
                    onDesactivar={
                      empleado.estado === "activo" ? () => actualizarEmpleado(empleado.id, { estado: "inactivo" }) : undefined
                    }
                    exitoDesactivar="Empleado desactivado"
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
