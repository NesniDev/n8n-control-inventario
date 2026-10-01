"use client";

// Panel de solo lectura para el rol 'faia_viewer' (y supervisor/admin) --
// login liviano por PIN (mismo patron de dos pasos que apps/mobile/PantallaLogin.tsx:
// elegir sede -> elegir empleado -> PIN), pero SIN persistencia (no cookies,
// no localStorage): la sesion vive solo en memoria y se pierde al recargar.
// No es autenticacion real, es solo para no dejar la galeria de fotos FAIA
// abierta a cualquiera que entre a la URL.

import { useEffect, useState } from "react";
import { Icono } from "@/components/ui";
import {
  fetchEmpleados,
  fetchEntregasFaia,
  fetchSedes,
  loginConPin,
  type Empleado,
  type EmpleadoBasico,
  type EntregaFaia,
  type Sede,
} from "@/lib/api";

// Mismo criterio de acceso que aplica el backend en GET /entregas/faia --
// se repite aca para no pegarle al endpoint con un rol que va a rebotar
// igual, y para mostrar "Acceso denegado" en vez de un error de red.
const ROLES_PERMITIDOS = ["faia_viewer", "supervisor", "admin"];

type Paso = "sede" | "empleado" | "pin";

export default function FaiaPage() {
  const [paso, setPaso] = useState<Paso>("sede");

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [cargandoSedes, setCargandoSedes] = useState(true);
  const [errorSedes, setErrorSedes] = useState<string | null>(null);
  const [sedeElegida, setSedeElegida] = useState<Sede | null>(null);

  const [empleados, setEmpleados] = useState<EmpleadoBasico[]>([]);
  const [cargandoEmpleados, setCargandoEmpleados] = useState(false);
  const [errorEmpleados, setErrorEmpleados] = useState<string | null>(null);
  const [empleadoElegido, setEmpleadoElegido] = useState<EmpleadoBasico | null>(null);

  const [pin, setPin] = useState("");
  const [cargandoLogin, setCargandoLogin] = useState(false);
  const [errorLogin, setErrorLogin] = useState<string | null>(null);

  // Empleado autenticado -- solo en memoria (useState), se pierde al
  // refrescar la pagina. null mientras no haya login exitoso.
  const [sesion, setSesion] = useState<Empleado | null>(null);

  const [entregas, setEntregas] = useState<EntregaFaia[]>([]);
  const [cargandoEntregas, setCargandoEntregas] = useState(false);
  const [errorEntregas, setErrorEntregas] = useState<string | null>(null);

  // Fetch puro, sin resetear estado antes -- lo llama tanto el efecto de
  // montaje (donde cargandoSedes/errorSedes ya arrancan en su valor inicial
  // correcto) como "Reintentar" (que sí resetea primero, ver cargarSedes).
  const obtenerSedes = () => {
    fetchSedes()
      .then(setSedes)
      .catch((err) => setErrorSedes(err instanceof Error ? err.message : "No se pudieron cargar las sedes"))
      .finally(() => setCargandoSedes(false));
  };

  const cargarSedes = () => {
    setCargandoSedes(true);
    setErrorSedes(null);
    obtenerSedes();
  };

  // Una sola vez al montar -- no llama a cargarSedes (que hace un setState
  // sincronico) porque cargandoSedes/errorSedes ya arrancan en el valor
  // correcto para una primera carga (ver react-hooks/set-state-in-effect).
  useEffect(() => {
    obtenerSedes();
  }, []);

  const cargarEmpleados = (sede: Sede) => {
    setCargandoEmpleados(true);
    setErrorEmpleados(null);
    fetchEmpleados(sede.id)
      .then(setEmpleados)
      .catch((err) => setErrorEmpleados(err instanceof Error ? err.message : "No se pudieron cargar los empleados"))
      .finally(() => setCargandoEmpleados(false));
  };

  const elegirSede = (sede: Sede) => {
    setSedeElegida(sede);
    setEmpleadoElegido(null);
    setPaso("empleado");
    cargarEmpleados(sede);
  };

  const elegirEmpleado = (empleado: EmpleadoBasico) => {
    setEmpleadoElegido(empleado);
    setPaso("pin");
  };

  const volverASedes = () => {
    setPaso("sede");
    setEmpleadoElegido(null);
    setPin("");
    setErrorLogin(null);
  };

  const volverAEmpleados = () => {
    setPaso("empleado");
    setPin("");
    setErrorLogin(null);
  };

  const cargarEntregas = (empleadoId: string) => {
    setCargandoEntregas(true);
    setErrorEntregas(null);
    fetchEntregasFaia(empleadoId)
      .then(setEntregas)
      .catch((err) => setErrorEntregas(err instanceof Error ? err.message : "No se pudieron cargar los documentos"))
      .finally(() => setCargandoEntregas(false));
  };

  const ingresar = async () => {
    if (!empleadoElegido || pin.length < 4) return;
    setCargandoLogin(true);
    setErrorLogin(null);
    try {
      const empleado = await loginConPin(pin, empleadoElegido.id);
      setSesion(empleado);
      if (ROLES_PERMITIDOS.includes(empleado.rol)) {
        cargarEntregas(empleado.id);
      }
    } catch (err) {
      setErrorLogin(err instanceof Error ? err.message : "PIN incorrecto");
      setPin("");
    } finally {
      setCargandoLogin(false);
    }
  };

  // Vuelve todo al paso "elegir sede" -- limpia la sesion en memoria, no hay
  // nada mas que borrar (sin cookies/localStorage de por medio).
  const cerrarSesion = () => {
    setSesion(null);
    setEntregas([]);
    setErrorEntregas(null);
    setSedeElegida(null);
    setEmpleadoElegido(null);
    setPin("");
    setErrorLogin(null);
    setPaso("sede");
  };

  // --- Sesion activa: acceso denegado o galeria ---
  if (sesion) {
    if (!ROLES_PERMITIDOS.includes(sesion.rol)) {
      return (
        <main className="mx-auto flex w-full flex-1 max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <h1 className="text-xl font-semibold text-danger-fg">Acceso denegado</h1>
          <p className="text-sm text-muted">
            Tu usuario ({sesion.nombre}) no tiene permiso para ver los documentos FAIA.
          </p>
          <button
            onClick={cerrarSesion}
            className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft hover:bg-surface-2"
          >
            Volver
          </button>
        </main>
      );
    }

    return (
      <main className="mx-auto flex w-full flex-1 max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">FAIA · solo lectura</p>
            <h1 className="text-2xl font-semibold text-ink">Documentos FAIA</h1>
            <p className="text-sm text-muted">
              Conectado como <span className="text-ink">{sesion.nombre}</span>
            </p>
          </div>
          <button
            onClick={cerrarSesion}
            className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft hover:bg-surface-2"
          >
            Cerrar sesión
          </button>
        </header>

        {errorEntregas ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-danger-fg">
            {errorEntregas}
          </div>
        ) : null}

        {cargandoEntregas ? (
          <p className="text-sm text-muted">Cargando documentos...</p>
        ) : entregas.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay documentos marcados FAIA.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entregas.map((entrega) => (
              <a
                key={entrega.id}
                href={entrega.evidencia_url}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 transition hover:border-brand-gold/60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- fotos
                    vienen de Supabase Storage, no del dominio de Next (mismo
                    criterio que ModalDetalleEntrega en app/page.tsx). */}
                <img
                  src={entrega.evidencia_url}
                  alt={`${entrega.tipo} ${entrega.indicativo_numero}`}
                  className="h-40 w-full rounded-md border border-line object-cover"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">
                    {entrega.tipo} {entrega.indicativo_numero}
                  </span>
                  <span className="text-xs text-muted">
                    {entrega.sede_origen_nombre ?? entrega.sede_origen_id}
                  </span>
                  <span className="text-xs text-muted">
                    Facturado por: {entrega.operador_nombre ?? "—"}
                  </span>
                  <span className="text-xs text-subtle">
                    {entrega.capturado_at ? new Date(entrega.capturado_at).toLocaleString() : "—"}
                  </span>
                </div>
                <span className="text-xs text-brand-gold opacity-0 transition group-hover:opacity-100">
                  Ver foto completa<Icono nombre="externo" />
                </span>
              </a>
            ))}
          </div>
        )}
      </main>
    );
  }

  // --- Login: elegir sede -> elegir empleado -> PIN ---
  return (
    <main className="mx-auto flex w-full flex-1 max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="flex flex-col gap-1 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Control logístico · FAIA</p>
        <h1 className="text-2xl font-semibold text-ink">Acceso a documentos FAIA</h1>
      </header>

      {paso === "sede" ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-sm font-medium text-ink">Elegí tu sede</h2>
          {cargandoSedes ? (
            <p className="text-sm text-muted">Cargando sedes...</p>
          ) : errorSedes ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-danger-fg">{errorSedes}</p>
              <button
                onClick={cargarSedes}
                className="self-start rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft hover:bg-surface-2"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {sedes.map((sede) => (
                <button
                  key={sede.id}
                  onClick={() => elegirSede(sede)}
                  className="rounded-md border border-line-strong bg-surface px-3 py-3 text-sm font-medium text-ink hover:border-brand-gold/60 hover:bg-surface-2"
                >
                  {sede.nombre}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {paso === "empleado" ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">¿Quién sos? · {sedeElegida?.nombre}</h2>
            <button onClick={volverASedes} className="text-xs text-muted hover:text-ink">
              <Icono nombre="izquierda" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />Cambiar sede
            </button>
          </div>
          {cargandoEmpleados ? (
            <p className="text-sm text-muted">Cargando empleados...</p>
          ) : errorEmpleados ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-danger-fg">{errorEmpleados}</p>
              <button
                onClick={() => sedeElegida && cargarEmpleados(sedeElegida)}
                className="self-start rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft hover:bg-surface-2"
              >
                Reintentar
              </button>
            </div>
          ) : empleados.length === 0 ? (
            <p className="text-sm text-muted">No hay empleados activos en esta sede.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {empleados.map((empleado) => (
                <button
                  key={empleado.id}
                  onClick={() => elegirEmpleado(empleado)}
                  className="flex items-center justify-between rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink hover:border-brand-gold/60 hover:bg-surface-2"
                >
                  {empleado.nombre}
                  <Icono nombre="derecha" className="h-4 w-4" />
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {paso === "pin" && empleadoElegido ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Hola, {empleadoElegido.nombre}</h2>
            <button onClick={volverAEmpleados} className="text-xs text-muted hover:text-ink">
              <Icono nombre="izquierda" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />Cambiar
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            PIN
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 6));
                setErrorLogin(null);
              }}
              maxLength={6}
              autoFocus
              placeholder="••••"
              onKeyDown={(e) => e.key === "Enter" && ingresar()}
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-center text-lg tracking-[0.5em] text-ink"
            />
          </label>
          {errorLogin ? <p className="text-xs text-danger-fg">{errorLogin}</p> : null}
          <button
            onClick={ingresar}
            disabled={pin.length < 4 || cargandoLogin}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-brand-gold px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-gold-hover disabled:opacity-50"
          >
            {cargandoLogin ? "Ingresando..." : "Ingresar"}
          </button>
        </section>
      ) : null}
    </main>
  );
}
