"use client";

// Guard de rutas + barra de usuario, montado en el layout raiz. La sesion vive
// en localStorage (no en cookie), asi que el guard es del lado del cliente: no
// se renderiza nada protegido hasta saber que hay sesion, para no mostrar un
// destello del panel a quien no inicio sesion.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
      {children}
    </>
  );
}

// Enlaces del menu principal. `soloAdmin` replica la misma regla que ya usaba
// la portada (Planificacion de turnos y Administracion solo para admin).
const ENLACES_NAV: { href: string; etiqueta: string; soloAdmin?: boolean }[] = [
  { href: "/", etiqueta: "Panel" },
  { href: "/productos", etiqueta: "Catálogo" },
  { href: "/ranking", etiqueta: "Ranking" },
  { href: "/turnos", etiqueta: "Turnos", soloAdmin: true },
  { href: "/creador", etiqueta: "Administración", soloAdmin: true },
];

function BarraUsuario() {
  const { usuario, logout, esAdmin } = useSesion();
  const pathname = usePathname();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  if (!usuario) return null;

  const activo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-brand-night/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-2 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="El Imperio, panel de despachos">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-gold text-sm font-bold text-brand-ink"
          >
            EI
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold text-ink">El Imperio</span>
            <span className="text-[11px] text-muted">Panel de Despachos</span>
          </span>
        </Link>

        {/* En movil el menu hace scroll horizontal dentro de su propio
            contenedor, sin ensanchar la pagina. */}
        <nav aria-label="Principal" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <ul className="flex w-max items-center gap-1">
            {ENLACES_NAV.filter((e) => !e.soloAdmin || esAdmin).map((e) => (
              <li key={e.href}>
                <Link
                  href={e.href}
                  aria-current={activo(e.href) ? "page" : undefined}
                  className={`flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150 ${
                    activo(e.href)
                      ? "bg-surface-2 text-brand-gold"
                      : "text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  {e.etiqueta}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuAbierto((a) => !a)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            aria-label="Menú de usuario"
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-soft transition-colors duration-150 hover:bg-surface"
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
                className="absolute right-0 z-50 mt-1 flex w-52 flex-col rounded-lg border border-line bg-surface py-1 shadow-xl shadow-black/40"
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
                  className="min-h-10 cursor-pointer px-3 text-left text-sm text-soft transition-colors duration-150 hover:bg-surface-2"
                >
                  Cambiar contraseña
                </button>
                <button
                  role="menuitem"
                  onClick={logout}
                  className="min-h-10 cursor-pointer px-3 text-left text-sm text-soft transition-colors duration-150 hover:bg-surface-2"
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {cambiando ? <ModalCambiarPassword onCerrar={() => setCambiando(false)} /> : null}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/80 backdrop-blur-sm px-4" onClick={onCerrar}>
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
        {error ? <p className="text-xs text-danger">{error}</p> : null}
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
