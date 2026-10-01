"use client";

// Piezas de presentacion compartidas entre las pantallas del dashboard --
// tema oscuro "Grafito cálido" con acento dorado (tokens definidos en globals.css:
// surface, line, muted, brand-gold, ok, etc.). Sin logica de negocio: solo
// reciben datos ya resueltos por cada pagina.

import type { ButtonHTMLAttributes, ReactNode } from "react";

// Indicador KPI -- barra fina de color arriba, rotulo en mayusculas chicas,
// valor grande tabular y detalle. Mismas props que antes.
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
    <div className="relative flex flex-col gap-1.5 overflow-hidden rounded-xl border border-line bg-surface p-4 pt-5 transition-colors duration-150 hover:border-line-strong">
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: acento }} aria-hidden />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{etiqueta}</span>
      {cargando ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="h-7 w-24 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="text-4xl font-semibold leading-none tabular-nums tracking-tight text-ink">{valor}</span>
            {unidad ? <span className="text-xs text-muted">{unidad}</span> : null}
          </p>
          <p className="truncate text-xs text-muted" title={detalle}>
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
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <span>{mensaje}</span>
      <button
        onClick={onReintentar}
        className="min-h-10 cursor-pointer rounded-md border border-red-400/40 px-3 py-1 text-xs font-medium text-red-200 transition-colors duration-150 hover:bg-red-500/20"
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
      <p className="text-sm text-muted">{titulo}</p>
      {ayuda ? <p className="text-xs text-subtle">{ayuda}</p> : null}
    </div>
  );
}

// Bloque skeleton generico (animate-pulse) -- para armar filas/lineas de
// carga con el ancho que pida cada pantalla.
export function SkeletonLinea({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} />;
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
      className={`flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-soft">
            {colorTitulo ? (
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorTitulo }} aria-hidden />
            ) : null}
            {titulo}
          </h2>
          {subtitulo ? <p className="text-xs text-muted">{subtitulo}</p> : null}
        </div>
        {pildora ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] tabular-nums text-muted">
            {pildora}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Primitivas nuevas (opcionales): botones, pildoras de estado y encabezado.
// ---------------------------------------------------------------------------

export type VarianteBoton = "primario" | "secundario" | "fantasma" | "peligro";

// Clases base de boton -- exportadas como string para poder aplicarlas
// tambien a <Link> o <a> sin envolver en <button>.
export function claseBoton(variante: VarianteBoton = "secundario", extra = ""): string {
  const base =
    "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";
  const variantes: Record<VarianteBoton, string> = {
    primario: "bg-brand-gold text-brand-ink hover:bg-gold-hover font-semibold",
    secundario: "border border-line-strong bg-surface-2 text-soft hover:border-muted hover:text-ink",
    fantasma: "text-muted hover:bg-surface-2 hover:text-ink",
    peligro: "bg-danger-solid text-white font-semibold hover:bg-red-700",
  };
  return `${base} ${variantes[variante]} ${extra}`.trim();
}

export function Boton({
  variante = "secundario",
  className = "",
  type = "button",
  ...props
}: { variante?: VarianteBoton } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={claseBoton(variante, className)} {...props} />;
}

export type TonoPildora = "ok" | "warn" | "error" | "info" | "neutro";

const TONOS_PILDORA: Record<TonoPildora, string> = {
  ok: "border-ok/50 bg-ok/15 text-ok-fg",
  warn: "border-warn/40 bg-warn/10 text-warn",
  error: "border-danger/40 bg-danger/10 text-danger-fg",
  info: "border-info/40 bg-info/10 text-info",
  neutro: "border-line-strong bg-surface-2 text-soft",
};

// Pildora de estado con tono semantico (procesada = ok, pendiente = warn,
// duplicado = error).
export function Pildora({
  tono = "neutro",
  children,
  className = "",
}: {
  tono?: TonoPildora;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONOS_PILDORA[tono]} ${className}`}
    >
      {children}
    </span>
  );
}

// Encabezado de pagina: sobretitulo + titulo + descripcion, con una zona de
// acciones opcional a la derecha.
export function EncabezadoPagina({
  sobretitulo,
  titulo,
  descripcion,
  acciones,
}: {
  sobretitulo?: string;
  titulo: string;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
      <div className="flex min-w-0 max-w-2xl flex-col gap-1">
        {sobretitulo ? (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-gold">{sobretitulo}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{titulo}</h1>
        {descripcion ? <p className="text-sm leading-relaxed text-muted">{descripcion}</p> : null}
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Iconos en linea (estilo Lucide: viewBox 24, trazo currentColor). Sin
// dependencias externas.
// ---------------------------------------------------------------------------

const RUTAS_ICONO = {
  externo: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  reloj: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  cerrar: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  arriba: "m18 15-6-6-6 6",
  abajo: "m6 9 6 6 6-6",
  descarga: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  izquierda: "m12 19-7-7 7-7M19 12H5",
  derecha: "M5 12h14M12 5l7 7-7 7",
} as const;

export type NombreIcono = keyof typeof RUTAS_ICONO;

export function Icono({ nombre, className = "ml-1 inline h-3.5 w-3.5 align-text-bottom" }: { nombre: NombreIcono; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={RUTAS_ICONO[nombre]} />
    </svg>
  );
}
