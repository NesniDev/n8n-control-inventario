"use client";

// Guard de rutas + navegacion lateral, montado en el layout raiz. La sesion vive
// en localStorage (no en cookie), asi que el guard es del lado del cliente: no
// se renderiza nada protegido hasta saber que hay sesion, para no mostrar un
// destello del panel a quien no inicio sesion.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { cambiarPassword } from "@/lib/api";
import { useSesion } from "@/lib/SesionProvider";
import { ETIQUETA_ROL, type RolDashboard } from "@/lib/sesion";

// Rutas que no exigen sesion del panel: el login y /faia (que tiene su propio
// login por PIN para empleados de FAIA).
const RUTAS_PUBLICAS = ["/login", "/faia"];

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

  if (publica) return <>{children}</>;

  if (!listo || !sesion) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy>
        <div className="h-2 w-24 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }

  return (
    <>
      <BarraUsuario />
      {/* En lg+ el contenido deja sitio a la barra lateral fija (w-60). */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">{children}</div>
    </>
  );
}

// Enlaces del menu principal. `soloAdmin` replica la misma regla que ya usaba
// la portada (Planificacion de turnos y Administracion solo para admin).
type NombreIconoNav = "panel" | "catalogo" | "ranking" | "turnos" | "admin";

const ENLACES_NAV: { href: string; etiqueta: string; icono: NombreIconoNav; soloAdmin?: boolean }[] = [
  { href: "/", etiqueta: "Panel", icono: "panel" },
  { href: "/productos", etiqueta: "Catálogo", icono: "catalogo" },
  { href: "/ranking", etiqueta: "Ranking", icono: "ranking" },
  { href: "/turnos", etiqueta: "Turnos", icono: "turnos", soloAdmin: true },
  { href: "/creador", etiqueta: "Administración", icono: "admin", soloAdmin: true },
];

// Trazos de los iconos de la navegacion (estilo Lucide, currentColor).
const RUTAS_NAV = {
  panel: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  catalogo:
    "m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7 12 12l8.7-5M12 22V12",
  ranking: "M12 20V10M18 20V4M6 20v-4",
  turnos: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  admin: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  menu: "M4 6h16M4 12h16M4 18h16",
  cerrar: "M18 6 6 18M6 6l12 12",
  salir: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  llave: "m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3M7.5 10.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z",
} as const;

function IconoNav({ nombre, className = "h-[18px] w-[18px]" }: { nombre: keyof typeof RUTAS_NAV; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={RUTAS_NAV[nombre]} />
    </svg>
  );
}

function Marca() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-3 rounded-md" aria-label="El Imperio, panel de despachos">
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gold text-sm font-bold text-brand-ink"
      >
        EI
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-ink">El Imperio</span>
        <span className="text-[11px] text-muted">Panel de Despachos</span>
      </span>
    </Link>
  );
}

// Contenido compartido por la barra lateral (lg+) y el cajon movil: marca,
// enlaces y, abajo, el usuario con sus acciones.
function ContenidoNav({
  onNavegar,
  onCambiarPassword,
  onCerrar,
}: {
  onNavegar?: () => void;
  onCambiarPassword: () => void;
  onCerrar?: () => void;
}) {
  const { usuario, logout, esAdmin } = useSesion();
  const pathname = usePathname();
  if (!usuario) return null;

  const activo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-4 pt-5">
        <Marca />
        {onCerrar ? (
          <button
            onClick={onCerrar}
            aria-label="Cerrar menú"
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            <IconoNav nombre="cerrar" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-1">
          {ENLACES_NAV.filter((e) => !e.soloAdmin || esAdmin).map((e) => (
            <li key={e.href}>
              <Link
                href={e.href}
                onClick={onNavegar}
                aria-current={activo(e.href) ? "page" : undefined}
                className={`relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                  activo(e.href) ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink"
                }`}
              >
                {activo(e.href) ? (
                  <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-brand-gold" />
                ) : null}
                <IconoNav nombre={e.icono} className={`h-[18px] w-[18px] ${activo(e.href) ? "text-brand-gold" : ""}`} />
                {e.etiqueta}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-1 border-t border-line p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-xs font-semibold uppercase text-soft"
          >
            {usuario.nombre.slice(0, 1)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-ink">{usuario.nombre}</span>
            <span className="truncate text-[11px] text-muted">@{usuario.usuario}</span>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${COLOR_ROL[usuario.rol]}`}>
            {ETIQUETA_ROL[usuario.rol]}
          </span>
        </div>
        <button
          onClick={() => {
            onNavegar?.();
            onCambiarPassword();
          }}
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-left text-sm text-soft transition-colors duration-150 hover:bg-surface-2"
        >
          <IconoNav nombre="llave" className="h-4 w-4 text-muted" />
          Cambiar contraseña
        </button>
        <button
          onClick={logout}
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-left text-sm text-soft transition-colors duration-150 hover:bg-surface-2"
        >
          <IconoNav nombre="salir" className="h-4 w-4 text-muted" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function BarraUsuario() {
  const { usuario } = useSesion();
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const panelCajon = useRef<HTMLDivElement>(null);

  // Cajon movil: Esc cierra, el foco entra al panel y vuelve al boton al cerrar.
  useEffect(() => {
    if (!cajonAbierto) return;
    const boton = botonMenu.current;
    const panel = panelCajon.current;
    panel?.focus();
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setCajonAbierto(false);
    };
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      // Solo se devuelve el foco si nadie lo tomo (p. ej. el modal de contraseña).
      const activo = document.activeElement;
      if (!activo || activo === document.body || panel?.contains(activo)) boton?.focus();
    };
  }, [cajonAbierto]);

  if (!usuario) return null;

  return (
    <>
      {/* lg+: barra lateral fija. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface lg:block">
        <ContenidoNav onCambiarPassword={() => setCambiando(true)} />
      </aside>

      {/* < lg: barra superior compacta con boton de menu. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 lg:hidden">
        <Marca />
        <button
          ref={botonMenu}
          onClick={() => setCajonAbierto((a) => !a)}
          aria-label="Abrir menú de navegación"
          aria-expanded={cajonAbierto}
          aria-controls="cajon-navegacion"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-line-strong text-soft transition-colors duration-150 hover:bg-surface-2"
        >
          <IconoNav nombre="menu" />
        </button>
      </header>

      {cajonAbierto ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden
            onClick={() => setCajonAbierto(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <div
            id="cajon-navegacion"
            ref={panelCajon}
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            tabIndex={-1}
            className="animate-deslizar absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface outline-none"
          >
            <ContenidoNav
              onNavegar={() => setCajonAbierto(false)}
              onCerrar={() => setCajonAbierto(false)}
              onCambiarPassword={() => setCambiando(true)}
            />
          </div>
        </div>
      ) : null}

      {cambiando ? <ModalCambiarPassword onCerrar={() => setCambiando(false)} /> : null}
    </>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onCerrar}>
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
            className="min-h-10 cursor-pointer rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-xs font-medium text-soft transition hover:text-ink"
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
