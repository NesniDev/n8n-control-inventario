"use client";

// Ranking de productos mas/menos vendidos en un rango de fechas (ver GET
// /ranking/productos en el backend) -- se agrega en Python a partir de
// entrega_items.cantidad_entregada, sin agregacion en SQL. Pantalla de solo
// lectura, sin edicion.
//
// Forma: ranking de magnitudes -> barras horizontales ordenadas, una serie
// (un color) por tarjeta, valor escrito al lado de cada barra (el dato nunca
// depende solo del color). Colores validados con el validador de la skill
// dataviz sobre la superficie oscura del panel: esmeralda #059669 y cielo
// #0284c7 (banda de luminosidad oscura, contraste >= 3:1, separacion CVD).

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetchRankingProductos, fetchSedes, type RankingProductoItem } from "@/lib/api";
import { Indicador } from "@/components/ui";

const COLOR_MAS = "#059669";
const COLOR_MENOS = "#0284c7";

function fechaISO(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

function hoyISO(): string {
  return fechaISO(new Date());
}

function haceNDias(n: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - n);
  return fechaISO(fecha);
}

// Convierte el rango de calendario (inputs <input type="date">, "YYYY-MM-DD")
// a los ISO que espera el backend -- "hasta" se lleva al final de ese dia
// (23:59:59.999 local), mismo criterio que fechasCalendarioAISO en
// app/page.tsx (sin esto se perderian las entregas capturadas despues de
// medianoche del dia elegido).
function rangoCalendarioAISO(desde: string, hasta: string): { desde: string; hasta: string } {
  const [ay, am, ad] = desde.split("-").map(Number);
  const [hy, hm, hd] = hasta.split("-").map(Number);
  return {
    desde: new Date(ay, am - 1, ad).toISOString(),
    hasta: new Date(hy, hm - 1, hd, 23, 59, 59, 999).toISOString(),
  };
}

const formatoNumero = new Intl.NumberFormat("es-CO");

// "22 sep" / "22 sep 2026" -- para el resumen del rango elegido.
function fechaCorta(iso: string, conAnio: boolean): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    ...(conAnio ? { year: "numeric" } : {}),
  });
}

type Periodo = "hoy" | "semana" | "mes" | "custom";

export default function RankingPage() {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [desde, setDesde] = useState(haceNDias(6));
  const [hasta, setHasta] = useState(hoyISO());
  const [sedeId, setSedeId] = useState<string>("todas");

  const { data: sedes } = useSWR("sedes", fetchSedes);

  const elegirPeriodo = (nuevo: Exclude<Periodo, "custom">) => {
    setPeriodo(nuevo);
    if (nuevo === "hoy") {
      setDesde(hoyISO());
      setHasta(hoyISO());
    } else if (nuevo === "semana") {
      setDesde(haceNDias(6));
      setHasta(hoyISO());
    } else {
      // "Este mes" = ultimos 30 dias, mas simple y consistente que el mes
      // calendario (que arrancaria vacio el dia 1).
      setDesde(haceNDias(29));
      setHasta(hoyISO());
    }
  };

  const cambiarDesde = (valor: string) => {
    setPeriodo("custom");
    setDesde(valor);
  };

  const cambiarHasta = (valor: string) => {
    setPeriodo("custom");
    setHasta(valor);
  };

  const rangoISO = useMemo(() => rangoCalendarioAISO(desde, hasta), [desde, hasta]);

  const {
    data: ranking,
    error,
    isLoading,
    mutate,
  } = useSWR(
    ["ranking-productos", rangoISO.desde, rangoISO.hasta, sedeId],
    () =>
      fetchRankingProductos({
        desde: rangoISO.desde,
        hasta: rangoISO.hasta,
        sedeId: sedeId === "todas" ? undefined : sedeId,
      }),
    { refreshInterval: 30000 }
  );

  const nombreSede =
    sedeId === "todas" ? "Todas las sedes" : (sedes ?? []).find((s) => s.id === sedeId)?.nombre ?? "Sede";
  const mismoAnio = desde.slice(0, 4) === hasta.slice(0, 4);
  const textoRango =
    desde === hasta
      ? fechaCorta(desde, true)
      : `${fechaCorta(desde, !mismoAnio)} – ${fechaCorta(hasta, true)}`;

  const masVendidos = ranking?.mas_vendidos ?? [];
  const menosVendidos = ranking?.menos_vendidos ?? [];
  const lider = masVendidos[0];
  const unidadesTop = masVendidos.reduce((suma, item) => suma + item.cantidad_total, 0);
  const menosMovido = menosVendidos[0];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Control logístico · analítica
          </p>
          <h1 className="text-2xl font-semibold text-neutral-100">Ranking de productos</h1>
          <p className="text-sm text-neutral-400">
            Más y menos vendidos en el período elegido, según lo confirmado en las entregas.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
        >
          ← Panel
        </Link>
      </header>

      {/* Filtros en una sola fila arriba de los datos. */}
      <section className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-1">
            {(
              [
                { valor: "hoy", etiqueta: "Hoy" },
                { valor: "semana", etiqueta: "Últimos 7 días" },
                { valor: "mes", etiqueta: "Últimos 30 días" },
              ] as const
            ).map((opcion) => (
              <button
                key={opcion.valor}
                onClick={() => elegirPeriodo(opcion.valor)}
                aria-pressed={periodo === opcion.valor}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  periodo === opcion.valor
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1">
            <label className="flex flex-col items-start">
              <span className="text-[10px] leading-none text-neutral-500">Desde</span>
              <input
                type="date"
                value={desde}
                onChange={(e) => cambiarDesde(e.target.value)}
                max={hasta || undefined}
                className="rounded bg-transparent px-1 py-1 text-xs text-neutral-200 [color-scheme:dark]"
              />
            </label>
            <span className="px-1 text-xs text-neutral-600">–</span>
            <label className="flex flex-col items-start">
              <span className="text-[10px] leading-none text-neutral-500">Hasta</span>
              <input
                type="date"
                value={hasta}
                onChange={(e) => cambiarHasta(e.target.value)}
                min={desde || undefined}
                className="rounded bg-transparent px-1 py-1 text-xs text-neutral-200 [color-scheme:dark]"
              />
            </label>
          </div>

          <select
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200"
          >
            <option value="todas">Todas las sedes</option>
            {(sedes ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-neutral-500">
          Mostrando <span className="font-medium text-neutral-300">{textoRango}</span> ·{" "}
          <span className="font-medium text-neutral-300">{nombreSede}</span>
          {isLoading && ranking ? <span className="ml-2 text-neutral-600">actualizando…</span> : null}
        </p>
      </section>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>No se pudo cargar el ranking. Revisa la conexión con el servidor.</span>
          <button
            onClick={() => mutate()}
            className="rounded-md border border-red-400/40 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {/* Indicadores de cabecera -- el dato suelto no necesita grafico. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Indicador
          etiqueta="Producto más vendido"
          valor={lider ? formatoNumero.format(lider.cantidad_total) : "—"}
          unidad={lider ? "unidades" : undefined}
          detalle={lider?.nombre ?? "Sin datos en este período"}
          acento={COLOR_MAS}
          cargando={isLoading && !ranking}
        />
        <Indicador
          etiqueta={`Unidades en el top ${masVendidos.length || 15}`}
          valor={masVendidos.length ? formatoNumero.format(unidadesTop) : "—"}
          unidad={masVendidos.length ? "unidades" : undefined}
          detalle={
            masVendidos.length
              ? `${masVendidos.length} ${masVendidos.length === 1 ? "producto" : "productos"} con más salida`
              : "Sin datos en este período"
          }
          acento={COLOR_MAS}
          cargando={isLoading && !ranking}
        />
        <Indicador
          etiqueta="Producto con menos salida"
          valor={menosMovido ? formatoNumero.format(menosMovido.cantidad_total) : "—"}
          unidad={menosMovido ? "unidades" : undefined}
          detalle={menosMovido?.nombre ?? "Sin datos en este período"}
          acento={COLOR_MENOS}
          cargando={isLoading && !ranking}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingCard
          titulo="Más vendidos"
          subtitulo="Ordenados por unidades entregadas"
          items={ranking?.mas_vendidos}
          cargando={isLoading && !ranking}
          color={COLOR_MAS}
          podio
        />
        <RankingCard
          titulo="Menos vendidos"
          subtitulo="Productos con menor salida en el período"
          items={ranking?.menos_vendidos}
          cargando={isLoading && !ranking}
          color={COLOR_MENOS}
        />
      </div>
    </main>
  );
}

function RankingCard({
  titulo,
  subtitulo,
  items,
  cargando,
  color,
  podio = false,
}: {
  titulo: string;
  subtitulo: string;
  items: RankingProductoItem[] | undefined;
  cargando: boolean;
  color: string;
  podio?: boolean;
}) {
  // Escala propia de cada tarjeta: la barra mas larga es el mayor valor de
  // ESTA lista (en "menos vendidos" los valores son chicos y con la escala de
  // "mas vendidos" las barras serian invisibles).
  const maximo = Math.max(1, ...(items ?? []).map((item) => item.cantidad_total));

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
            {titulo}
          </h2>
          <p className="text-xs text-neutral-500">{subtitulo}</p>
        </div>
        {items && items.length > 0 ? (
          <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
            {items.length} {items.length === 1 ? "producto" : "productos"}
          </span>
        ) : null}
      </header>

      {cargando ? (
        <ol className="flex flex-col gap-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex flex-col gap-1.5">
              <div className="h-3 animate-pulse rounded bg-neutral-800" style={{ width: `${70 - i * 8}%` }} />
              <div className="h-2 animate-pulse rounded bg-neutral-800/70" style={{ width: `${90 - i * 12}%` }} />
            </li>
          ))}
        </ol>
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <p className="text-sm text-neutral-400">Sin ventas en este período</p>
          <p className="text-xs text-neutral-600">Prueba con un rango de fechas más amplio u otra sede.</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((item, indice) => {
            const ancho = Math.max(2, (item.cantidad_total / maximo) * 100);
            const puesto = indice + 1;
            const esPodio = podio && puesto <= 3;
            return (
              <li
                key={item.codigo ?? item.nombre}
                title={`${item.nombre}: ${formatoNumero.format(item.cantidad_total)} unidades en ${item.entregas_count} ${
                  item.entregas_count === 1 ? "entrega" : "entregas"
                }`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-neutral-800/60"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                    esPodio ? "bg-neutral-100 text-neutral-900" : "text-neutral-500"
                  }`}
                >
                  {puesto}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-neutral-200">{item.nombre}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-100">
                      {formatoNumero.format(item.cantidad_total)}
                    </span>
                  </div>
                  {/* Barra: pista tenue + relleno con extremos redondeados. */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800/80">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${ancho}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="flex justify-between gap-3 text-[11px] text-neutral-500">
                    <span className="font-mono">{item.codigo ?? "sin código"}</span>
                    <span>
                      {item.entregas_count} {item.entregas_count === 1 ? "entrega" : "entregas"}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
