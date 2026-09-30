// Recuerda en el celular el ultimo acceso exitoso (area + quien entro en cada
// area) para que al abrir la app ya esten elegidas su area y su sede, sin
// volver a elegirlas. Solo se guardan ids y el largo del
// PIN (para entrar al completar los digitos, sin tocar "Ingresar") -- nunca
// el PIN ni la sesion: siempre hay que escribir el PIN para entrar.
//
// Usa expo-file-system (ya instalado, ver api.ts) en vez de AsyncStorage: esa
// seria una libreria nativa nueva y obligaria a generar otro .apk. En web
// documentDirectory es null, asi que simplemente no se recuerda nada.
import * as FileSystem from 'expo-file-system/legacy';

import type { TipoSesion } from './SesionContext';

export type UsuarioRecordado = { lugarId: string; usuarioId: string; largoPin?: number };

export type RecuerdoLogin = {
  area: TipoSesion | null;
  usuarios: Partial<Record<TipoSesion, UsuarioRecordado>>;
};

export const RECUERDO_VACIO: RecuerdoLogin = { area: null, usuarios: {} };

const ruta = () => (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}recuerdo-login.json` : null);

// Cualquier falla (archivo corrupto, sin permisos, web) se trata como "no hay
// nada recordado" -- en el peor caso el usuario elige como antes.
export async function leerRecuerdo(): Promise<RecuerdoLogin> {
  const archivo = ruta();
  if (!archivo) return RECUERDO_VACIO;
  try {
    const info = await FileSystem.getInfoAsync(archivo);
    if (!info.exists) return RECUERDO_VACIO;
    const datos = JSON.parse(await FileSystem.readAsStringAsync(archivo));
    return { area: datos?.area ?? null, usuarios: datos?.usuarios ?? {} };
  } catch {
    return RECUERDO_VACIO;
  }
}

// Sin await a proposito en quien lo llama: no recordar no debe frenar el login.
export async function guardarRecuerdo(recuerdo: RecuerdoLogin): Promise<void> {
  const archivo = ruta();
  if (!archivo) return;
  try {
    await FileSystem.writeAsStringAsync(archivo, JSON.stringify(recuerdo));
  } catch {
    // Ver leerRecuerdo: es solo una comodidad.
  }
}
