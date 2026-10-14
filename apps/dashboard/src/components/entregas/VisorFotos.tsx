"use client";

import { useCallback, useEffect, useState } from "react";
import { Icono } from "@/components/ui";

export type FotoVisor = { url: string; etiqueta: string };

// Visor de las fotos de un documento: imagen grande ajustada (object-contain)
// sobre fondo oscuro, tira de miniaturas si hay varias, navegacion con
// botones y flechas izquierda/derecha, y enlace para abrir el original.
// `teclado` permite apagar las flechas mientras hay otro dialogo encima.
export function VisorFotos({ fotos, teclado = true }: { fotos: FotoVisor[]; teclado?: boolean }) {
  const [indice, setIndice] = useState(0);
  // Estado de carga por url: sin entrada = cargando.
  const [estados, setEstados] = useState<Record<string, "ok" | "error">>({});

  const total = fotos.length;
  const actual = fotos[Math.min(indice, Math.max(total - 1, 0))];
  const hayVarias = total > 1;

  const ir = useCallback(
    (delta: number) => setIndice((i) => (i + delta + total) % total),
    [total]
  );

  useEffect(() => {
    if (!hayVarias || !teclado) return;
    const alPresionarTecla = (ev: KeyboardEvent) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      // No robar las flechas a campos de texto ni a controles que las usan.
      const el = ev.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      ev.preventDefault();
      ir(ev.key === "ArrowLeft" ? -1 : 1);
    };
    document.addEventListener("keydown", alPresionarTecla);
    return () => document.removeEventListener("keydown", alPresionarTecla);
  }, [hayVarias, teclado, ir]);

  if (!actual) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-md border border-line bg-page p-6 text-sm text-muted">
        Este documento no tiene fotos.
      </div>
    );
  }

  const estado = estados[actual.url];
  const marcar = (url: string, valor: "ok" | "error") =>
    setEstados((prev) => (prev[url] === valor ? prev : { ...prev, [url]: valor }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-soft">
          {actual.etiqueta}
          {hayVarias ? <span className="text-muted"> · {indice + 1} de {total}</span> : null}
        </span>
        <a
          href={actual.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-xs font-medium text-info transition-colors duration-150 hover:bg-surface-2"
        >
          Abrir original
          <Icono nombre="externo" />
        </a>
      </div>

      <div className="relative flex min-h-72 flex-1 items-center justify-center overflow-hidden rounded-md border border-line bg-brand-night">
        {estado === "error" ? (
          <p className="max-w-xs px-6 text-center text-sm text-soft">
            No se pudo cargar la foto. Ábrela en una pestaña nueva.
          </p>
        ) : (
          <>
            {estado === undefined ? (
              <div aria-hidden className="absolute inset-0 animate-pulse bg-surface-2/40" />
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- fotos
                vienen de Supabase Storage, no del dominio de Next. */}
            <img
              key={actual.url}
              ref={(img) => {
                // Imagen ya en cache: el onLoad pudo dispararse antes de montar.
                if (img && img.complete && img.naturalWidth > 0) marcar(actual.url, "ok");
              }}
              src={actual.url}
              alt={actual.etiqueta}
              onLoad={() => marcar(actual.url, "ok")}
              onError={() => marcar(actual.url, "error")}
              className={`max-h-full max-w-full object-contain transition-opacity duration-150 ${
                estado === "ok" ? "opacity-100" : "opacity-0"
              }`}
            />
          </>
        )}

        {hayVarias ? (
          <>
            <button
              type="button"
              onClick={() => ir(-1)}
              aria-label="Foto anterior"
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-line bg-surface/90 text-ink transition-colors duration-150 hover:bg-surface-2"
            >
              <Icono nombre="izquierda" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => ir(1)}
              aria-label="Foto siguiente"
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-line bg-surface/90 text-ink transition-colors duration-150 hover:bg-surface-2"
            >
              <Icono nombre="derecha" className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      {hayVarias ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotos.map((foto, i) => (
            <button
              key={foto.url}
              type="button"
              onClick={() => setIndice(i)}
              aria-label={`Foto ${i + 1} de ${total}`}
              aria-current={i === indice ? "true" : undefined}
              className={`flex w-20 shrink-0 flex-col gap-1 rounded-md border p-1 text-left transition-colors duration-150 ${
                i === indice ? "border-brand-gold bg-surface-2" : "border-line hover:border-line-strong"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- ver nota arriba. */}
              <img src={foto.url} alt="" className="h-14 w-full rounded-sm bg-brand-night object-cover" />
              <span className="truncate text-[11px] text-muted">{foto.etiqueta}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
