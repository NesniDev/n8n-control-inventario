// Estado compartido entre las 4 pantallas de la sesion logueada (Captura,
// Buscar, Confirmando, Resultado) -- antes vivia como ~15 useState en un
// solo componente gigante (PantallaCaptura, en App.tsx). Lo genuinamente
// cross-fase queda aca; lo que solo usa una pantalla se quedo local a esa
// pantalla (ver cada Pantalla*.tsx).
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Alert, Image, Pressable, Modal, PanResponder, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NavigationHelpers } from '@react-navigation/native';
// Ver comentario junto a comprimirParaEnvio -- misma API legacy que ya
// usaba PantallaCapturaFoto.tsx, movida aca para poder reusarla tambien
// desde PantallaConfirmando.tsx (foto de traslado al confirmar).
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { cancelarEntrega, type Empleado, type ItemEntrega, type Sede } from './api';
import { ACENTO, ESTILO_TAB_BAR, estilosVisorZoom, NEUTRAL_500, styles, TEXTO_PRIMARIO, type EstadoFinal } from './tema';
// Type-only -- se borra en compilacion, no genera dependencia circular en
// runtime (Navegacion.tsx importa EntregaProvider mas abajo, pero solo el
// componente, no este tipo).
import type { DespachosStackParamList } from './Navegacion';

export type Situacion = 'nueva' | 'actualizable';

interface ItemFormulario extends ItemEntrega {
  valor: string;
  // Texto editable de la nota -- siempre string (nunca null), se inicializa
  // desde item.nota ?? '' al cargar (ver enviar()/buscarFactura()).
  nota: string;
  // Foto de la descripcion tal como llego del backend -- para saber si
  // item.descripcion fue editada a mano (la IA a veces no lee bien el
  // nombre del producto) sin agregar un booleano aparte que hay que
  // mantener sincronizado. Se fija una sola vez al cargar los items.
  descripcionOriginal: string;
  // Mismo patron para cantidad_entregada -- en 'nueva' es lo que la IA leyo
  // como cantidad total del documento ("Cantidad leida", ver mas abajo), y
  // tambien se puede corregir a mano si la IA se equivoco.
  cantidadEntregadaOriginal: number;
}
export type { ItemFormulario };

// Para 'nueva' bloquea segun lo que se esta tipeando (el bodeguero declara
// cuanto quedo pendiente, y se bloquea en vivo si pone 0). Para
// 'actualizable' -- venga de re-escanear una foto o de buscar por codigo --
// bloquea segun el dato real de la DB: si ya no queda nada pendiente de ese
// item, no hay nada para editar, sin importar que se haya tipeado.
export function esBloqueado(item: ItemFormulario, situacion: Situacion): boolean {
  return situacion === 'nueva' ? item.valor.trim() === '0' : item.cantidad_pendiente === 0;
}

// Tope de lo que se puede tipear en cada item: para 'actualizable' no se
// puede entregar mas de lo que queda pendiente (el backend tambien lo
// valida -- ver aplicar_actualizacion_items -- esto es para avisar en el
// momento, sin esperar el error del servidor). Para 'nueva' no puede quedar
// pendiente mas de lo que la IA leyo en total.
export function topeValor(item: ItemFormulario, situacion: Situacion): number {
  return situacion === 'actualizable' ? item.cantidad_pendiente : item.cantidad_entregada;
}

// Valor que corresponde al check "ya se entrego todo esto" -- para 'nueva'
// es 0 (no queda nada pendiente de este producto); para 'actualizable' es el
// pendiente actual completo (se entrego todo lo que faltaba).
export function valorTodoEntregado(item: ItemFormulario, situacion: Situacion): number {
  return situacion === 'actualizable' ? item.cantidad_pendiente : 0;
}

export function valorValido(item: ItemFormulario, situacion: Situacion): boolean {
  const valor = item.valor.trim();
  if (!/^\d+$/.test(valor)) return false;
  return Number(valor) <= topeValor(item, situacion);
}

// La camara/galeria entregan la foto a resolucion completa (3000-4000px de
// lado en un celular moderno, varios MB) -- de ahi viaja completa a Storage
// Y de vuelta al backend, que la manda entera a la IA de vision. Nada de eso
// necesita esa resolucion para leer texto impreso: se achica a un ancho
// maximo de 1600px antes de subirla (de sobra para OCR), en WebP (mismo
// tamaño/calidad, la mitad de peso que JPEG -- medido con una foto real).
// Usada tanto para la evidencia principal/traslado en PantallaCapturaFoto.tsx
// como para la foto de traslado al confirmar en PantallaConfirmando.tsx.
export async function comprimirParaEnvio(uri: string): Promise<string> {
  const resultado = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.8,
    format: SaveFormat.WEBP,
  });
  return resultado.uri;
}

// "FEI-152754" tal como aparece impreso en el documento -- se muestra al
// operador para que detecte a tiempo un numero mal leido por la IA (ver
// backend/duplicates._identificador, misma idea pero con guion en vez de
// espacio). null si falta algun dato, para no mostrar un badge roto tipo "FEI-".
export const formatearIdentificador = (tipo: string, indicativoNumero: string): string | null => {
  if (!tipo || !indicativoNumero) return null;
  return `${tipo}-${indicativoNumero}`;
};

// Visor a pantalla completa para revisar una foto ya tomada (evidencia o
// traslado) con zoom -- pellizcar con dos dedos para acercar/alejar, arrastrar
// con un dedo para moverse dentro de la imagen ampliada, doble toque para
// alternar entre 1x y 2.5x. Sin dependencias nuevas: PanResponder + touches
// crudos, nada de gesture-handler/reanimated (evita otro build nativo).
// No exportado -- solo lo usa EntregaProvider para el overlay compartido
// (Captura y Confirmando disparan fotoAmpliada via el context, no renderizan
// este componente ellas mismas).
function VisorFotoZoom({ uri, onCerrar }: { uri: string; onCerrar: () => void }) {
  const [escala, setEscala] = useState(1);
  const [desplazamiento, setDesplazamiento] = useState({ x: 0, y: 0 });

  // Todo lo que sigue es estado "de gesto en curso", no de React -- se lee y
  // escribe dentro de los callbacks del PanResponder, no dispara renders.
  const escalaAlIniciarPinch = useRef(1);
  const distanciaAlIniciarPinch = useRef<number | null>(null);
  const ultimoToqueUnico = useRef<{ x: number; y: number } | null>(null);
  const inicioToqueSimple = useRef<{ x: number; y: number; tiempo: number } | null>(null);
  const ultimoTapSimple = useRef(0);

  const distanciaEntreToques = (toques: { pageX: number; pageY: number }[]) =>
    Math.hypot(toques[0].pageX - toques[1].pageX, toques[0].pageY - toques[1].pageY);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const toques = evt.nativeEvent.touches;
        if (toques.length === 1) {
          inicioToqueSimple.current = { x: toques[0].pageX, y: toques[0].pageY, tiempo: Date.now() };
        }
      },
      onPanResponderMove: (evt) => {
        const toques = evt.nativeEvent.touches;
        if (toques.length === 2) {
          ultimoToqueUnico.current = null;
          const distanciaActual = distanciaEntreToques(toques);
          if (distanciaAlIniciarPinch.current == null) {
            // Primer frame con dos dedos -- fija el punto de partida en vez
            // de saltar de golpe a la escala que daria el primer delta.
            distanciaAlIniciarPinch.current = distanciaActual;
            escalaAlIniciarPinch.current = escala;
          } else {
            const factor = distanciaActual / distanciaAlIniciarPinch.current;
            setEscala(Math.min(Math.max(escalaAlIniciarPinch.current * factor, 1), 5));
          }
        } else if (toques.length === 1) {
          distanciaAlIniciarPinch.current = null;
          const toque = toques[0];
          if (escala > 1 && ultimoToqueUnico.current) {
            setDesplazamiento((prev) => ({
              x: prev.x + (toque.pageX - ultimoToqueUnico.current!.x),
              y: prev.y + (toque.pageY - ultimoToqueUnico.current!.y),
            }));
          }
          ultimoToqueUnico.current = { x: toque.pageX, y: toque.pageY };
        }
      },
      onPanResponderRelease: (evt) => {
        distanciaAlIniciarPinch.current = null;
        ultimoToqueUnico.current = null;

        const inicio = inicioToqueSimple.current;
        inicioToqueSimple.current = null;
        if (!inicio) return;

        const fin = evt.nativeEvent.changedTouches[0];
        const movimiento = fin ? Math.hypot(fin.pageX - inicio.x, fin.pageY - inicio.y) : 0;
        const duracion = Date.now() - inicio.tiempo;
        if (movimiento > 10 || duracion > 250) return; // fue arrastre, no tap

        const ahora = Date.now();
        if (ahora - ultimoTapSimple.current < 300) {
          // Doble toque: alterna entre 1x (reset) y 2.5x centrado.
          ultimoTapSimple.current = 0;
          if (escala > 1) {
            setEscala(1);
            setDesplazamiento({ x: 0, y: 0 });
          } else {
            setEscala(2.5);
          }
        } else {
          ultimoTapSimple.current = ahora;
        }
      },
    })
  ).current;

  return (
    <Modal visible animationType="fade" onRequestClose={onCerrar} statusBarTranslucent>
      <View style={estilosVisorZoom.fondo}>
        <Pressable style={estilosVisorZoom.botonCerrar} onPress={onCerrar} hitSlop={14}>
          <Ionicons name="close" size={26} color={TEXTO_PRIMARIO} />
        </Pressable>
        <View style={estilosVisorZoom.area} {...panResponder.panHandlers}>
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={[
              estilosVisorZoom.imagen,
              {
                transform: [
                  { translateX: desplazamiento.x },
                  { translateY: desplazamiento.y },
                  { scale: escala },
                ],
              },
            ]}
          />
        </View>
        <Text style={estilosVisorZoom.ayuda}>Pellizcá para zoom · doble toque para acercar/alejar</Text>
      </View>
    </Modal>
  );
}

export interface EntregaContextValue {
  empleado: Empleado | null;
  sede: Sede | null;
  cerrarSesion: () => void;
  entregaId: string | null;
  setEntregaId: (v: string | null) => void;
  situacion: Situacion | null;
  setSituacion: (v: Situacion | null) => void;
  estadoFinal: EstadoFinal | null;
  setEstadoFinal: (v: EstadoFinal | null) => void;
  documentoIdentificado: { tipo: string; indicativo_numero: string } | null;
  setDocumentoIdentificado: (v: { tipo: string; indicativo_numero: string } | null) => void;
  items: ItemFormulario[];
  setItems: Dispatch<SetStateAction<ItemFormulario[]>>;
  // Flag a nivel documento (no por item) -- se manda tal cual en confirmar()
  // (ver PantallaConfirmando). Default false, se resetea en reiniciar().
  esFaia: boolean;
  setEsFaia: (v: boolean) => void;
  // Nota a nivel documento completo (distinta de la nota por item, que vive
  // en cada ItemFormulario) -- se manda tal cual en confirmar() (ver
  // PantallaConfirmando). Default '', se resetea en reiniciar().
  notaGeneral: string;
  setNotaGeneral: (v: string) => void;
  // Valor precargado de notaGeneral (nunca se reasigna despues de la carga
  // inicial) -- Confirmando lo compara contra notaGeneral para saber si de
  // verdad cambio (incluye el caso de BORRAR una nota ya escrita, que
  // notaGeneral.trim() !== '' solo no detectaria).
  notaGeneralOriginal: string;
  setNotaGeneralOriginal: (v: string) => void;
  evidenciaActual: { url: string; hash: string } | null;
  setEvidenciaActual: (v: { url: string; hash: string } | null) => void;
  firmaUrlConsultada: string | null;
  setFirmaUrlConsultada: (v: string | null) => void;
  cargando: boolean;
  setCargando: (v: boolean) => void;
  fotoAmpliada: string | null;
  setFotoAmpliada: (v: string | null) => void;
  // Cross-fase a proposito: tanto Buscar como CapturaFoto (reescaneo) pueden
  // saber, ANTES de llegar a Confirmando, que el documento necesita
  // traslado (ver ResultadoEnvio.requiere_traslado en api.ts) -- si esto
  // fuera estado local de Confirmando, esas dos pantallas no podrian
  // setearlo antes de navegar. Confirmando sigue siendo quien lo consume y
  // lo resetea a null en su catch/reintento normal.
  necesitaTrasladoConfirmar: { tipo: string; indicativo_numero: string } | null;
  setNecesitaTrasladoConfirmar: (v: { tipo: string; indicativo_numero: string } | null) => void;
  reiniciar: () => void;
  cancelarConfirmacion: () => Promise<void>;
}

const EntregaContext = createContext<EntregaContextValue | null>(null);

export function useEntrega(): EntregaContextValue {
  const ctx = useContext(EntregaContext);
  if (!ctx) throw new Error('useEntrega() debe usarse dentro de <EntregaProvider>');
  return ctx;
}

export function EntregaProvider({
  navigation,
  empleado,
  sede,
  cerrarSesion,
  children,
}: {
  // navigation del stack de Despachos -- llega por el `layout` del Navigator
  // (ver Navegacion.tsx), no por useNavigation(): desde ahi useNavigation()
  // devuelve la navigation de la TAB, no la del stack.
  navigation: NavigationHelpers<DespachosStackParamList>;
  empleado: Empleado | null;
  sede: Sede | null;
  cerrarSesion: () => void;
  children: ReactNode;
}) {
  // Navigation de la tab Despachos (el `layout` se renderiza dentro de ella).
  const navigationTab = useNavigation();

  const [entregaId, setEntregaId] = useState<string | null>(null);
  const [situacion, setSituacion] = useState<Situacion | null>(null);
  const [estadoFinal, setEstadoFinal] = useState<EstadoFinal | null>(null);
  const [documentoIdentificado, setDocumentoIdentificado] = useState<{
    tipo: string;
    indicativo_numero: string;
  } | null>(null);
  const [items, setItems] = useState<ItemFormulario[]>([]);
  const [esFaia, setEsFaia] = useState(false);
  const [notaGeneral, setNotaGeneral] = useState('');
  const [notaGeneralOriginal, setNotaGeneralOriginal] = useState('');
  const [evidenciaActual, setEvidenciaActual] = useState<{ url: string; hash: string } | null>(null);
  const [firmaUrlConsultada, setFirmaUrlConsultada] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // Uri de la foto (evidencia o traslado, o la firma consultada) mostrada a
  // pantalla completa con zoom -- null cuando el visor esta cerrado. La usan
  // tanto Captura como Confirmando, por eso el visor se renderiza aca mismo
  // (una sola instancia compartida) en vez de en cada pantalla.
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const [necesitaTrasladoConfirmar, setNecesitaTrasladoConfirmar] = useState<{
    tipo: string;
    indicativo_numero: string;
  } | null>(null);

  // Limpia SOLO el estado de contexto -- el estado fase-local de
  // Captura/Buscar/Confirmando (foto, mensaje, notasAbiertas, etc.) no se
  // limpia a mano aca: se resetea solo porque el reset() de navegacion
  // desmonta la vieja instancia de esas pantallas y monta una Captura nueva
  // desde cero.
  const reiniciar = () => {
    setEntregaId(null);
    setSituacion(null);
    setEstadoFinal(null);
    setDocumentoIdentificado(null);
    setItems([]);
    setEsFaia(false);
    setNotaGeneral('');
    setNotaGeneralOriginal('');
    setNecesitaTrasladoConfirmar(null);
    setEvidenciaActual(null);
    setFirmaUrlConsultada(null);
    setFotoAmpliada(null);
    navigation.reset({ index: 0, routes: [{ name: 'Captura' }] });
  };

  // Mientras hay un envio en vuelo (subida de evidencia, procesarEntrega,
  // confirmar) se oculta la barra de tabs -- mismo criterio que el bloqueo de
  // "Cerrar sesion" en HeaderEntrega: que el operador no salga a otra tab a
  // mitad de un envio. Igual el estado del stack se conservaria (los tabs no
  // se desmontan), esto es para que no quede la duda de si se envio o no.
  useEffect(() => {
    navigationTab.setOptions({
      tabBarStyle: cargando ? [ESTILO_TAB_BAR, { display: 'none' }] : ESTILO_TAB_BAR,
    });
  }, [cargando, navigationTab]);

  // Cancelar en la pantalla de confirmacion: procesarEntrega (paso 1) ya
  // insertó la entrega si situacion es 'nueva' -- sin esto, cancelar dejaba
  // esa fila en la base como si se hubiera enviado igual. Solo hace falta
  // avisarle al backend para 'nueva': para 'actualizable' (re-escaneo o
  // consulta) el paso 1 no escribe nada, no hay nada que deshacer.
  const cancelarConfirmacion = async () => {
    if (situacion === 'nueva' && entregaId && empleado) {
      setCargando(true);
      try {
        await cancelarEntrega(entregaId, empleado.id, sede?.id ?? '');
      } catch {
        // Best-effort: si falla la red no bloqueamos al bodeguero por esto --
        // en el peor caso queda una entrega "nueva" sin confirmar, que no
        // rompe nada (un proximo escaneo/consulta la trata como actualizable).
      } finally {
        setCargando(false);
      }
    }
    reiniciar();
  };

  const value: EntregaContextValue = {
    empleado,
    sede,
    cerrarSesion,
    entregaId,
    setEntregaId,
    situacion,
    setSituacion,
    estadoFinal,
    setEstadoFinal,
    documentoIdentificado,
    setDocumentoIdentificado,
    items,
    setItems,
    esFaia,
    setEsFaia,
    notaGeneral,
    setNotaGeneral,
    notaGeneralOriginal,
    setNotaGeneralOriginal,
    evidenciaActual,
    setEvidenciaActual,
    firmaUrlConsultada,
    setFirmaUrlConsultada,
    cargando,
    setCargando,
    fotoAmpliada,
    setFotoAmpliada,
    necesitaTrasladoConfirmar,
    setNecesitaTrasladoConfirmar,
    reiniciar,
    cancelarConfirmacion,
  };

  return (
    <EntregaContext.Provider value={value}>
      {children}
      {fotoAmpliada ? <VisorFotoZoom uri={fotoAmpliada} onCerrar={() => setFotoAmpliada(null)} /> : null}
    </EntregaContext.Provider>
  );
}

const RUTAS_CON_VOLVER: string[] = ['Buscar', 'Confirmando', 'Resultado'];

// Header compartido por las pantallas de la sesion logueada -- antes era
// JSX repetido dentro del unico componente gigante; ahora vive en un solo
// lugar y decide su comportamiento por route.name en vez de por `fase`.
export function HeaderEntrega() {
  const route = useRoute();
  const { empleado, sede, cargando, cerrarSesion, reiniciar, cancelarConfirmacion } = useEntrega();

  // Defensivo -- en la practica nunca deberia pasar, esta pantalla solo se
  // monta post-login (ver Navegacion.tsx), pero EntregaProvider tambien se
  // monta durante Login con empleado/sede en null.
  if (!empleado || !sede) return null;

  const volverAtras = () => {
    if (route.name === 'Confirmando') {
      cancelarConfirmacion();
    } else {
      reiniciar();
    }
  };

  return (
    <View style={styles.header}>
      <View style={styles.headerFila}>
        {/* Solo dentro del flujo de Despachos -- ni en Captura (inicio del
            flujo) ni en las tabs de Traslados/Remisiones. */}
        {RUTAS_CON_VOLVER.includes(route.name) ? (
          <Pressable onPress={volverAtras} disabled={cargando} hitSlop={8} style={styles.botonVolverHeader}>
            <Ionicons name="chevron-back" size={26} color={cargando ? NEUTRAL_500 : '#fff'} />
          </Pressable>
        ) : null}
        {/* Bodeguero + sede -- ambos ya llegan del contexto (login). */}
        <View style={styles.recuadroIdentidad}>
          <View style={styles.recuadroFila}>
            <Ionicons name="person-outline" size={12} color={ACENTO} />
            <Text style={styles.recuadroEmpleadoTexto} numberOfLines={1}>
              {empleado.nombre}
            </Text>
          </View>
          <View style={styles.recuadroFila}>
            <Ionicons name="location" size={14} color={ACENTO} />
            <Text style={styles.recuadroSedeTexto} numberOfLines={1}>
              {sede.nombre}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            // Si hay un envio en curso (subida de evidencia o
            // procesarEntrega en vuelo), cerrar sesion aca solo desmonta
            // la pantalla -- el await sigue corriendo y termina
            // registrando la entrega igual. Se bloquea mientras cargando
            // para que el operador espere a que termine o falle.
            if (cargando) {
              Alert.alert('Espera un momento', 'Hay un envío en curso -- esperá a que termine antes de cerrar sesión.');
              return;
            }
            cerrarSesion();
          }}
          hitSlop={8}
        >
          <Text style={[styles.cerrarSesion, cargando && styles.cerrarSesionDeshabilitado]}>
            Cerrar sesión
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
