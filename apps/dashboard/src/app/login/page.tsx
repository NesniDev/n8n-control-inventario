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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Control logístico · multi-sede</p>
        <h1 className="text-2xl font-semibold text-neutral-100">Iniciar sesión</h1>
        <p className="text-sm text-neutral-400">Ingresa con tu usuario y contraseña del panel.</p>
      </header>

      {expirada ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Tu sesión expiró. Inicia sesión de nuevo.
        </div>
      ) : null}

      <form
        onSubmit={enviar}
        className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-neutral-500">Usuario</span>
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] leading-none text-neutral-500">Contraseña</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 [color-scheme:dark]"
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
          className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:opacity-50"
        >
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
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
