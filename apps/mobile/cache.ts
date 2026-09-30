// Cache en memoria de las respuestas del backend -- lo ya cargado aparece al
// instante en vez de volver a pedirse (ej. el personal de una sede en el
// login). Vive solo mientras la app esta abierta: no se guarda en disco, asi
// que al cerrar y abrir la app la primera carga vuelve a ir a la red.
//
// Uso (ver api.ts): conCache envuelve el pedido con una vigencia; mientras el
// dato este vigente no se va a la red. leerCache es sincronico, para que una
// pantalla pinte lo guardado antes de esperar la respuesta (sin spinner).
// invalidarCache se llama despues de una escritura que deja datos viejos.

type Entrada = { valor: unknown; guardado: number };

const entradas = new Map<string, Entrada>();
// Pedidos en curso: dos pantallas que piden lo mismo a la vez comparten la
// misma promesa en vez de duplicar el pedido.
const enVuelo = new Map<string, Promise<unknown>>();

export type OpcionesCache = {
  // true = ignora lo guardado y vuelve a pedir (ej. boton "Reintentar").
  forzar?: boolean;
};

export async function conCache<T>(
  clave: string,
  vigenciaMs: number,
  pedir: () => Promise<T>,
  opciones: OpcionesCache = {}
): Promise<T> {
  const entrada = entradas.get(clave);
  if (!opciones.forzar && entrada && Date.now() - entrada.guardado < vigenciaMs) {
    return entrada.valor as T;
  }
  const pendiente = enVuelo.get(clave);
  if (pendiente) return pendiente as Promise<T>;

  // Los errores no se guardan: el proximo pedido vuelve a intentar.
  const pedido = pedir()
    .then((valor) => {
      entradas.set(clave, { valor, guardado: Date.now() });
      return valor;
    })
    .finally(() => {
      enVuelo.delete(clave);
    });
  enVuelo.set(clave, pedido);
  return pedido;
}

// Lo ultimo guardado para esa clave (vigente o no) -- undefined si nunca se
// cargo. Sincronico: sirve para pintar al instante.
export function leerCache<T>(clave: string): T | undefined {
  return entradas.get(clave)?.valor as T | undefined;
}

// Borra las claves que empiezan con alguno de los prefijos dados.
export function invalidarCache(...prefijos: string[]): void {
  for (const clave of [...entradas.keys()]) {
    if (prefijos.some((p) => clave.startsWith(p))) entradas.delete(clave);
  }
}
