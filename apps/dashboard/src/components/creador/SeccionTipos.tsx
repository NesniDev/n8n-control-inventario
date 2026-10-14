"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  actualizarTipoDocumento,
  crearTipoDocumento,
  eliminarTipoDocumento,
  fetchTiposDocumentoAdmin,
} from "@/lib/api";
import { ErrorConReintento, Panel } from "@/components/ui";
import {
  INPUT,
  BOTON_PRIMARIO,
  BOTON_LINK,
  BOTON_CANCELAR,
  AccionEliminar,
  Campo,
  Insignia,
  ejecutar,
  Cargando,
  Lista,
  FILA,
} from "./compartido";

export function SeccionTipos() {
  const { data, error, isLoading, mutate } = useSWR(["creador-tipos"], () => fetchTiposDocumentoAdmin());
  const [codigo, setCodigo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [editandoCodigo, setEditandoCodigo] = useState<string | null>(null);
  const [descripcionEdit, setDescripcionEdit] = useState("");

  const agregar = async () => {
    setEnviando(true);
    const ok = await ejecutar(
      () => crearTipoDocumento({ codigo: codigo.trim().toUpperCase(), descripcion: descripcion.trim() }),
      "Tipo de documento creado"
    );
    setEnviando(false);
    if (ok) {
      setCodigo("");
      setDescripcion("");
      mutate();
    }
  };

  return (
    <Panel conRelleno={false}
      titulo="Tipos de documento"
      subtitulo="Ejemplos que se le muestran a la IA al leer una foto. Son una guía: la IA también transcribe códigos que no estén en la lista."
      conteo={data ? String(data.length) : undefined}
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4 sm:p-5">
        <Campo etiqueta="Código (ej. FEI)" className="w-32">
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={12} className={`${INPUT} uppercase`} />
        </Campo>
        <Campo etiqueta="Descripción (opcional)" className="min-w-[200px] flex-1">
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={INPUT} />
        </Campo>
        <button onClick={agregar} disabled={enviando || !codigo.trim()} className={BOTON_PRIMARIO}>
          {enviando ? "Creando…" : "Crear tipo"}
        </button>
      </div>

      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorConReintento mensaje={error.message} onReintentar={() => mutate()} />
        </div>
      ) : null}
      {isLoading || !data ? (
        error ? null : <Cargando />
      ) : (
        <Lista vacio={data.length === 0}>
          {data.map((tipo) => (
            <li key={tipo.codigo} className={FILA}>
              <span className="cifra w-20 shrink-0 text-[16px] text-ink">{tipo.codigo}</span>
              {editandoCodigo === tipo.codigo ? (
                <>
                  <input aria-label="Descripción" value={descripcionEdit} onChange={(e) => setDescripcionEdit(e.target.value)} className={`${INPUT} min-w-[160px] flex-1`} />
                  <button
                    className={BOTON_LINK}
                    onClick={async () => {
                      if (await ejecutar(() => actualizarTipoDocumento(tipo.codigo, { descripcion: descripcionEdit.trim() }), "Tipo actualizado")) {
                        setEditandoCodigo(null);
                        mutate();
                      }
                    }}
                  >
                    Guardar
                  </button>
                  <button className={BOTON_CANCELAR} onClick={() => setEditandoCodigo(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-[160px] flex-1 text-muted">{tipo.descripcion || "—"}</span>
                  <Insignia activo={tipo.activo} />
                  <button
                    className={BOTON_LINK}
                   
                    onClick={() => {
                      setEditandoCodigo(tipo.codigo);
                      setDescripcionEdit(tipo.descripcion);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className={BOTON_LINK}
                   
                    onClick={async () => {
                      if (await ejecutar(() => actualizarTipoDocumento(tipo.codigo, { activo: !tipo.activo }), tipo.activo ? "Tipo desactivado" : "Tipo activado")) mutate();
                    }}
                  >
                    {tipo.activo ? "Desactivar" : "Activar"}
                  </button>
                  <AccionEliminar
                    nombre={tipo.codigo}
                    exito="Tipo de documento eliminado"
                    onEliminar={() => eliminarTipoDocumento(tipo.codigo)}
                    onDesactivar={tipo.activo ? () => actualizarTipoDocumento(tipo.codigo, { activo: false }) : undefined}
                    exitoDesactivar="Tipo desactivado"
                    onHecho={() => mutate()}
                  />
                </>
              )}
            </li>
          ))}
        </Lista>
      )}
    </Panel>
  );
}
