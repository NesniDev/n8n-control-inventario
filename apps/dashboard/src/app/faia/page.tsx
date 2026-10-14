"use client";

// Panel de solo lectura para el rol 'faia_viewer' (y supervisor/admin) --
// login liviano por PIN (mismo patron de dos pasos que apps/mobile/PantallaLogin.tsx:
// elegir sede -> elegir empleado -> PIN), pero SIN persistencia (no cookies,
// no localStorage): la sesion vive solo en memoria y se pierde al recargar.
// No es autenticacion real, es solo para no dejar la galeria de fotos FAIA
// abierta a cualquiera que entre a la URL.

import { useEffect, useState } from "react";
import { claseBoton, EncabezadoPagina, Icono } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { Folio } from "@/components/entregas/Folio";
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
// se repite aqui para no pegarle al endpoint con un rol que va a rebotar
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
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-10">
          <h1 className="titular text-[28px] leading-tight text-danger-fg">Acceso denegado</h1>
          <p className="text-sm text-muted">
            Tu usuario ({sesion.nombre}) no tiene permiso para ver los documentos FAIA. Pide a un supervisor que te
            habilite o entra con otro usuario.
          </p>
          <button onClick={cerrarSesion} className={claseBoton("secundario", "self-start")}>
            Volver
          </button>
        </main>
      );
    }

    return (
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <EncabezadoPagina
          titulo="Documentos FAIA"
          descripcion={
            <>
              Consulta las fotos de los documentos marcados FAIA. Conectado como{" "}
              <span className="font-medium text-ink">{sesion.nombre}</span>.
            </>
          }
          acciones={
            <button onClick={cerrarSesion} className={claseBoton("secundario")}>
              Cerrar sesión
            </button>
          }
        />

        {errorEntregas ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger-fg">
            {errorEntregas}
          </div>
        ) : null}

        {cargandoEntregas ? (
          <p className="text-sm text-muted">Cargando documentos...</p>
        ) : entregas.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay documentos marcados FAIA.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {entregas.map((entrega) => (
              <li key={entrega.id} className="bg-surface">
                <a
                  href={entrega.evidencia_url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex h-full flex-col gap-3 p-4 transition-colors duration-150 hover:bg-surface-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- fotos
                      vienen de Supabase Storage, no del dominio de Next (mismo
                      criterio que ModalDetalleEntrega). */}
                  <img
                    src={entrega.evidencia_url}
                    alt={`${entrega.tipo} ${entrega.indicativo_numero}`}
                    className="h-40 w-full rounded-md border border-line object-cover"
                  />
                  <div className="flex flex-col gap-1">
                    <Folio tipo={entrega.tipo} numero={entrega.indicativo_numero} />
                    <span className="text-sm text-soft">{entrega.sede_origen_nombre ?? entrega.sede_origen_id}</span>
                    <span className="text-xs text-muted">Facturado por: {entrega.operador_nombre ?? "—"}</span>
                    <span className="text-xs text-subtle">
                      {entrega.capturado_at ? new Date(entrega.capturado_at).toLocaleString() : "—"}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-info group-hover:underline">
                    Ver foto completa
                    <Icono nombre="externo" />
                    <span className="sr-only"> (se abre en una pestaña nueva)</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  // --- Login: elegir sede -> elegir empleado -> PIN ---
  const claseFila =
    "flex min-h-11 items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2";
  const claseVolver =
    "inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-3">
        <Logo tamano="grande" animado className="self-center" />
        <div className="mt-2 flex flex-col gap-1 text-center">
          <h1 className="titular text-[22px] leading-tight text-ink">Documentos FAIA</h1>
          <p className="text-sm text-muted">Elige tu sede, tu nombre y escribe tu PIN para ver los documentos.</p>
        </div>
      </header>

      <div className="rounded-lg border border-line bg-surface p-5">
        {paso === "sede" ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-ink">Elige tu sede</h2>
            {cargandoSedes ? (
              <p className="text-sm text-muted">Cargando sedes...</p>
            ) : errorSedes ? (
              <div role="alert" className="flex flex-col gap-2">
                <p className="text-sm text-danger-fg">{errorSedes}. Revisa tu conexión e inténtalo de nuevo.</p>
                <button onClick={cargarSedes} className={claseBoton("secundario", "self-start")}>
                  Reintentar
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {sedes.map((sede) => (
                  <button key={sede.id} onClick={() => elegirSede(sede)} className={claseFila}>
                    {sede.nombre}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {paso === "empleado" ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Elige tu nombre en {sedeElegida?.nombre}</h2>
              <button onClick={volverASedes} className={claseVolver}>
                <Icono nombre="izquierda" className="h-3.5 w-3.5" />
                Cambiar sede
              </button>
            </div>
            {cargandoEmpleados ? (
              <p className="text-sm text-muted">Cargando empleados...</p>
            ) : errorEmpleados ? (
              <div role="alert" className="flex flex-col gap-2">
                <p className="text-sm text-danger-fg">{errorEmpleados}. Revisa tu conexión e inténtalo de nuevo.</p>
                <button
                  onClick={() => sedeElegida && cargarEmpleados(sedeElegida)}
                  className={claseBoton("secundario", "self-start")}
                >
                  Reintentar
                </button>
              </div>
            ) : empleados.length === 0 ? (
              <p className="text-sm text-muted">No hay empleados activos en esta sede.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {empleados.map((empleado) => (
                  <button key={empleado.id} onClick={() => elegirEmpleado(empleado)} className={claseFila}>
                    {empleado.nombre}
                    <Icono nombre="derecha" className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {paso === "pin" && empleadoElegido ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Hola, {empleadoElegido.nombre}</h2>
              <button onClick={volverAEmpleados} className={claseVolver}>
                <Icono nombre="izquierda" className="h-3.5 w-3.5" />
                Cambiar nombre
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="faia-pin" className="text-sm font-medium text-soft">
                PIN (4 a 6 dígitos)
              </label>
              <input
                id="faia-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 6));
                  setErrorLogin(null);
                }}
                maxLength={6}
                autoFocus
                placeholder="••••"
                aria-invalid={errorLogin ? true : undefined}
                onKeyDown={(e) => e.key === "Enter" && ingresar()}
                className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-center text-lg tracking-[0.5em] text-ink"
              />
            </div>
            {errorLogin ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger-fg">
                {errorLogin}. Escribe el PIN de nuevo.
              </p>
            ) : null}
            <button
              onClick={ingresar}
              disabled={pin.length < 4 || cargandoLogin}
              className={claseBoton("primario", "min-h-11 w-full")}
            >
              {cargandoLogin ? "Entrando..." : "Entrar"}
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
