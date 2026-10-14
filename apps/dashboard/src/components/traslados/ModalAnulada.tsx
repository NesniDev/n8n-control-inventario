"use client";

// Detalle de una hoja de talonario anulada (solo lectura).

import type { FilaTrasladoSyscafe } from "@/lib/api";
import { Pildora } from "@/components/ui";
import { Folio } from "@/components/entregas/Folio";
import { empresaTalonario, fechaHora, referencia } from "./compartido";
import { Dato, ModalBase } from "./ModalBase";

export function ModalAnulada({ fila, onCerrar }: { fila: FilaTrasladoSyscafe; onCerrar: () => void }) {
  return (
    <ModalBase
      etiqueta={`Hoja ${referencia(fila)}`}
      titulo={<Folio tipo="Hoja" numero={referencia(fila)} tamano="modal" />}
      ancho="max-w-md"
      onCerrar={onCerrar}
      pildora={<Pildora tono="neutro">Anulada</Pildora>}
    >
      <div className="grid grid-cols-2 gap-4">
        <Dato etiqueta="Empresa">{empresaTalonario(fila) ?? "—"}</Dato>
        <Dato etiqueta="Punto">{fila.punto_origen_nombre ?? "—"}</Dato>
        <Dato etiqueta="Fecha">{fechaHora(fila.created_at)}</Dato>
        <Dato etiqueta="Anulada por">{fila.anulado_por_nombre ?? "—"}</Dato>
      </div>
      <Dato etiqueta="Motivo">{fila.motivo ?? "—"}</Dato>
    </ModalBase>
  );
}
