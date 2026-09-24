// Estado compartido de la tab Traslados -- la sesion (usuario + punto,
// mismo patron que EntregaContext.tsx) y el borrador del traslado en
// creacion, compartido entre NuevoTraslado y FirmaTransportador (las dos
// pantallas que arman UN mismo traslado antes de mandarlo al backend).
// BandejaRecepcion/RecepcionTraslado no usan el borrador -- consultan
// traslados ya creados, por eso su estado queda local a esas pantallas.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NavigationHelpers } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';

import type { Punto, Supervisor, UsuarioPunto } from './api';
import { ACENTO, ESTILO_TAB_BAR, NEUTRAL_500, styles } from './tema';
// Type-only -- se borra en compilacion, mismo criterio que EntregaContext.tsx
// con DespachosStackParamList (sin dependencia de runtime entre los dos
// archivos).
import type { TrasladosStackParamList } from './Navegacion';

const hoyISO = () => new Date().toISOString().slice(0, 10);

export interface ItemTrasladoDraft {
  // Id local (React key / referencia para editar-quitar) -- no viaja al
  // backend, que arma su propio id por item al insertar.
  localId: string;
  producto: string;
  marca: string;
  presentacion: string;
  cantidad: string;
}

export function nuevoItemDraft(): ItemTrasladoDraft {
  return { localId: Crypto.randomUUID(), producto: '', marca: '', presentacion: '', cantidad: '' };
}

export interface TrasladoDraft {
  // Generado en el celular ANTES de crear el traslado -- el path de las 2
  // firmas en Storage depende de este id (ver subirFirmaTraslado en api.ts),
  // asi que tiene que existir desde que arranca NuevoTraslado.
  id: string;
  // Numero impreso en el talonario fisico (ej. "00231") -- lo primero que
  // copia el punto que despacha, ver PantallaTrasladoNuevo.tsx.
  numeroTalonario: string;
  destino: Punto | null;
  transportadorNombre: string;
  fecha: string;
  observaciones: string;
  items: ItemTrasladoDraft[];
  firmaDespachaBase64: string | null;
}

function nuevoDraft(): TrasladoDraft {
  return {
    id: Crypto.randomUUID(),
    numeroTalonario: '',
    destino: null,
    transportadorNombre: '',
    fecha: hoyISO(),
    observaciones: '',
    items: [],
    firmaDespachaBase64: null,
  };
}

// 'punto': sesion normal de bodega (crear/recibir traslados). 'supervision':
// Erika revisando y resolviendo novedades -- ver el plan
// "supervision-novedades". El stack de Traslados renderiza pantallas
// completamente distintas segun este valor (ver Navegacion.tsx).
export type RolTraslados = 'punto' | 'supervision';

export interface TrasladoContextValue {
  rol: RolTraslados;
  // Solo con sentido para rol 'punto' -- en 'supervision' quedan en null
  // (las pantallas de supervision usan `supervisor`, no `usuario`/`punto`).
  usuario: UsuarioPunto | null;
  punto: Punto | null;
  // Solo con sentido para rol 'supervision' -- null en rol 'punto'.
  supervisor: Supervisor | null;
  cerrarSesion: () => void;
  draft: TrasladoDraft;
  actualizarDraft: (cambios: Partial<TrasladoDraft>) => void;
  reiniciarDraft: () => void;
  cargando: boolean;
  setCargando: (v: boolean) => void;
  // Descarta el borrador actual y vuelve a la pantalla raiz del rol actual
  // (InicioTraslados para 'punto', NovedadesSupervision para 'supervision')
  // -- usado al cancelar NuevoTraslado o al terminar en ResultadoTraslado.
  volverAInicio: () => void;
}

const TrasladoContext = createContext<TrasladoContextValue | null>(null);

export function useTraslado(): TrasladoContextValue {
  const ctx = useContext(TrasladoContext);
  if (!ctx) throw new Error('useTraslado() debe usarse dentro de <TrasladoProvider>');
  return ctx;
}

export function TrasladoProvider({
  navigation,
  rol,
  usuario,
  punto,
  supervisor,
  cerrarSesion,
  children,
}: {
  // navigation del stack de Traslados -- llega por el `layout` del
  // Navigator (ver Navegacion.tsx), mismo motivo que EntregaContext.tsx:
  // useNavigation() aca devolveria la de la TAB, no la del stack.
  navigation: NavigationHelpers<TrasladosStackParamList>;
  rol: RolTraslados;
  usuario: UsuarioPunto | null;
  punto: Punto | null;
  supervisor: Supervisor | null;
  cerrarSesion: () => void;
  children: ReactNode;
}) {
  const navigationTab = useNavigation();

  const [draft, setDraft] = useState<TrasladoDraft>(nuevoDraft);
  const [cargando, setCargando] = useState(false);

  const actualizarDraft = (cambios: Partial<TrasladoDraft>) => {
    setDraft((prev) => ({ ...prev, ...cambios }));
  };

  const reiniciarDraft = () => setDraft(nuevoDraft());

  const volverAInicio = () => {
    reiniciarDraft();
    navigation.reset({
      index: 0,
      routes: [{ name: rol === 'supervision' ? 'NovedadesSupervision' : 'InicioTraslados' }],
    });
  };

  // Mismo criterio que EntregaContext.tsx -- oculta la barra de tabs
  // mientras hay una creacion/recepcion en vuelo, para que no se salga a
  // otra tab a mitad de un envio.
  useEffect(() => {
    navigationTab.setOptions({
      tabBarStyle: cargando ? [ESTILO_TAB_BAR, { display: 'none' }] : ESTILO_TAB_BAR,
    });
  }, [cargando, navigationTab]);

  const value: TrasladoContextValue = {
    rol,
    usuario,
    punto,
    supervisor,
    cerrarSesion,
    draft,
    actualizarDraft,
    reiniciarDraft,
    cargando,
    setCargando,
    volverAInicio,
  };

  return <TrasladoContext.Provider value={value}>{children}</TrasladoContext.Provider>;
}

// Header compartido por todas las pantallas logueadas de Traslados -- mismo
// rol que HeaderEntrega en EntregaContext.tsx, con su propia logica de
// "volver": desde NuevoTraslado/ResultadoTraslado el back descarta el
// borrador y vuelve al inicio (equivalente a cancelar/terminar); desde el
// resto (FirmaTransportador, BandejaRecepcion, RecepcionTraslado) el back es
// un pop simple -- no hay nada que descartar ahi (FirmaTransportador vuelve
// a NuevoTraslado con el borrador intacto para seguir editando).
export function HeaderTraslado() {
  const route = useRoute();
  const navigation = useNavigation<NavigationHelpers<TrasladosStackParamList>>();
  const { rol, usuario, punto, supervisor, cargando, cerrarSesion, volverAInicio } = useTraslado();

  // Defensivo -- en la practica nunca deberia pasar, estas pantallas solo se
  // montan post-login (ver Navegacion.tsx), pero TrasladoProvider tambien se
  // monta durante LoginPunto/LoginSupervision con todo en null.
  if (rol === 'punto' && (!usuario || !punto)) return null;
  if (rol === 'supervision' && !supervisor) return null;

  const esRaiz = rol === 'supervision' ? route.name === 'NovedadesSupervision' : route.name === 'InicioTraslados';
  const descartaAlVolver = route.name === 'NuevoTraslado' || route.name === 'ResultadoTraslado';

  const volverAtras = () => {
    if (descartaAlVolver) {
      volverAInicio();
    } else {
      navigation.goBack();
    }
  };

  return (
    <View style={styles.header}>
      <View style={styles.headerFila}>
        {esRaiz ? null : (
          <Pressable onPress={volverAtras} disabled={cargando} hitSlop={8} style={styles.botonVolverHeader}>
            <Ionicons name="chevron-back" size={26} color={cargando ? NEUTRAL_500 : '#fff'} />
          </Pressable>
        )}
        {/* Puntos: solo el punto -- en Traslados se entra como el punto (la
            cuenta se llama igual, ver scripts/cargar_puntos.py), no hay
            persona que mostrar aparte. Supervision: "Supervisión · Erika",
            la persona SI importa aca (a diferencia de un punto, un
            supervisor es alguien puntual, no una cuenta compartida). */}
        <View style={styles.recuadroIdentidad}>
          <View style={styles.recuadroFila}>
            <Ionicons name={rol === 'supervision' ? 'shield-checkmark' : 'location'} size={14} color={ACENTO} />
            <Text style={styles.recuadroSedeTexto} numberOfLines={1}>
              {rol === 'supervision' ? `Supervisión · ${supervisor!.nombre}` : punto!.nombre}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            if (cargando) {
              Alert.alert(
                'Espera un momento',
                'Hay una operación en curso -- espera a que termine antes de cerrar sesión.'
              );
              return;
            }
            cerrarSesion();
          }}
          hitSlop={8}
        >
          <Text style={[styles.cerrarSesion, cargando && styles.cerrarSesionDeshabilitado]}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}
