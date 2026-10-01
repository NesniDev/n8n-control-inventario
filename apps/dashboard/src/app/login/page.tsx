"use client";

// Login del panel (usuario + contraseña, ver POST /dashboard/auth/login).
// Distinto del login por PIN de /faia, que es para empleados de FAIA.

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSesion } from "@/lib/SesionProvider";

// Solo rutas internas: evita redirigir a otro sitio con ?siguiente=//evil.com.
function destinoSeguro(siguiente: string | null): string {
  if (!siguiente || !siguiente.startsWith("/") || siguiente.startsWith("//") || siguiente.startsWith("/login")) {
    return "/";
  }
  return siguiente;
}

function FormularioLogin() {
  const { listo, sesion, login } = useSesion();
  const router = useRouter();
  const params = useSearchParams();
  const expirada = params.get("expirada") === "1";
  const destino = destinoSeguro(params.get("siguiente"));

  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ya hay sesion (recien iniciada o abierta en otra pestaña): se sigue al panel.
  useEffect(() => {
    if (listo && sesion) router.replace(destino);
  }, [listo, sesion, destino, router]);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(usuario, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      setEnviando(false);
    }
  };

  return (
    <main className="relative flex w-full flex-1 items-center justify-center overflow-hidden px-4 py-10">
      {/* Brillo calido muy tenue detras de la tarjeta. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.10] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--color-brand-gold), transparent 70%)" }}
      />
      <div className="relative flex w-full max-w-sm flex-col gap-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gold text-lg font-bold text-brand-ink"
        >
          EI
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-gold">El Imperio · Panel de Despachos</p>
        <h1 className="text-2xl font-semibold text-ink">Iniciar sesión</h1>
        <p className="text-sm text-muted">Ingresa con tu usuario y contraseña del panel.</p>
      </header>

      {expirada ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warn">
          Tu sesión expiró. Inicia sesión de nuevo.
        </div>
      ) : null}

      <form
        onSubmit={enviar}
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Usuario</span>
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Contraseña</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink [color-scheme:dark]"
          />
        </label>
        {error ? (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={enviando || !usuario.trim() || !password}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md bg-brand-gold px-3 py-2 text-sm font-semibold text-brand-ink transition hover:bg-gold-hover disabled:opacity-50"
        >
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <FormularioLogin />
    </Suspense>
  );
}
