"use client";

import { Icono } from "@/components/ui";

// Marca de "el admin corrigio algo en esta entrega" (ver
// Entrega.modificada_por_admin) -- el detalle esta en "Cambios del admin".
export function IconoModificadaAdmin() {
  return (
    <span title="Modificada por el admin" aria-label="Modificada por el admin" className="text-warn">
      <Icono nombre="usuarioAdmin" />
    </span>
  );
}
