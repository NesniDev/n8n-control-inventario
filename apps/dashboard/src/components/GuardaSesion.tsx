"use client";

// Guard de rutas + barra de usuario, montado en el layout raiz. La sesion vive
// en localStorage (no en cookie), asi que el guard es del lado del cliente: no
// se renderiza nada protegido hasta saber que hay sesion, para no mostrar un
// destello del panel a quien no inicio sesion.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  admin: "border-emerald-500/30 text-emerald-400",
  supervisor: "border-sky-500/30 text-sky-400",
  consulta: "border-neutral-700 text-neutral-400",
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
        <div className="h-2 w-24 animate-pulse rounded bg-neutral-800" />
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

function BarraUsuario() {
  const { usuario, logout } = useSesion();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  if (!usuario) return null;

  return (
    <div className="border-b border-neutral-900 bg-neutral-950">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-end px-4 py-2 sm:px-6">
        <div className="relative">
          <button
            onClick={() => setMenuAbierto((a) => !a)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-neutral-300 transition hover:bg-neutral-900"
          >
            <span className="font-medium">{usuario.nombre}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${COLOR_ROL[usuario.rol]}`}>
              {ETIQUETA_ROL[usuario.rol]}
            </span>
            <span aria-hidden className="text-neutral-600">
              ▾
            </span>
          </button>
          {menuAbierto ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuAbierto(false)} />
              <div
                role="menu"
                className="absolute right-0 z-50 mt-1 flex w-48 flex-col rounded-lg border border-neutral-800 bg-neutral-900 py-1 shadow-lg"
              >
                <p className="truncate px-3 py-1.5 text-[11px] text-neutral-500">@{usuario.usuario}</p>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false);
                    setCambiando(true);
                  }}
                  className="px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Cambiar contraseña
                </button>
                <button
                  role="menuitem"
                  onClick={logout}
                  className="px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {cambiando ? <ModalCambiarPassword onCerrar={() => setCambiando(false)} /> : null}
    </div>
  );
}

const INPUT =
  "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 [color-scheme:dark]";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onCerrar}>
      <form
        onSubmit={enviar}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-neutral-100">Cambiar contraseña</h3>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-neutral-500">Contraseña actual</span>
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
          <span className="text-[10px] leading-none text-neutral-500">Contraseña nueva (mínimo 8 caracteres)</span>
          <input
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-neutral-500">Confirmar contraseña nueva</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className={INPUT}
          />
        </label>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando || !actual || !nueva || !confirmar}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white disabled:opacity-50"
          >
            {enviando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </div>
      </form>
    </div>
  );
}
