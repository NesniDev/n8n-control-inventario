"use client";

// Ranking de productos mas/menos vendidos en un rango de fechas (ver GET
// /ranking/productos en el backend) -- se agrega en Python a partir de
// entrega_items.cantidad_entregada, sin agregacion en SQL. Pantalla de solo
// lectura, sin edicion.

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetchRankingProductos, fetchSedes, type RankingProductoItem } from "@/lib/api";

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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-3">
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
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
        >
          ← Panel
        </Link>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-1">
          {(
            [
              { valor: "hoy", etiqueta: "Hoy" },
              { valor: "semana", etiqueta: "Esta semana" },
              { valor: "mes", etiqueta: "Este mes" },
            ] as const
          ).map((opcion) => (
            <button
              key={opcion.valor}
              onClick={() => elegirPeriodo(opcion.valor)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                periodo === opcion.valor
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-1">
          <label className="flex flex-col items-start px-0.5">
            <span className="text-[10px] leading-none text-neutral-500">Desde</span>
            <input
              type="date"
              value={desde}
              onChange={(e) => cambiarDesde(e.target.value)}
              max={hasta || undefined}
              className="rounded bg-transparent px-1.5 py-1 text-xs text-neutral-300 [color-scheme:dark]"
            />
          </label>
          <span className="text-xs text-neutral-600">–</span>
          <label className="flex flex-col items-start px-0.5">
            <span className="text-[10px] leading-none text-neutral-500">Hasta</span>
            <input
              type="date"
              value={hasta}
              onChange={(e) => cambiarHasta(e.target.value)}
              min={desde || undefined}
              className="rounded bg-transparent px-1.5 py-1 text-xs text-neutral-300 [color-scheme:dark]"
            />
          </label>
        </div>

        <select
          value={sedeId}
          onChange={(e) => setSedeId(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300"
        >
          <option value="todas">Todas las sedes</option>
          {(sedes ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudo cargar el ranking.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RankingCard titulo="Más vendidos" items={ranking?.mas_vendidos} cargando={isLoading} />
        <RankingCard titulo="Menos vendidos" items={ranking?.menos_vendidos} cargando={isLoading} />
      </div>
    </main>
  );
}

function RankingCard({
  titulo,
  items,
  cargando,
}: {
  titulo: string;
  items: RankingProductoItem[] | undefined;
  cargando: boolean;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-sm font-medium text-neutral-200">{titulo}</h2>
      {cargando ? (
        <p className="text-sm text-neutral-500">Cargando...</p>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-neutral-500">Sin datos en este período.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, indice) => (
            <li
              key={item.codigo ?? item.nombre}
              className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-2 last:border-0 last:pb-0"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="w-5 shrink-0 text-right text-xs text-neutral-600">{indice + 1}.</span>
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate text-sm text-neutral-200">{item.nombre}</span>
                  <span className="font-mono text-xs text-neutral-500">
                    {item.codigo ?? "sin código"}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold text-neutral-100">{item.cantidad_total}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
