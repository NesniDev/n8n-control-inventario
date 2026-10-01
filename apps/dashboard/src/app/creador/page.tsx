"use client";

// Administracion de sedes, empleados (bodega), puntos y sus usuarios,
// supervisores y tipos de documento -- reemplaza los scripts de alta
// (scripts/crear_supervisor.py, crear_punto.py) y los curl a POST /empleados.
// Solo para el rol admin de la sesion del panel (los endpoints exigen el
// Bearer, ver apiFetch en lib/api.ts). Nunca se borra nada: "Desactivar"
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
  actualizarUsuarioDashboard,
  actualizarUsuarioPunto,
  crearEmpleado,
  crearPunto,
  crearSede,
  crearSupervisor,
  crearTipoDocumento,
  crearUsuarioDashboard,
  crearUsuarioPunto,
  fetchEmpleadosAdmin,
  fetchPuntosAdmin,
  fetchSedesAdmin,
  fetchSupervisoresAdmin,
  fetchTiposDocumentoAdmin,
  fetchUsuariosDashboard,
  fetchUsuariosPuntoAdmin,
  resetearPasswordUsuarioDashboard,
  resetearPinEmpleado,
  resetearPinSupervisor,
  resetearPinUsuarioPunto,
  type EmpleadoAdmin,
  type RolEmpleado,
  type UsuarioDashboardAdmin,
} from "@/lib/api";
import { useSesion } from "@/lib/SesionProvider";
import { ETIQUETA_ROL, type RolDashboard } from "@/lib/sesion";
import { ErrorConReintento, EstadoVacio, Icono, TarjetaConHeader } from "@/components/ui";

const INPUT =
  "rounded-lg border border-line bg-page px-2 py-1.5 text-xs text-ink [color-scheme:dark] disabled:opacity-50";
const BOTON_PRIMARIO =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-brand-gold px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:bg-gold-hover disabled:opacity-50";
const BOTON_LINK = "text-xs font-medium text-muted hover:text-ink disabled:opacity-50";

const ROLES: { valor: RolEmpleado; etiqueta: string }[] = [
  { valor: "operador", etiqueta: "Bodeguero" },
  { valor: "punto_venta", etiqueta: "Punto de venta" },
  { valor: "supervisor", etiqueta: "Supervisor" },
  { valor: "admin", etiqueta: "Administrador" },
  { valor: "faia_viewer", etiqueta: "Visor FAIA" },
];
const etiquetaRol = (rol: string) => ROLES.find((r) => r.valor === rol)?.etiqueta ?? rol;

const PIN_VALIDO = /^\d{4,6}$/;

type Pestana = "sedes" | "empleados" | "puntos" | "supervisores" | "tipos" | "usuarios";
const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "sedes", etiqueta: "Sedes" },
  { id: "empleados", etiqueta: "Empleados (bodega)" },
  { id: "puntos", etiqueta: "Puntos y usuarios" },
  { id: "supervisores", etiqueta: "Supervisores" },
  { id: "tipos", etiqueta: "Tipos de documento" },
  { id: "usuarios", etiqueta: "Usuarios del dashboard" },
];

const ROLES_DASHBOARD: RolDashboard[] = ["admin", "supervisor", "consulta"];
const PASSWORD_MIN = 8;

function Campo({ etiqueta, children, className = "" }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] leading-none text-muted">{etiqueta}</span>
      {children}
    </label>
  );
}

function Insignia({ activo }: { activo: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] ${
        activo ? "border-ok/50 text-ok-fg" : "border-line-strong text-muted"
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
function CambiarPin({ onGuardar }: { onGuardar: (pin: string) => Promise<unknown> }) {
  const [abierto, setAbierto] = useState(false);
  const [pin, setPin] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className={BOTON_LINK}>
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
        className="text-xs text-subtle hover:text-soft"
      >
        Cancelar
      </button>
    </span>
  );
}

function Cargando() {
  return <p className="py-6 text-center text-xs text-muted">Cargando…</p>;
}

function Lista({ vacio, children }: { vacio: boolean; children: ReactNode }) {
  if (vacio) return <EstadoVacio titulo="Todavía no hay registros." />;
  return <ul className="flex flex-col divide-y divide-line">{children}</ul>;
}

const FILA = "flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2.5 text-sm";

// ---------------------------------------------------------------- Sedes

function SeccionSedes() {
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
    <TarjetaConHeader titulo="Sedes" subtitulo="Sedes de despachos (login de la app de bodega)." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
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
                      if (await ejecutar(() => actualizarSede(sede.id, { nombre: nombreEdit.trim(), direccion: direccionEdit.trim() }), "Sede actualizada")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="font-mono text-xs text-muted">{sede.codigo}</span>
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

function SeccionEmpleados() {
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
    <TarjetaConHeader titulo="Empleados (bodega)" subtitulo="Quienes inician sesión con PIN en la app de despachos." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
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
                  <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[140px] flex-1 text-ink">
                    {empleado.nombre}
                    <span className="ml-2 text-xs text-muted">
                      {nombreSede(empleado.sede_id)} · {etiquetaRol(empleado.rol)}
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

function UsuariosDePunto({ puntoId }: { puntoId: string }) {
  const { data, error, isLoading, mutate } = useSWR(["creador-usuarios-punto", puntoId], () =>
    fetchUsuariosPuntoAdmin(puntoId)
  );
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearUsuarioPunto(puntoId, { nombre: nombre.trim(), pin }), "Usuario creado");
    setEnviando(false);
    if (ok) {
      setNombre("");
      setPin("");
      mutate();
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-page/50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Nombre del usuario" className="min-w-[160px] flex-1">
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
                      if (await ejecutar(() => actualizarUsuarioPunto(usuario.id, { nombre: nombreEdit.trim() }), "Usuario actualizado")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[140px] flex-1 text-ink">{usuario.nombre}</span>
                  <Insignia activo={usuario.estado === "activo"} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={() => {
                      setEditandoId(usuario.id);
                      setNombreEdit(usuario.nombre);
                    }}
                  >
                    Editar
                  </button>
                  <CambiarPin onGuardar={(p) => resetearPinUsuarioPunto(usuario.id, p)} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={async () => {
                      const nuevo = usuario.estado === "activo" ? "inactivo" : "activo";
                      if (await ejecutar(() => actualizarUsuarioPunto(usuario.id, { estado: nuevo }), nuevo === "activo" ? "Usuario activado" : "Usuario desactivado")) mutate();
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

function SeccionPuntos() {
  const { data, error, isLoading, mutate } = useSWR(["creador-puntos"], () => fetchPuntosAdmin());
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [abiertoId, setAbiertoId] = useState<string | null>(null);

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(() => crearPunto(nombre.trim()), "Punto creado");
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
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={enviando || !nombre.trim()} className={BOTON_PRIMARIO}>
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
                        if (await ejecutar(() => actualizarPunto(punto.id, { nombre: nombreEdit.trim() }), "Punto actualizado")) {
                          setEditandoId(null);
                          mutate();
                        }
                      }}
                    >
                      Guardar
                    </button>
                    <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-[160px] flex-1 text-ink">{punto.nombre}</span>
                    <Insignia activo={punto.activo} />
                    <button className={BOTON_LINK} onClick={() => setAbiertoId(abiertoId === punto.id ? null : punto.id)}>
                      {abiertoId === punto.id ? "Ocultar usuarios" : "Usuarios"}
                    </button>
                    <button
                      className={BOTON_LINK}
                     
                      onClick={() => {
                        setEditandoId(punto.id);
                        setNombreEdit(punto.nombre);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className={BOTON_LINK}
                     
                      onClick={async () => {
                        if (await ejecutar(() => actualizarPunto(punto.id, { activo: !punto.activo }), punto.activo ? "Punto desactivado" : "Punto activado")) mutate();
                      }}
                    >
                      {punto.activo ? "Desactivar" : "Activar"}
                    </button>
                  </>
                )}
              </div>
              {abiertoId === punto.id ? <UsuariosDePunto puntoId={punto.id} /> : null}
            </li>
          ))}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ---------------------------------------------------------- Supervisores

function SeccionSupervisores() {
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
    <TarjetaConHeader titulo="Supervisores" subtitulo="Resuelven las novedades de los traslados entre puntos." pildora={data ? String(data.length) : undefined}>
      <div className="flex flex-wrap items-end gap-2">
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
                      if (await ejecutar(() => actualizarSupervisor(sup.id, { nombre: nombreEdit.trim() }), "Supervisor actualizado")) {
                        setEditandoId(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoId(null)}>
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

function SeccionTipos() {
  const { data, error, isLoading, mutate } = useSWR(["creador-tipos"], () => fetchTiposDocumentoAdmin());
  const [codigo, setCodigo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoCodigo, setEditandoCodigo] = useState<string | null>(null);
  const [descripcionEdit, setDescripcionEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(
      () => crearTipoDocumento({ codigo: codigo.trim().toUpperCase(), descripcion: descripcion.trim() }),
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
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={12} className={`${INPUT} uppercase`} />
        </Campo>
        <Campo etiqueta="Descripción (opcional)" className="min-w-[200px] flex-1">
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={enviando || !codigo.trim()} className={BOTON_PRIMARIO}>
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
              <span className="w-16 shrink-0 font-mono text-xs text-soft">{tipo.codigo}</span>
              {editandoCodigo === tipo.codigo ? (
                <>
                  <input value={descripcionEdit} onChange={(e) => setDescripcionEdit(e.target.value)} className={`${INPUT} min-w-[160px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarTipoDocumento(tipo.codigo, { descripcion: descripcionEdit.trim() }), "Tipo actualizado")) {
                        setEditandoCodigo(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoCodigo(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[160px] flex-1 text-muted">{tipo.descripcion || "—"}</span>
                  <Insignia activo={tipo.activo} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={() => {
                      setEditandoCodigo(tipo.codigo);
                      setDescripcionEdit(tipo.descripcion);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className={BOTON_LINK}
                   
                    onClick={async () => {
                      if (await ejecutar(() => actualizarTipoDocumento(tipo.codigo, { activo: !tipo.activo }), tipo.activo ? "Tipo desactivado" : "Tipo activado")) mutate();
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

// ------------------------------------------- Usuarios del dashboard

// Restablecer contraseña en la propia fila: boton -> input -> guardar. Mismo
// patron que CambiarPin, pero con contraseña (minimo 8) en vez de PIN.
function RestablecerPassword({ onGuardar }: { onGuardar: (password: string) => Promise<unknown> }) {
  const [abierto, setAbierto] = useState(false);
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className={BOTON_LINK}>
        Restablecer contraseña
      </button>
    );
  }
  const valida = password.length >= PASSWORD_MIN;
  const guardar = async () => {
    setGuardando(true);
    const ok = await ejecutar(() => onGuardar(password), "Contraseña restablecida");
    setGuardando(false);
    if (ok) {
      setAbierto(false);
      setPassword("");
    }
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        autoFocus
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && valida && guardar()}
        placeholder="Mínimo 8 caracteres"
        className={`${INPUT} w-40`}
      />
      <button onClick={guardar} disabled={guardando || !valida} className={BOTON_LINK}>
        Guardar
      </button>
      <button
        onClick={() => {
          setAbierto(false);
          setPassword("");
        }}
        className="text-xs text-subtle hover:text-soft"
      >
        Cancelar
      </button>
    </span>
  );
}

const FORMATO_FECHA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});
const fechaCorta = (iso: string | null) => (iso ? FORMATO_FECHA.format(new Date(iso)) : null);

function SeccionUsuariosDashboard() {
  const { usuario: yo } = useSesion();
  const { data, error, isLoading, mutate } = useSWR("creador-usuarios-dashboard", () => fetchUsuariosDashboard());
  // Instante de montaje: para decidir si un bloqueo sigue vigente sin llamar
  // a Date.now() en el render.
  const [ahora] = useState(() => Date.now());
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<RolDashboard>("consulta");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ nombre: string; rol: RolDashboard }>({ nombre: "", rol: "consulta" });

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(
      () => crearUsuarioDashboard({ usuario: usuario.trim().toLowerCase(), nombre: nombre.trim(), rol, password }),
      "Usuario creado"
    );
    setEnviando(false);
    if (ok) {
      setUsuario("");
      setNombre("");
      setPassword("");
      mutate();
    }
  };

  const guardarEdicion = async (u: UsuarioDashboardAdmin) => {
    const ok = await ejecutar(
      () => actualizarUsuarioDashboard(u.id, { nombre: edit.nombre.trim(), rol: edit.rol }),
      "Usuario actualizado"
    );
    if (ok) {
      setEditandoId(null);
      mutate();
    }
  };

  return (
    <TarjetaConHeader
      titulo="Usuarios del dashboard"
      subtitulo="Quienes inician sesión en este panel con usuario y contraseña. El rol define qué pueden hacer."
      pildora={data ? String(data.length) : undefined}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Usuario (a-z, 0-9 . _ @ -)" className="w-44">
          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            className={INPUT}
          />
        </Campo>
        <Campo etiqueta="Nombre" className="min-w-[160px] flex-1">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
        </Campo>
        <Campo etiqueta="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as RolDashboard)} className={INPUT}>
            {ROLES_DASHBOARD.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Contraseña (mínimo 8)" className="w-44">
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </Campo>
        <button
          onClick={agregar}
          disabled={enviando || usuario.trim().length < 3 || !nombre.trim() || password.length < PASSWORD_MIN}
          className={BOTON_PRIMARIO}
        >
          {enviando ? "Creando…" : "Crear usuario"}
        </button>
      </div>

      {error ? <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} /> : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((u) => {
            const esYo = u.id === yo?.id;
            const bloqueado = u.bloqueado_hasta && Date.parse(u.bloqueado_hasta) > ahora ? u.bloqueado_hasta : null;
            return (
              <li key={u.id} className={FILA}>
                {editandoId === u.id ? (
                  <>
                    <span className="font-mono text-xs text-muted">{u.usuario}</span>
                    <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} className={`${INPUT} min-w-[140px] flex-1`} />
                    <select value={edit.rol} onChange={(e) => setEdit({ ...edit, rol: e.target.value as RolDashboard })} className={INPUT}>
                      {ROLES_DASHBOARD.map((r) => (
                        <option key={r} value={r}>
                          {ETIQUETA_ROL[r]}
                        </option>
                      ))}
                    </select>
                    <button className={BOTON_LINK} disabled={!edit.nombre.trim()} onClick={() => guardarEdicion(u)}>
                      Guardar
                    </button>
                    <button className="text-xs text-subtle hover:text-soft" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-[160px] flex-1 text-ink">
                      {u.nombre}
                      {esYo ? <span className="ml-1 text-xs text-muted">(tú)</span> : null}
                      <span className="ml-2 font-mono text-xs text-muted">{u.usuario}</span>
                      <span className="ml-2 text-xs text-muted">{ETIQUETA_ROL[u.rol]}</span>
                      <span className="block text-[11px] text-subtle">
                        Último ingreso: {fechaCorta(u.ultimo_login_at) ?? "nunca"}
                        {bloqueado ? (
                          <span className="ml-2 text-warn">Bloqueado hasta {fechaCorta(bloqueado)}</span>
                        ) : null}
                      </span>
                    </span>
                    <Insignia activo={u.activo} />
                    <button
                      className={BOTON_LINK}
                      onClick={() => {
                        setEditandoId(u.id);
                        setEdit({ nombre: u.nombre, rol: u.rol });
                      }}
                    >
                      Editar
                    </button>
                    <RestablecerPassword onGuardar={(p) => resetearPasswordUsuarioDashboard(u.id, p)} />
                    <button
                      className={BOTON_LINK}
                      disabled={esYo && u.activo}
                      title={esYo && u.activo ? "No puedes desactivarte a ti mismo" : undefined}
                      onClick={async () => {
                        if (await ejecutar(() => actualizarUsuarioDashboard(u.id, { activo: !u.activo }), u.activo ? "Usuario desactivado" : "Usuario activado")) mutate();
                      }}
                    >
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </Lista>
      )}
    </TarjetaConHeader>
  );
}

// ----------------------------------------------------------------- Página

export default function CreadorPage() {
  const { esAdmin } = useSesion();
  const [pestana, setPestana] = useState<Pestana>("sedes");

  // Solo admin: el backend ya responde 403 a los demas, esto evita mostrar
  // una pantalla que no puede cargar nada.
  if (!esAdmin) {
    return (
      <main className="mx-auto flex w-full flex-1 max-w-4xl flex-col items-start gap-4 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-ink">Administración</h1>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warn">
          No tienes permiso para ver esta sección. Solo los administradores pueden acceder.
        </div>
        <Link
          href="/"
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft transition hover:bg-surface-2"
        >
          <Icono nombre="izquierda" className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />Volver al panel
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full flex-1 max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Control logístico · administración</p>
          <h1 className="text-2xl font-semibold text-ink">Administración</h1>
          <p className="text-sm text-muted">
            Cree y gestione sedes, empleados, puntos, supervisores, tipos de documento y usuarios del dashboard. Nada se borra: desactivar
            solo oculta el registro en las aplicaciones.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Secciones">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPestana(p.id)}
            aria-current={pestana === p.id ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              pestana === p.id
                ? "border-brand-gold bg-surface-2 text-ink"
                : "border-line text-muted hover:bg-surface-2"
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </nav>

      {pestana === "sedes" ? <SeccionSedes /> : null}
      {pestana === "empleados" ? <SeccionEmpleados /> : null}
      {pestana === "puntos" ? <SeccionPuntos /> : null}
      {pestana === "supervisores" ? <SeccionSupervisores /> : null}
      {pestana === "tipos" ? <SeccionTipos /> : null}
      {pestana === "usuarios" ? <SeccionUsuariosDashboard /> : null}
    </main>
  );
}
