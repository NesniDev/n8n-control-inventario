"use client";

// Piezas de presentacion compartidas entre las pantallas del dashboard --
// mismo lenguaje visual definido en ranking/page.tsx (tarjetas oscuras,
// indicadores KPI, estados de carga/vacio/error). Sin logica de negocio: solo
// reciben datos ya resueltos por cada pagina. Extraido para no repetir el
// mismo marcado en productos/page.tsx y page.tsx.

import type { ReactNode } from "react";

// Indicador KPI -- rotulo con punto de color + valor grande + detalle chico.
// Identico al que tenia ranking/page.tsx antes de esta extraccion.
export function Indicador({
  etiqueta,
  valor,
  unidad,
  detalle,
  acento,
  cargando,
}: {
  etiqueta: string;
  valor: string;
  unidad?: string;
  detalle?: string;
  acento: string;
  cargando: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: acento }} aria-hidden />
        <span className="text-xs font-medium text-neutral-400">{etiqueta}</span>
      </div>
      {cargando ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="h-7 w-24 animate-pulse rounded bg-neutral-800" />
          <div className="h-3 w-40 animate-pulse rounded bg-neutral-800" />
        </div>
      ) : (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tabular-nums text-neutral-100">{valor}</span>
            {unidad ? <span className="text-xs text-neutral-500">{unidad}</span> : null}
          </p>
          <p className="truncate text-xs text-neutral-400" title={detalle}>
            {detalle ?? "Sin datos"}
          </p>
        </>
      )}
    </div>
  );
}

// Caja de error roja con boton "Reintentar" -- pensada para colgar de
// `mutate` de SWR (o cualquier otro callback de recarga).
export function ErrorConReintento({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <span>{mensaje}</span>
      <button
        onClick={onReintentar}
        className="rounded-md border border-red-400/40 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20"
      >
        Reintentar
      </button>
    </div>
  );
}

// Estado vacio centrado de dos lineas -- titulo + ayuda chica.
export function EstadoVacio({ titulo, ayuda }: { titulo: string; ayuda?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <p className="text-sm text-neutral-400">{titulo}</p>
      {ayuda ? <p className="text-xs text-neutral-600">{ayuda}</p> : null}
    </div>
  );
}

// Bloque skeleton generico (animate-pulse) -- para armar filas/lineas de
// carga con el ancho que pida cada pantalla.
export function SkeletonLinea({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-800 ${className}`} />;
}

// Cascaron de tarjeta -- header con titulo (+ punto de color opcional),
// subtitulo y pildora de conteo, mas el contenido libre abajo. Mismo patron
// que las tarjetas de ranking/page.tsx (Más vendidos / Menos vendidos).
export function TarjetaConHeader({
  titulo,
  subtitulo,
  colorTitulo,
  pildora,
  children,
  className = "",
}: {
  titulo: ReactNode;
  subtitulo?: string;
  colorTitulo?: string;
  pildora?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5 ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            {colorTitulo ? (
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorTitulo }} aria-hidden />
            ) : null}
            {titulo}
          </h2>
          {subtitulo ? <p className="text-xs text-neutral-500">{subtitulo}</p> : null}
        </div>
        {pildora ? (
          <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
            {pildora}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
