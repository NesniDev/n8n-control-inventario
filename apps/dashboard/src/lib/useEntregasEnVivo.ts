"use client";

// Realtime de Supabase de la pagina "Entregas": cuando entra o
// cambia una fila se revalida al instante en vez de esperar el proximo tick
// de polling (que sigue activo como red de seguridad si el socket se corta).
// entrega_items cambia aparte de entregas (ver PATCH /entregas/{id}/items),
// asi que tambien se escucha. `enVivo` es true mientras el canal esta
// suscrito; `refreshInterval` es el que cada pagina pasa a sus useSWR.

import { useEffect, useState } from "react";
import { mutate as mutateGlobal } from "swr";
import { supabase } from "@/lib/supabase";
import { POLLING_EN_VIVO_MS, POLLING_SIN_REALTIME_MS, revalidarEntregas } from "@/lib/entregas";

export function useEntregasEnVivo({ escucharLogs = false }: { escucharLogs?: boolean } = {}) {
  const [enVivo, setEnVivo] = useState(false);
  const refreshInterval = enVivo ? POLLING_EN_VIVO_MS : POLLING_SIN_REALTIME_MS;

  useEffect(() => {
    const cliente = supabase;
    if (!cliente) return;

    let canal = cliente
      .channel("dashboard-entregas-logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "entregas" }, () => {
        revalidarEntregas();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "entrega_items" }, () => {
        revalidarEntregas();
      });
    if (escucharLogs) {
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table: "logs" }, () => {
        mutateGlobal("logs");
      });
    }
    const suscrito = canal.subscribe((status) => setEnVivo(status === "SUBSCRIBED"));

    return () => {
      cliente.removeChannel(suscrito);
    };
  }, [escucharLogs]);

  return { enVivo, refreshInterval };
}
