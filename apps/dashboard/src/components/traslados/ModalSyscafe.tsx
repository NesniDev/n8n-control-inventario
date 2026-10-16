"use client";

// Registro del numero Syscafe de un traslado en un modal propio (antes se
// editaba dentro de la fila de la tabla). Muestra a que traslado corresponde,
// un campo grande en mayusculas y, si quedan otros pendientes en la vista,
// "Guardar y siguiente" para registrarlos seguidos sin cerrar el modal.
// Enter hace la accion principal; Escape cierra (ModalBase). La pagina lo
// monta con key = id del traslado: al pasar al siguiente arranca limpio.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { asignarSyscafeDashboard, type FilaTrasladoSyscafe } from "@/lib/api";
import { claseBoton, Icono, Pildora } from "@/components/ui";
import { Folio } from "@/components/entregas/Folio";
import { empresaTalonario, fechaCorta, referencia } from "./compartido";
import { ModalBase } from "./ModalBase";

// Formato habitual: letras, guion y numero (NBR-945). Solo orienta: no bloquea,
// por si Syscafe usa otro formato en algun punto.
const FORMATO_HABITUAL = /^[A-Z]{2,5}-\d{1,8}$/;

export function ModalSyscafe({
  fila,
  siguiente,
  pendientesRestantes,
  onCerrar,
  onGuardado,
  onSiguiente,
}: {
  fila: FilaTrasladoSyscafe;
  // Proximo traslado pendiente de la vista actual (null si no queda otro).
  siguiente: FilaTrasladoSyscafe | null;
  // Pendientes de la vista sin contar este.
  pendientesRestantes: number;
  onCerrar: () => void;
  onGuardado: () => void;
  onSiguiente: (fila: FilaTrasladoSyscafe) => void;
}) {
  const [valor, setValor] = useState(fila.numero_syscafe ?? "");
  const [guardando, setGuardando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const limpio = valor.trim();
  const sinCambios = limpio === (fila.numero_syscafe ?? "");
  const formatoRaro = limpio !== "" && !FORMATO_HABITUAL.test(limpio);
  const conSiguiente = siguiente !== null && !fila.numero_syscafe;

  const guardar = async (nuevo: string | null, irAlSiguiente: boolean) => {
    setGuardando(true);
    try {
      await asignarSyscafeDashboard(fila.id, nuevo);
      toast.success(nuevo ? `Syscafe ${nuevo} guardado en ${referencia(fila)}` : "Número Syscafe borrado");
      onGuardado();
      if (irAlSiguiente && siguiente) onSiguiente(siguiente);
      else onCerrar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el número Syscafe");
      entrada.current?.focus();
    } finally {
      setGuardando(false);
    }
  };

  const accionPrincipal = () => {
    if (!limpio || sinCambios || guardando) return;
    guardar(limpio, conSiguiente);
  };

  return (
    <ModalBase
      etiqueta={`Número Syscafe del traslado ${referencia(fila)}`}
      titulo={<Folio tipo="Traslado" numero={referencia(fila)} tamano="modal" />}
      ancho="max-w-sm"
      onCerrar={onCerrar}
      pildora={
        fila.numero_syscafe ? (
          <Pildora tono="ok">Registrado</Pildora>
        ) : (
          <>
            <Pildora tono="warn">Pendiente</Pildora>
            {pendientesRestantes > 0 ? (
              <span className="text-xs text-muted">
                {pendientesRestantes === 1 ? "queda 1 más" : `quedan ${pendientesRestantes} más`}
              </span>
            ) : null}
          </>
        )
      }
    >
      {/* A que traslado se le esta poniendo el numero, en una sola linea. */}
      <p className="-mt-2 text-sm text-soft">
        {fila.punto_origen_nombre ?? "—"}
        <Icono nombre="derecha" className="mx-1 inline h-3.5 w-3.5 align-text-bottom text-muted" />
        <span className="sr-only">a</span>
        {fila.punto_destino_nombre ?? "—"}
        <span className="text-muted">
          {" · "}
          {fechaCorta(fila.fecha)}
          {empresaTalonario(fila) ? ` · ${empresaTalonario(fila)}` : ""}
        </span>
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="syscafe-numero" className="text-xs font-medium text-muted">
          Número Syscafe
        </label>
        <input
          id="syscafe-numero"
          ref={entrada}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={valor}
          onChange={(e) => setValor(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              accionPrincipal();
            }
          }}
          placeholder="NBR-945"
          aria-describedby="syscafe-ayuda"
          className="cifra min-h-12 rounded-md border border-line-strong bg-surface px-3 text-xl tracking-wide text-ink transition-colors duration-150 focus:border-brand-gold focus:outline-none"
        />
        <p id="syscafe-ayuda" className={`text-xs ${formatoRaro ? "text-warn" : "text-subtle"}`}>
          {formatoRaro
            ? "No tiene el formato habitual (ej. NBR-945). Revísalo."
            : conSiguiente
              ? "Enter guarda y pasa al siguiente."
              : "Enter guarda."}
        </p>
      </div>

      {/* Acciones: borrar (icono) a la izquierda; guardar a la derecha. Cancelar
          no hace falta: cierran la X, Escape o el clic afuera. */}
      <div className="flex items-center gap-2">
        {fila.numero_syscafe ? (
          <button
            type="button"
            onClick={() => guardar(null, false)}
            disabled={guardando}
            title="Borrar número"
            aria-label="Borrar número Syscafe"
            className={claseBoton("fantasma", "w-11 px-0 text-danger hover:text-danger")}
          >
            <Icono nombre="basura" className="h-4.5 w-4.5" />
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {conSiguiente ? (
            <button
              type="button"
              onClick={() => guardar(limpio, false)}
              disabled={!limpio || sinCambios || guardando}
              className={claseBoton("secundario")}
            >
              <Icono nombre="check" className="h-4 w-4" />
              Guardar
            </button>
          ) : null}
          <button
            type="button"
            onClick={accionPrincipal}
            disabled={!limpio || sinCambios || guardando}
            className={claseBoton("primario")}
          >
            {guardando ? (
              "Guardando…"
            ) : conSiguiente ? (
              <>
                Siguiente
                <Icono nombre="derecha" className="h-4 w-4" />
              </>
            ) : (
              <>
                <Icono nombre="check" className="h-4 w-4" />
                Guardar
              </>
            )}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
