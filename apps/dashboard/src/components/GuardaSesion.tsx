"use client";

// Guard de rutas + barra de usuario, montado en el layout raiz. La sesion vive
// en localStorage (no en cookie), asi que el guard es del lado del cliente: no
// se renderiza nada protegido hasta saber que hay sesion, para no mostrar un
// destello del panel a quien no inicio sesion.

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { cambiarPassword } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { useSesion } from "@/lib/SesionProvider";
import { ETIQUETA_ROL, rutaInicial, rutaPermitida, type RolDashboard } from "@/lib/sesion";

// Rutas que no exigen sesion del panel: el login y /faia (que tiene su propio
// login por PIN para empleados de FAIA).
const RUTAS_PUBLICAS = ["/login", "/faia"];

const CLAVE_LOGO_ANIMADO = "logo-animado";

const esPublica = (ruta: string) => RUTAS_PUBLICAS.some((r) => ruta === r || ruta.startsWith(`${r}/`));

export const COLOR_ROL: Record<RolDashboard, string> = {
  admin: "border-ok/50 text-ok-fg",
  supervisor: "border-info/40 text-info",
  consulta: "border-line-strong text-muted",
};

export function GuardaSesion({ children }: { children: ReactNode }) {
  const { listo, sesion } = useSesion();
  const pathname = usePathname();
  const router = useRouter();
  const publica = esPublica(pathname);

  useEffect(() => {
    if (!listo || publica || sesion) return;
    const siguiente = pathname && pathname !== "/" ? `?siguiente=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${siguiente}`);
  }, [listo, publica, sesion, pathname, router]);

  // Area: si la ruta no corresponde al area del usuario, se lo lleva a su
  // primera pagina permitida (ej. traslados -> /traslados).
  const permitida = publica || !sesion || rutaPermitida(sesion.usuario, pathname);
  useEffect(() => {
    if (!permitida && sesion) router.replace(rutaInicial(sesion.usuario));
  }, [permitida, sesion, router]);

  if (publica) return <>{children}</>;

  if (!listo || !sesion || !permitida) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy>
        <div className="h-2 w-24 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }

  return (
    <>
      <BarraUsuario />
      {children}
    </>
  );
}

// Enlaces del menu principal. `soloAdmin` replica la misma regla que ya usaba
// la portada (Planificacion de turnos y Administracion solo para admin).
type EnlaceNav = { href: string; etiqueta: string; soloAdmin?: boolean };

// "Entregas" es la pagina principal (el antiguo "Hoy" se fusiono con ella).
const ENLACE_ENTREGAS: EnlaceNav = { href: "/entregas", etiqueta: "Entregas" };
const ENLACE_TRASLADOS: EnlaceNav = { href: "/traslados", etiqueta: "Traslados" };
const ENLACE_ADMIN: EnlaceNav = { href: "/creador", etiqueta: "Administración", soloAdmin: true };

// Grupo desplegable "Análisis": consultas de lectura y planificación.
const ENLACES_ANALISIS: EnlaceNav[] = [
  { href: "/ranking", etiqueta: "Ranking" },
  { href: "/turnos", etiqueta: "Turnos", soloAdmin: true },
  { href: "/productos", etiqueta: "Catálogo" },
];

const esActiva = (pathname: string, href: string) => pathname.startsWith(href);

// Clases comunes de los items de primer nivel: ocupan todo el alto de la barra y
// la marca de activo es una linea de 2px azul en el borde inferior (sin pildora).
// El anillo de foco va hacia adentro (offset negativo) para que el overflow del
// contenedor del menu no lo recorte.
const CLASE_ITEM_NAV =
  "relative flex h-full min-h-11 items-center px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-offset-[-2px] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full";

const claseItemNav = (activo: boolean) =>
  `${CLASE_ITEM_NAV} ${
    activo ? "text-ink after:bg-brand-gold" : "text-muted after:bg-transparent hover:text-ink hover:after:bg-line-strong"
  }`;

const ANCHO_PANEL_ANALISIS = 192; // w-48

// Menu desplegable accesible. El panel se posiciona con `fixed` (coordenadas
// tomadas del boton al abrir) y no con `absolute`: el <nav> tiene
// overflow-x-auto para el scroll horizontal en movil, y eso recortaria (o
// agregaria scroll vertical a) cualquier hijo absoluto. El header ya no tiene
// backdrop-filter, asi que `fixed` se calcula contra el viewport.
function MenuAnalisis({ enlaces }: { enlaces: EnlaceNav[] }) {
  const pathname = usePathname();
  const idPanel = useId();
  // Se guarda la ruta en la que se abrio: el menu se cierra solo al navegar
  // (la ruta deja de coincidir) sin necesidad de un efecto.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const abierto = abiertoEn === pathname;
  const activo = enlaces.some((e) => esActiva(pathname, e.href));

  const abrir = () => {
    const r = boton.current?.getBoundingClientRect();
    if (r) {
      const maxLeft = window.innerWidth - ANCHO_PANEL_ANALISIS - 8;
      setPos({ left: Math.max(8, Math.min(r.left, maxLeft)), top: r.bottom + 4 });
    }
    setAbiertoEn(pathname);
  };

  useEffect(() => {
    if (!abierto) return;
    const alTecla = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") {
        setAbiertoEn(null);
        boton.current?.focus();
      }
    };
    const alPulsar = (ev: PointerEvent) => {
      const destino = ev.target as Node;
      if (boton.current?.contains(destino) || panel.current?.contains(destino)) return;
      setAbiertoEn(null);
    };
    // Si cambia el viewport las coordenadas fijas quedan viejas: se cierra en
    // lugar de recalcular.
    const alCerrar = () => setAbiertoEn(null);
    document.addEventListener("keydown", alTecla);
    document.addEventListener("pointerdown", alPulsar);
    window.addEventListener("resize", alCerrar);
    return () => {
      document.removeEventListener("keydown", alTecla);
      document.removeEventListener("pointerdown", alPulsar);
      window.removeEventListener("resize", alCerrar);
    };
  }, [abierto]);

  const itemsPanel = () => Array.from(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);

  // Flechas arriba/abajo recorren los items del panel; Tab sigue funcionando.
  const alTeclaPanel = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const items = itemsPanel();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const sig = ev.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    ev.preventDefault();
    items[sig]?.focus();
  };

  return (
    <li
      className="flex"
      // Si el foco sale del grupo con Tab, el panel se cierra.
      onBlur={(ev) => {
        if (abierto && !ev.currentTarget.contains(ev.relatedTarget as Node | null)) setAbiertoEn(null);
      }}
    >
      <button
        ref={boton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={() => (abierto ? setAbiertoEn(null) : abrir())}
        onKeyDown={(ev) => {
          if (ev.key === "ArrowDown" && !abierto) {
            ev.preventDefault();
            abrir();
            requestAnimationFrame(() => itemsPanel()[0]?.focus());
          }
        }}
        className={`${claseItemNav(activo || abierto)} cursor-pointer gap-1`}
      >
        Análisis
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 transition-transform duration-150 ${abierto ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {abierto ? (
        <div
          ref={panel}
          id={idPanel}
          role="menu"
          aria-label="Análisis"
          onKeyDown={alTeclaPanel}
          style={{ left: pos.left, top: pos.top, width: ANCHO_PANEL_ANALISIS }}
          className="fixed z-50 flex flex-col rounded-lg border border-line bg-surface py-1 shadow-lg shadow-brand-night/10"
        >
          {enlaces.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              role="menuitem"
              aria-current={esActiva(pathname, e.href) ? "page" : undefined}
              className={`flex min-h-11 items-center border-l-2 px-3 text-sm font-medium transition-colors duration-150 hover:bg-surface-2 ${
                esActiva(pathname, e.href) ? "border-brand-blue text-ink" : "border-transparent text-soft"
              }`}
            >
              {e.etiqueta}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function BarraUsuario() {
  const { usuario, logout, esAdmin } = useSesion();
  const pathname = usePathname();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  // El logo se anima solo la primera vez que se muestra en la sesion del
  // navegador (no en cada cambio de ruta). Si sessionStorage falla, queda estatico.
  const [animarLogo] = useState(() => {
    try {
      return window.sessionStorage.getItem(CLAVE_LOGO_ANIMADO) !== "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(CLAVE_LOGO_ANIMADO, "1");
    } catch {
      // Sin almacenamiento: el logo simplemente no se anima.
    }
  }, []);
  if (!usuario) return null;

  // Misma regla de antes: oculta lo que el usuario no puede abrir.
  const visible = (e: EnlaceNav) => (!e.soloAdmin || esAdmin) && rutaPermitida(usuario, e.href);
  const enlacesAnalisis = ENLACES_ANALISIS.filter(visible);
  const enlaceSimple = (e: EnlaceNav) =>
    visible(e) ? (
      <li key={e.href} className="flex">
        <Link
          href={e.href}
          aria-current={esActiva(pathname, e.href) ? "page" : undefined}
          className={claseItemNav(esActiva(pathname, e.href))}
        >
          {e.etiqueta}
        </Link>
      </li>
    ) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-stretch gap-3 px-4 sm:px-6">
        <Link
          href="/entregas"
          className="flex shrink-0 items-center rounded-md"
          aria-label="Panel de despachos, El Imperio"
        >
          <Logo tamano="compacto" animado={animarLogo} />
        </Link>

        {/* En movil el menu hace scroll horizontal dentro de su propio
            contenedor, sin ensanchar la pagina. El desplegable de Análisis es
            `fixed`, asi que este overflow no lo recorta. */}
        <nav aria-label="Principal" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <ul className="flex h-full w-max items-stretch gap-1">
            {enlaceSimple(ENLACE_ENTREGAS)}
            {enlaceSimple(ENLACE_TRASLADOS)}
            {enlacesAnalisis.length > 0 ? <MenuAnalisis enlaces={enlacesAnalisis} /> : null}
            {enlaceSimple(ENLACE_ADMIN)}
          </ul>
        </nav>

        <div className="relative flex shrink-0 items-center">
          <button
            onClick={() => setMenuAbierto((a) => !a)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            aria-label="Menú de usuario"
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-soft transition-colors duration-150 hover:bg-surface-2"
          >
            <span className="hidden font-medium sm:inline">{usuario.nombre}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${COLOR_ROL[usuario.rol]}`}>
              {ETIQUETA_ROL[usuario.rol]}
            </span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 text-subtle"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {menuAbierto ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuAbierto(false)} />
              <div
                role="menu"
                className="absolute right-0 z-50 mt-1 flex w-52 flex-col rounded-lg border border-line bg-surface py-1 shadow-lg shadow-brand-night/10"
              >
                <p className="truncate px-3 py-1.5 text-[11px] text-muted">
                  {usuario.nombre} · @{usuario.usuario}
                </p>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false);
                    setCambiando(true);
                  }}
                  className="min-h-11 cursor-pointer px-3 text-left text-sm text-soft transition-colors duration-150 hover:bg-surface-2"
                >
                  Cambiar contraseña
                </button>
                <button
                  role="menuitem"
                  onClick={logout}
                  className="min-h-11 cursor-pointer px-3 text-left text-sm text-soft transition-colors duration-150 hover:bg-surface-2"
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {/* Portal al body: el modal no debe depender del contexto de apilamiento
          (sticky + z-30) del header para quedar centrado sobre toda la pantalla. */}
      {cambiando ? createPortal(<ModalCambiarPassword onCerrar={() => setCambiando(false)} />, document.body) : null}
    </header>
  );
}

const INPUT =
  "rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink [color-scheme:dark]";

function ModalCambiarPassword({ onCerrar }: { onCerrar: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (nueva.length < 8) return setError("La contraseña nueva debe tener al menos 8 caracteres.");
    if (nueva !== confirmar) return setError("La confirmación no coincide con la contraseña nueva.");
    setError(null);
    setEnviando(true);
    try {
      await cambiarPassword(actual, nueva);
      toast.success("Contraseña actualizada");
      onCerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-night/40 px-4" onClick={onCerrar}>
      <form
        onSubmit={enviar}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-surface p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-ink">Cambiar contraseña</h3>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-muted">Contraseña actual</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-muted">Contraseña nueva (mínimo 8 caracteres)</span>
          <input
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-muted">Confirmar contraseña nueva</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className={INPUT}
          />
        </label>
        {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-10 cursor-pointer rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-soft transition hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando || !actual || !nueva || !confirmar}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-brand-gold px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:bg-gold-hover disabled:opacity-50"
          >
            {enviando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </div>
      </form>
    </div>
  );
}
