"use client";

// Administracion de sedes, empleados (bodega), puntos y sus usuarios,
// supervisores y tipos de documento -- reemplaza los scripts de alta
// (scripts/crear_supervisor.py, crear_punto.py) y los curl a POST /empleados.
// Todo pasa por endpoints protegidos con X-Admin-Token (mismo token que el
// borrado de entregas, ver useAdminToken). Nunca se borra nada: "Desactivar"
// deja la fila en la base (hay traslados y logs que la referencian) y solo
// deja de aparecer en la app movil.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  actualizarEmpleado,
  actualizarPunto,
  actualizarSede,
  actualizarSupervisor,
  actualizarTipoDocumento,
  actualizarUsuarioPunto,
  crearEmpleado,
  crearPunto,
  crearSede,
  crearSupervisor,
  crearTipoDocumento,
  crearUsuarioPunto,
  fetchEmpleadosAdmin,
  fetchPuntosAdmin,
  fetchSedesAdmin,
  fetchSupervisoresAdmin,
  fetchTiposDocumentoAdmin,
  fetchUsuariosPuntoAdmin,
  resetearPinEmpleado,
  resetearPinSupervisor,
  resetearPinUsuarioPunto,
  type EmpleadoAdmin,
  type RolEmpleado,
} from "@/lib/api";
import { useAdminToken } from "@/lib/useAdminToken";
import { ErrorConReintento, EstadoVacio, TarjetaConHeader } from "@/components/ui";

const INPUT =
  "rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 [color-scheme:dark] disabled:opacity-50";
const BOTON_PRIMARIO =
  "rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white disabled:opacity-50";
const BOTON_LINK = "text-xs font-medium text-neutral-400 hover:text-neutral-100 disabled:opacity-50";

const ROLES: { valor: RolEmpleado; etiqueta: string }[] = [
  { valor: "operador", etiqueta: "Bodeguero" },
  { valor: "punto_venta", etiqueta: "Punto de venta" },
  { valor: "supervisor", etiqueta: "Supervisor" },
  { valor: "admin", etiqueta: "Administrador" },
  { valor: "faia_viewer", etiqueta: "Visor FAIA" },
];
const etiquetaRol = (rol: string) => ROLES.find((r) => r.valor === rol)?.etiqueta ?? rol;

const PIN_VALIDO = /^\d{4,6}$/;

type Pestana = "sedes" | "empleados" | "puntos" | "supervisores" | "tipos";
const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "sedes", etiqueta: "Sedes" },
  { id: "empleados", etiqueta: "Empleados (bodega)" },
  { id: "puntos", etiqueta: "Puntos y usuarios" },
  { id: "supervisores", etiqueta: "Supervisores" },
  { id: "tipos", etiqueta: "Tipos de documento" },
];

function Campo({ etiqueta, children, className = "" }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] leading-none text-neutral-500">{etiqueta}</span>
      {children}
    </label>
  );
}

function Insignia({ activo }: { activo: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] ${
        activo ? "border-emerald-500/30 text-emerald-400" : "border-neutral-700 text-neutral-500"
      }`}
    >
      {activo ? "Activo" : "Inactivo"}
    </span>
  );
}

// Ejecuta una accion contra el backend con aviso de exito/error -- devuelve
// true si salio bien para que el llamador limpie su formulario.
async function ejecutar(accion: () => Promise<unknown>, exito: string): Promise<boolean> {
  try {
    await accion();
    toast.success(exito);
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "La operación falló");
    return false;
  }
}

// Reset de PIN en la propia fila: boton -> input -> guardar.
function CambiarPin({ token, onGuardar }: { token: string; onGuardar: (pin: string) => Promise<unknown> }) {
  const [abierto, setAbierto] = useState(false);
  const [pin, setPin] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} disabled={!token} className={BOTON_LINK}>
        Cambiar PIN
      </button>
    );
  }
  const guardar = async () => {
    setGuardando(true);
    const ok = await ejecutar(() => onGuardar(pin), "PIN actualizado");
    setGuardando(false);
    if (ok) {
      setAbierto(false);
      setPin("");
    }
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && PIN_VALIDO.test(pin) && guardar()}
        placeholder="4 a 6 dígitos"
        className={`${INPUT} w-24`}
      />
      <button onClick={guardar} disabled={guardando || !PIN_VALIDO.test(pin)} className={BOTON_LINK}>
        Guardar
      </button>
      <button
        onClick={() => {
          setAbierto(false);
          setPin("");
        }}
        className="text-xs text-neutral-600 hover:text-neutral-400"
      >
        Cancelar
      </button>
    </span>
  );
}

function Cargando() {
  return <p className="py-6 text-center text-xs text-neutral-500">Cargando…</p>;
}

function Lista({ vacio, children }: { vacio: boolean; children: ReactNode }) {
  if (vacio) return <EstadoVacio titulo="Todavía no hay registros." />;
  return <ul className="flex flex-col divide-y divide-neutral-800">{children}</ul>;
}

const FILA = "flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2.5 text-sm";

// ---------------------------------------------------------------- Sedes

function SeccionSedes({ token }: { token: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-sedes", token], () => fetchSedesAdmin(token));
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
      () => crearSede(token, { nombre: nombre.trim(), codigo: codigo.trim().toUpperCase(), direccion: direccion.trim() }),
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
    <TarjetaConHeader titulo="Sedes" subtitulo="Sedes de despachos (login de la app de bodega)." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <Campo etiqueta="Código (único)" className="w-32">
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <Campo etiqueta="Dirección" className="min-w-[160px] flex-1">
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={!token || enviando || !nombre.trim() || !codigo.trim()} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear sede"}
        </button>
      </div>

      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((sede) => (
            <li key={sede.id} className={FILA}>
              {editandoId === sede.id ? (
                <>
                  <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className={`${INPUT} min-w-[140px] flex-1`} />
                  <input value={direccionEdit} onChange={(e) => setDireccionEdit(e.target.value)} placeholder="Dirección" className={`${INPUT} min-w-[140px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    disabled={!nombreEdit.trim()}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarSede(token, sede.id, { nombre: nombreEdit.trim(), direccion: direccionEdit.trim() }), "Sede actualizada")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-neutral-600 hover:text-neutral-400" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="font-mono text-xs text-neutral-500">{sede.codigo}</span>
                  <span className="min-w-[140px] flex-1 text-neutral-200">
                    {sede.nombre}
                    {sede.direccion ? <span className="ml-2 text-xs text-neutral-500">{sede.direccion}</span> : null}
                  </span>
                  <Insignia activo={sede.activa} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
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
                    disabled={!token}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarSede(token, sede.id, { activa: !sede.activa }), sede.activa ? "Sede desactivada" : "Sede activada")) mutate();
                    }}
                  >
                    {sede.activa ? "Desactivar" : "Activar"}
                  </button>
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ------------------------------------------------------------ Empleados

function SeccionEmpleados({ token }: { token: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-empleados", token], () => fetchEmpleadosAdmin(token));
  const { data: sedes } = useSWR(["creador-sedes", token], () => fetchSedesAdmin(token));
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
    const ok = await ejecutar(() => crearEmpleado(token, { nombre: nombre.trim(), sede_id: sedeId, rol, pin }), "Empleado creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      setPin("");
      mutate();
    }
  };

  const guardarEdicion = async (empleado: EmpleadoAdmin) => {
    const ok = await ejecutar(() => actualizarEmpleado(token, empleado.id, edit), "Empleado actualizado");
    if (ok) {
      setEditandoId(null);
      mutate();
    }
  };

  return (
    <TarjetaConHeader titulo="Empleados (bodega)" subtitulo="Quienes inician sesión con PIN en la app de despachos." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <Campo etiqueta="Sede">
          <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} disabled={!token} className={INPUT}>
            <option value="">Elegir…</option>
            {sedesActivas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as RolEmpleado)} disabled={!token} className={INPUT}>
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
            disabled={!token}
            className={INPUT}
          />
        </Campo>
        <button onClick={agregar} disabled={!token || enviando || !nombre.trim() || !sedeId || !PIN_VALIDO.test(pin)} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear empleado"}
        </button>
      </div>

      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((empleado) => (
            <li key={empleado.id} className={FILA}>
              {editandoId === empleado.id ? (
                <>
                  <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} className={`${INPUT} min-w-[140px] flex-1`} />
                  <select value={edit.sede_id} onChange={(e) => setEdit({ ...edit, sede_id: e.target.value })} className={INPUT}>
                    {(sedes ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                  <select value={edit.rol} onChange={(e) => setEdit({ ...edit, rol: e.target.value as RolEmpleado })} className={INPUT}>
                    {ROLES.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.etiqueta}
                      </option>
                    ))}
                  </select>
                  <button className={BOTON_LINK} disabled={!edit.nombre.trim()} onClick={() => guardarEdicion(empleado)}>
                    Guardar
                  </button>
                  <button className="text-xs text-neutral-600 hover:text-neutral-400" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[140px] flex-1 text-neutral-200">
                    {empleado.nombre}
                    <span className="ml-2 text-xs text-neutral-500">
                      {nombreSede(empleado.sede_id)} · {etiquetaRol(empleado.rol)}
                    </span>
                  </span>
                  <Insignia activo={empleado.estado === "activo"} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={() => {
                      setEditandoId(empleado.id);
                      setEdit({ nombre: empleado.nombre, sede_id: empleado.sede_id, rol: empleado.rol });
                    }}
                  >
                    Editar
                  </button>
                  <CambiarPin token={token} onGuardar={(p) => resetearPinEmpleado(token, empleado.id, p)} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={async () => {
                      const nuevo = empleado.estado === "activo" ? "inactivo" : "activo";
                      if (await ejecutar(() => actualizarEmpleado(token, empleado.id, { estado: nuevo }), nuevo === "activo" ? "Empleado activado" : "Empleado desactivado")) mutate();
                    }}
                  >
                    {empleado.estado === "activo" ? "Desactivar" : "Activar"}
                  </button>
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ------------------------------------------------------ Puntos y usuarios

function UsuariosDePunto({ token, puntoId }: { token: string; puntoId: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-usuarios-punto", token, puntoId], () =>
    fetchUsuariosPuntoAdmin(token, puntoId)
  );
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearUsuarioPunto(token, puntoId, { nombre: nombre.trim(), pin }), "Usuario creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      setPin("");
      mutate();
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Nombre del usuario" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <Campo etiqueta="PIN (4 a 6 dígitos)" className="w-32">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            disabled={!token}
            className={INPUT}
          />
        </Campo>
        <button onClick={agregar} disabled={!token || enviando || !nombre.trim() || !PIN_VALIDO.test(pin)} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear usuario"}
        </button>
      </div>
      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((usuario) => (
            <li key={usuario.id} className={FILA}>
              {editandoId === usuario.id ? (
                <>
                  <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className={`${INPUT} min-w-[140px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    disabled={!nombreEdit.trim()}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarUsuarioPunto(token, usuario.id, { nombre: nombreEdit.trim() }), "Usuario actualizado")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-neutral-600 hover:text-neutral-400" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[140px] flex-1 text-neutral-200">{usuario.nombre}</span>
                  <Insignia activo={usuario.estado === "activo"} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={() => {
                      setEditandoId(usuario.id);
                      setNombreEdit(usuario.nombre);
                    }}
                  >
                    Editar
                  </button>
                  <CambiarPin token={token} onGuardar={(p) => resetearPinUsuarioPunto(token, usuario.id, p)} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={async () => {
                      const nuevo = usuario.estado === "activo" ? "inactivo" : "activo";
                      if (await ejecutar(() => actualizarUsuarioPunto(token, usuario.id, { estado: nuevo }), nuevo === "activo" ? "Usuario activado" : "Usuario desactivado")) mutate();
                    }}
                  >
                    {usuario.estado === "activo" ? "Desactivar" : "Activar"}
                  </button>
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </div>
  );
}

function SeccionPuntos({ token }: { token: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-puntos", token], () => fetchPuntosAdmin(token));
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [abiertoId, setAbiertoId] = useState<string | null>(null);

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearPunto(token, nombre.trim()), "Punto creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      mutate();
    }
  };

  return (
    <TarjetaConHeader titulo="Puntos y usuarios de punto" subtitulo="Bodegas del flujo de traslados y quienes operan en cada una." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Nombre del punto" className="min-w-[200px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={!token || enviando || !nombre.trim()} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear punto"}
        </button>
      </div>

      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((punto) => (
            <li key={punto.id} className="flex flex-col gap-2">
              <div className={FILA}>
                {editandoId === punto.id ? (
                  <>
                    <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className={`${INPUT} min-w-[160px] flex-1`} />
                    <button
                      className={BOTON_LINK}
                      disabled={!nombreEdit.trim()}
                      onClick={async () => {
                        if (await ejecutar(() => actualizarPunto(token, punto.id, { nombre: nombreEdit.trim() }), "Punto actualizado")) {
                          setEditandoId(null);
                          mutate();
                        }
                      }}
                    >
                      Guardar
                    </button>
                    <button className="text-xs text-neutral-600 hover:text-neutral-400" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-[160px] flex-1 text-neutral-200">{punto.nombre}</span>
                    <Insignia activo={punto.activo} />
                    <button className={BOTON_LINK} onClick={() => setAbiertoId(abiertoId === punto.id ? null : punto.id)}>
                      {abiertoId === punto.id ? "Ocultar usuarios" : "Usuarios"}
                    </button>
                    <button
                      className={BOTON_LINK}
                      disabled={!token}
                      onClick={() => {
                        setEditandoId(punto.id);
                        setNombreEdit(punto.nombre);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className={BOTON_LINK}
                      disabled={!token}
                      onClick={async () => {
                        if (await ejecutar(() => actualizarPunto(token, punto.id, { activo: !punto.activo }), punto.activo ? "Punto desactivado" : "Punto activado")) mutate();
                      }}
                    >
                      {punto.activo ? "Desactivar" : "Activar"}
                    </button>
                  </>
                )}
              </div>
              {abiertoId === punto.id ? <UsuariosDePunto token={token} puntoId={punto.id} /> : null}
            </li>
          ))}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ---------------------------------------------------------- Supervisores

function SeccionSupervisores({ token }: { token: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-supervisores", token], () => fetchSupervisoresAdmin(token));
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearSupervisor(token, { nombre: nombre.trim(), pin }), "Supervisor creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      setPin("");
      mutate();
    }
  };

  return (
    <TarjetaConHeader titulo="Supervisores" subtitulo="Resuelven las novedades de los traslados entre puntos." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <Campo etiqueta="PIN (4 a 6 dígitos)" className="w-32">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            disabled={!token}
            className={INPUT}
          />
        </Campo>
        <button onClick={agregar} disabled={!token || enviando || !nombre.trim() || !PIN_VALIDO.test(pin)} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear supervisor"}
        </button>
      </div>

      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((sup) => (
            <li key={sup.id} className={FILA}>
              {editandoId === sup.id ? (
                <>
                  <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className={`${INPUT} min-w-[140px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    disabled={!nombreEdit.trim()}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarSupervisor(token, sup.id, { nombre: nombreEdit.trim() }), "Supervisor actualizado")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-neutral-600 hover:text-neutral-400" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[140px] flex-1 text-neutral-200">{sup.nombre}</span>
                  <Insignia activo={sup.estado === "activo"} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={() => {
                      setEditandoId(sup.id);
                      setNombreEdit(sup.nombre);
                    }}
                  >
                    Editar
                  </button>
                  <CambiarPin token={token} onGuardar={(p) => resetearPinSupervisor(token, sup.id, p)} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={async () => {
                      const nuevo = sup.estado === "activo" ? "inactivo" : "activo";
                      if (await ejecutar(() => actualizarSupervisor(token, sup.id, { estado: nuevo }), nuevo === "activo" ? "Supervisor activado" : "Supervisor desactivado")) mutate();
                    }}
                  >
                    {sup.estado === "activo" ? "Desactivar" : "Activar"}
                  </button>
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ----------------------------------------------------- Tipos de documento

function SeccionTipos({ token }: { token: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-tipos", token], () => fetchTiposDocumentoAdmin(token));
  const [codigo, setCodigo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoCodigo, setEditandoCodigo] = useState<string | null>(null);
  const [descripcionEdit, setDescripcionEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(
      () => crearTipoDocumento(token, { codigo: codigo.trim().toUpperCase(), descripcion: descripcion.trim() }),
      "Tipo de documento creado"
    );
    setEnviando(false);
    if (ok) {
      setCodigo("");
      setDescripcion("");
      mutate();
    }
  };

  return (
    <TarjetaConHeader
      titulo="Tipos de documento"
      subtitulo="Ejemplos que se le muestran a la IA al leer una foto. Son una guía: la IA también transcribe códigos que no estén en la lista."
      pildora={data ? String(data.length) : undefined}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Código (ej. FEI)" className="w-32">
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={12} disabled={!token} className={`${INPUT} uppercase`} />
        </Campo>
        <Campo etiqueta="Descripción (opcional)" className="min-w-[200px] flex-1">
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} disabled={!token} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={!token || enviando || !codigo.trim()} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear tipo"}
        </button>
      </div>

      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((tipo) => (
            <li key={tipo.codigo} className={FILA}>
              <span className="w-16 shrink-0 font-mono text-xs text-neutral-300">{tipo.codigo}</span>
              {editandoCodigo === tipo.codigo ? (
                <>
                  <input value={descripcionEdit} onChange={(e) => setDescripcionEdit(e.target.value)} className={`${INPUT} min-w-[160px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarTipoDocumento(token, tipo.codigo, { descripcion: descripcionEdit.trim() }), "Tipo actualizado")) {
                        setEditandoCodigo(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-neutral-600 hover:text-neutral-400" onClick={() => setEditandoCodigo(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[160px] flex-1 text-neutral-400">{tipo.descripcion || "—"}</span>
                  <Insignia activo={tipo.activo} />
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={() => {
                      setEditandoCodigo(tipo.codigo);
                      setDescripcionEdit(tipo.descripcion);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className={BOTON_LINK}
                    disabled={!token}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarTipoDocumento(token, tipo.codigo, { activo: !tipo.activo }), tipo.activo ? "Tipo desactivado" : "Tipo activado")) mutate();
                    }}
                  >
                    {tipo.activo ? "Desactivar" : "Activar"}
                  </button>
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ----------------------------------------------------------------- Página

export default function CreadorPage() {
  const [adminToken, setAdminToken] = useAdminToken();
  const [pestana, setPestana] = useState<Pestana>("sedes");
  // El token se valida en el backend en cada llamada; las secciones solo
  // montan (y consultan) cuando hay uno escrito.
  const token = adminToken.trim();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Control logístico · administración</p>
          <h1 className="text-2xl font-semibold text-neutral-100">Administración</h1>
          <p className="text-sm text-neutral-400">
            Cree y gestione sedes, empleados, puntos, supervisores y tipos de documento. Nada se borra: desactivar
            solo oculta el registro en las aplicaciones.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
        >
          ← Panel
        </Link>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 sm:p-4">
        <label className="flex w-full max-w-xs flex-col gap-1">
          <span className="text-[10px] leading-none text-neutral-500">Token de administrador</span>
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="Requerido para crear o modificar"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 [color-scheme:dark]"
          />
        </label>
        <p className="max-w-sm text-xs text-neutral-600">
          Es el mismo token del panel principal; se guarda solo en este navegador.
        </p>
      </div>

      {!token ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Ingrese el token de administrador para ver y editar los registros.
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-1.5" aria-label="Secciones">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPestana(p.id)}
            aria-current={pestana === p.id ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              pestana === p.id
                ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                : "border-neutral-800 text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </nav>

      {token ? (
        <>
          {pestana === "sedes" ? <SeccionSedes token={token} /> : null}
          {pestana === "empleados" ? <SeccionEmpleados token={token} /> : null}
          {pestana === "puntos" ? <SeccionPuntos token={token} /> : null}
          {pestana === "supervisores" ? <SeccionSupervisores token={token} /> : null}
          {pestana === "tipos" ? <SeccionTipos token={token} /> : null}
        </>
      ) : null}
    </main>
  );
}
