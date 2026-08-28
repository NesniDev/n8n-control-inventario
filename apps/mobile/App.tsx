import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';

import {
  buscarEntrega,
  cancelarEntrega,
  confirmarItems,
  fetchHistorialEntrega,
  procesarEntrega,
  registrarDevolucion,
  subirEvidencia,
  type Empleado,
  type ItemEntrega,
  type LogEntry,
  type MotivoDevolucion,
  type ResolucionDevolucion,
  type Sede,
} from './api';
import PantallaLogin from './PantallaLogin';

// captura: tomar/elegir foto y mandarla (paso 1, identifica el documento).
// buscar: consultar una factura ya registrada por su codigo, sin foto.
// confirmando: el bodeguero ve los productos y carga cantidades (paso 2) --
// llega aca tanto desde 'captura' (documento nuevo o re-escaneado) como
// desde 'buscar' (consulta directa, siempre situacion 'actualizable').
// resultado: pantalla final (procesada / pendiente de revision / error).
type Fase = 'captura' | 'buscar' | 'confirmando' | 'resultado';
type EstadoFinal = 'procesada' | 'pendiente_revision' | 'error';

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// duplicates.py); TB/RM3/RM2 no tienen sede duena. Solo sugerencia rapida
// para el chip "Consultar factura" -- se puede escribir cualquier otro tipo
// con el chip "+ Otro".
const TIPOS_DOCUMENTO = ['FEI', 'FV1', 'EDP', 'EDV', 'TB', 'RM3', 'RM2'] as const;

// Lista fija de motivos de devolucion (mismos valores que el backend).
const MOTIVOS_DEVOLUCION: { valor: MotivoDevolucion; texto: string }[] = [
  { valor: 'danado', texto: 'Dañado' },
  { valor: 'equivocado', texto: 'Equivocado' },
  { valor: 'vencido', texto: 'Vencido' },
  { valor: 'no_era_lo_pedido', texto: 'No era lo pedido' },
  { valor: 'otro', texto: 'Otro' },
];

interface DevolucionDraft {
  cantidad: string;
  motivo: MotivoDevolucion | null;
  resolucion: ResolucionDevolucion | null;
}

const DEVOLUCION_DRAFT_VACIO: DevolucionDraft = { cantidad: '', motivo: null, resolucion: null };

const ESTADO_INFO: Record<
  EstadoFinal,
  { icono: keyof typeof Ionicons.glyphMap; texto: string; color: string; fondo: string }
> = {
  procesada: { icono: 'checkmark-circle', texto: 'Procesada', color: '#34d399', fondo: 'rgba(52,211,153,0.12)' },
  pendiente_revision: {
    icono: 'search',
    texto: 'Pendiente de revisión',
    color: '#fbbf24',
    fondo: 'rgba(251,191,36,0.12)',
  },
  error: { icono: 'warning', texto: 'Error', color: '#f87171', fondo: 'rgba(248,113,113,0.12)' },
};

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

// Para 'nueva' bloquea segun lo que se esta tipeando (el bodeguero declara
// cuanto quedo pendiente, y se bloquea en vivo si pone 0). Para
// 'actualizable' -- venga de re-escanear una foto o de buscar por codigo --
// bloquea segun el dato real de la DB: si ya no queda nada pendiente de ese
// item, no hay nada para editar, sin importar que se haya tipeado.
function esBloqueado(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): boolean {
  return situacion === 'nueva' ? item.valor.trim() === '0' : item.cantidad_pendiente === 0;
}

// Tope de lo que se puede tipear en cada item: para 'actualizable' no se
// puede entregar mas de lo que queda pendiente (el backend tambien lo
// valida -- ver aplicar_actualizacion_items -- esto es para avisar en el
// momento, sin esperar el error del servidor). Para 'nueva' no puede quedar
// pendiente mas de lo que la IA leyo en total.
function topeValor(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): number {
  return situacion === 'actualizable' ? item.cantidad_pendiente : item.cantidad_entregada;
}

// Valor que corresponde al check "ya se entrego todo esto" -- para 'nueva'
// es 0 (no queda nada pendiente de este producto); para 'actualizable' es el
// pendiente actual completo (se entrego todo lo que faltaba).
function valorTodoEntregado(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): number {
  return situacion === 'actualizable' ? item.cantidad_pendiente : 0;
}

function valorValido(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): boolean {
  const valor = item.valor.trim();
  if (!/^\d+$/.test(valor)) return false;
  return Number(valor) <= topeValor(item, situacion);
}

interface EventoHistorial {
  fecha: string;
  texto: string;
  // Distingue una devolucion de una entrega comun -- se usa para mostrar un
  // icono distinto en la fila (ver el render en 'confirmando'), sin meter el
  // icono adentro del texto.
  esDevolucion: boolean;
}

// Arma el historial de fechas de UN producto puntual a partir del historial
// completo de la entrega (logs con detalle.items trae la foto de TODOS los
// productos en cada evento -- aca se filtra solo el que corresponde). Asi se
// ve cada vez que cambio ese pendiente, aunque haya sido 5 veces.
function historialDeItem(historial: LogEntry[], itemId: string): EventoHistorial[] {
  const ordenado = [...historial].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const eventos: EventoHistorial[] = [];
  for (const log of ordenado) {
    if (log.evento === 'entrega_actualizada') {
      const encontrado = (log.detalle?.items as any[] | undefined)?.find((i) => i.id === itemId);
      if (encontrado) {
        eventos.push({
          fecha: log.timestamp,
          texto: `Entregado ${encontrado.cantidad_entregada} · Pendiente ${encontrado.cantidad_pendiente}`,
          esDevolucion: false,
        });
      }
    } else if (log.evento === 'devolucion_registrada' && log.detalle?.item_id === itemId) {
      const resolucion = log.detalle.resolucion === 'reposicion' ? 'repuesto' : 'reembolsado';
      eventos.push({
        fecha: log.timestamp,
        texto: `Devolución de ${log.detalle.cantidad} (${log.detalle.motivo}) -- ${resolucion}`,
        esDevolucion: true,
      });
    }
  }
  return eventos;
}

// Contenido icono+texto reusado en todos los botones -- iconos de
// @expo/vector-icons en vez de emojis, mismo look consistente en toda la app.
function ContenidoBoton({
  icono,
  texto,
  color = TEXTO_PRIMARIO,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  texto: string;
  color?: string;
}) {
  // TEXTO_PRIMARIO esta definido mas abajo -- una funcion solo evalua su
  // default param recien cuando se llama, y para entonces el modulo ya
  // termino de inicializar todos sus consts.
  return (
    <View style={styles.botonContenido}>
      <Ionicons name={icono} size={18} color={color} />
      <Text style={[styles.botonTexto, { color }]}>{texto}</Text>
    </View>
  );
}

const { width: ANCHO_PANTALLA, height: ALTO_PANTALLA } = Dimensions.get('window');

// Visor a pantalla completa para revisar una foto ya tomada (evidencia o
// traslado) con zoom -- pellizcar con dos dedos para acercar/alejar, arrastrar
// con un dedo para moverse dentro de la imagen ampliada, doble toque para
// alternar entre 1x y 2.5x. Sin dependencias nuevas: PanResponder + touches
// crudos, nada de gesture-handler/reanimated (evita otro build nativo).
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

export default function App() {
  // Sede y empleado se resuelven juntos en el login (ver PantallaLogin) --
  // un solo estado evita un instante con empleado seteado y sede todavia no.
  const [sesion, setSesion] = useState<{ empleado: Empleado; sede: Sede } | null>(null);
  // Space Grotesk (titulos/labels/numeros) + Manrope (texto de cuerpo) --
  // ver los consts FUENTE_* mas abajo. Se cargan una sola vez aca arriba,
  // antes de login o captura, para que ninguna pantalla renderice con la
  // fuente del sistema y despues "salte" a la tipografia real.
  const [fuentesCargadas] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  if (!fuentesCargadas) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={ACENTO} />
        </View>
      </SafeAreaView>
    );
  }

  if (!sesion) {
    return <PantallaLogin onLogin={(empleado, sede) => setSesion({ empleado, sede })} />;
  }

  return (
    <PantallaCaptura
      empleado={sesion.empleado}
      sede={sesion.sede}
      onCerrarSesion={() => setSesion(null)}
    />
  );
}

function PantallaCaptura({
  empleado,
  sede,
  onCerrarSesion,
}: {
  empleado: Empleado;
  sede: Sede;
  onCerrarSesion: () => void;
}) {
  const [foto, setFoto] = useState<string | null>(null);
  // Uri de la foto (evidencia o traslado) mostrada a pantalla completa con
  // zoom -- null cuando el visor esta cerrado (ver VisorFotoZoom).
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  // Solo se llena cuando procesarEntrega devolvio situacion
  // 'necesita_traslado' -- el tipo leido (ej. FEI) pertenece a otra sede
  // distinta de sedeSeleccionada. fotoTraslado es la foto que el bodeguero
  // adjunta para poder seguir igual (ver enviar()).
  // rechazado: true cuando YA se habia adjuntado una foto de traslado y el
  // backend igual devolvio necesita_traslado -- significa que el concepto de
  // esa foto no menciona el numero de esta factura (ver
  // _concepto_referencia_factura en el backend), no que falte adjuntar una.
  const [necesitaTraslado, setNecesitaTraslado] = useState<{ tipo: string; rechazado: boolean } | null>(null);
  const [fotoTraslado, setFotoTraslado] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>('captura');
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);
  // La sede de trabajo ya se eligio en el login (PantallaLogin) -- puede no
  // ser la sede del perfil del empleado (ej. cubriendo turno en otra).
  const sedeSeleccionada = sede;

  // Datos de la evidencia ya subida, necesarios para el paso 2.
  const [entregaId, setEntregaId] = useState<string | null>(null);
  const [situacion, setSituacion] = useState<'nueva' | 'actualizable' | null>(null);
  const [estadoFinal, setEstadoFinal] = useState<EstadoFinal | null>(null);
  const [items, setItems] = useState<ItemFormulario[]>([]);
  const [evidenciaActual, setEvidenciaActual] = useState<{ url: string; hash: string } | null>(null);
  // Ids de items con el editor de nota abierto (ver alternarNota).
  const [notasAbiertas, setNotasAbiertas] = useState<Set<string>>(new Set());
  // Ids de items con el editor del nombre del producto abierto -- la IA a
  // veces no lee bien el nombre (letra chica, foto poco clara), asi que se
  // puede corregir a mano antes de confirmar (ver alternarDescripcion).
  const [descripcionesAbiertas, setDescripcionesAbiertas] = useState<Set<string>>(new Set());
  // Ids de items con el editor de "Cantidad leida" abierto -- solo aplica a
  // 'nueva' (ver alternarCantidadLeida): la IA tambien se puede equivocar
  // leyendo el total del documento, no solo el nombre.
  const [cantidadesLeidasAbiertas, setCantidadesLeidasAbiertas] = useState<Set<string>>(new Set());
  // Ids de items con el formulario de devolucion abierto, y su borrador
  // (cantidad/motivo/resolucion) mientras se completa -- se descarta al
  // cerrar o al registrar con exito (ver alternarDevolucion).
  const [devolucionesAbiertas, setDevolucionesAbiertas] = useState<Set<string>>(new Set());
  const [devolucionDrafts, setDevolucionDrafts] = useState<Record<string, DevolucionDraft>>({});
  // Historial de logs de la entrega actual -- se pide una sola vez (todos
  // los productos comparten el mismo fetch) al abrir el primer historial.
  const [historial, setHistorial] = useState<LogEntry[] | null>(null);
  const [historialesAbiertos, setHistorialesAbiertos] = useState<Set<string>>(new Set());
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  // Consulta por codigo de factura (fase 'buscar'), sin pasar por una foto.
  // string y no la union de TIPOS_DOCUMENTO: en la practica el tipo real no
  // siempre es uno de esos 4 -- son la sugerencia rapida, no el limite (ver
  // chip "+ Otro" en el render).
  const [tipoBusqueda, setTipoBusqueda] = useState<string>('FEI');
  const [tipoBusquedaCustom, setTipoBusquedaCustom] = useState(false);
  const [indicativoBusqueda, setIndicativoBusqueda] = useState('');

  const usarResultado = (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      setFoto(resultado.assets[0].uri);
      // Foto nueva -- si venia de un intento anterior con necesita_traslado,
      // ese aviso ya no aplica (es de OTRO documento).
      setNecesitaTraslado(null);
      setFotoTraslado(null);
      setFase('captura');
      setMensaje('');
    }
  };

  const tomarFoto = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para capturar la guía.');
      return;
    }

    const resultado = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });

    usarResultado(resultado);
  };

  const elegirDeGaleria = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a las fotos para elegir la guía.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });

    usarResultado(resultado);
  };

  // Espejo de tomarFoto/elegirDeGaleria, pero para la foto de traslado --
  // solo aparecen cuando necesitaTraslado esta seteado (ver enviar()).
  const usarResultadoTraslado = (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      setFotoTraslado(resultado.assets[0].uri);
    }
  };

  const tomarFotoTraslado = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para capturar el traslado.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false, exif: false });
    usarResultadoTraslado(resultado);
  };

  const elegirTrasladoDeGaleria = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a las fotos para elegir el traslado.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false, exif: false });
    usarResultadoTraslado(resultado);
  };

  // Paso 1: sube la foto y le pide al backend que identifique el documento.
  // Si ya se adjunto una foto de traslado (necesitaTraslado de un intento
  // anterior), se sube y se reenvia junto con la evidencia -- el backend
  // vuelve a leer la misma foto con IA (se acepta ese costo extra por
  // simplicidad, ver plan) y esta vez si la registra.
  const enviar = async () => {
    if (!foto || !sedeSeleccionada) return;
    setCargando(true);
    setMensaje('Subiendo evidencia...');

    try {
      const { url, hash } = await subirEvidencia(foto);
      setEvidenciaActual({ url, hash });

      let trasladoUrl: string | undefined;
      if (fotoTraslado) {
        setMensaje('Subiendo traslado...');
        const subida = await subirEvidencia(fotoTraslado);
        trasladoUrl = subida.url;
      }

      setMensaje('Extrayendo datos con IA...');

      const resultado = await procesarEntrega({
        evidencia_url: url,
        hash_evidencia: hash,
        sede_origen_id: sedeSeleccionada.id,
        operador_id: empleado.id,
        capturado_at: new Date().toISOString(),
        traslado_url: trasladoUrl,
      });

      if (resultado.situacion === 'necesita_traslado') {
        const yaHabiaTraslado = !!trasladoUrl;
        setNecesitaTraslado({ tipo: resultado.tipo, rechazado: yaHabiaTraslado });
        if (yaHabiaTraslado) {
          // La foto que se mando no correspondia a esta factura -- se
          // limpia para obligar a elegir una nueva, no reintentar la misma.
          setFotoTraslado(null);
        }
        setMensaje('');
        return;
      }

      setNecesitaTraslado(null);
      setFotoTraslado(null);
      setEntregaId(resultado.id);
      setSituacion(resultado.situacion);
      setEstadoFinal(resultado.estado);
      setItems(
        resultado.items.map((item) => ({
          ...item,
          valor: '',
          nota: item.nota ?? '',
          descripcionOriginal: item.descripcion,
          cantidadEntregadaOriginal: item.cantidad_entregada,
        }))
      );
      setFase('confirmando');
      setMensaje('');
    } catch (err: any) {
      setFase('resultado');
      setEstadoFinal('error');
      const mensajeError: string =
        err?.status === 409
          ? (err?.detail ?? 'Este documento ya fue entregado por completo — acción bloqueada.')
          : (err?.detail ?? err?.message ?? 'Error al procesar la entrega.');
      setMensaje(mensajeError);

      if (err?.status === 409) {
        // Ya no queda nada pendiente: es la alerta mas importante del flujo
        // (evita doble despacho entre sedes) — un popup nativo no se puede
        // pasar por alto como el texto en pantalla.
        Alert.alert('Nada pendiente', mensajeError, [{ text: 'Entendido' }]);
      }
    } finally {
      setCargando(false);
    }
  };

  // Consulta directa por codigo de factura, sin foto -- el documento ya
  // existe por definicion, asi que reusa la misma pantalla de confirmacion
  // de items que el flujo de re-escaneo (fase 'confirmando').
  const buscarFactura = async () => {
    const indicativo = indicativoBusqueda.trim();
    if (!indicativo) return;
    setCargando(true);
    setMensaje('Buscando...');

    try {
      const resultado = await buscarEntrega(tipoBusqueda, indicativo);
      setEntregaId(resultado.id);
      // GET /entregas/buscar siempre fuerza situacion "actualizable" del
      // lado del backend -- nunca devuelve necesita_traslado (esa situacion
      // solo sale de procesarEntrega, ver enviar()), pero el tipo es
      // compartido entre los dos endpoints.
      setSituacion(resultado.situacion === 'necesita_traslado' ? 'actualizable' : resultado.situacion);
      setEstadoFinal(resultado.estado);
      setItems(
        resultado.items.map((item) => ({
          ...item,
          valor: '',
          nota: item.nota ?? '',
          descripcionOriginal: item.descripcion,
          cantidadEntregadaOriginal: item.cantidad_entregada,
        }))
      );
      setEvidenciaActual(null);
      setFase('confirmando');
      setMensaje('');
    } catch (err: any) {
      // No es un resultado terminal -- se queda en 'buscar' para reintentar
      // (codigo mal tipeado, documento que todavia no se registro, etc.).
      setMensaje(err?.detail ?? err?.message ?? 'No se encontro ese documento.');
    } finally {
      setCargando(false);
    }
  };

  // Paso 2: confirma lo que cargo el bodeguero por producto (ver
  // itemsAEnviar: para 'nueva' van todos, para 'actualizable' solo los que
  // de verdad traen un cambio).
  const confirmar = async () => {
    if (!entregaId || !situacion) return;
    setCargando(true);
    setMensaje('Guardando...');

    try {
      const payload = itemsAEnviar.map((item) => {
        const nota = item.nota.trim() || undefined;
        // Solo se manda si de verdad se corrigio el nombre -- la IA a veces
        // no lo lee bien y se puede editar a mano (ver actualizarDescripcionItem).
        const descripcion =
          item.descripcion.trim() !== item.descripcionOriginal.trim() ? item.descripcion.trim() : undefined;
        // Mismo criterio para la cantidad leida -- solo tiene sentido en
        // 'nueva' (ver actualizarCantidadLeidaItem); en 'actualizable' la
        // cantidad se maneja aparte, con el delta de entregado_hoy.
        const cantidadEntregadaCorregida =
          situacion === 'nueva' && item.cantidad_entregada !== item.cantidadEntregadaOriginal
            ? item.cantidad_entregada
            : undefined;
        // Un item bloqueado (ver esBloqueado) solo puede estar en
        // itemsAEnviar por tener una nota o descripcion nueva (ver mas
        // abajo) -- no hay cantidad que mandar, y mandar
        // entregado_hoy/cantidad_pendiente igual no rompe nada, pero es mas
        // claro mandar solo lo que de verdad cambio.
        if (situacion === 'actualizable' && esBloqueado(item, situacion)) {
          return { id: item.id, nota, descripcion };
        }
        return situacion === 'nueva'
          ? {
              id: item.id,
              cantidad_pendiente: Number(item.valor.trim()),
              nota,
              descripcion,
              cantidad_entregada: cantidadEntregadaCorregida,
            }
          : { id: item.id, entregado_hoy: Number(item.valor.trim()), nota, descripcion };
      });
      await confirmarItems(
        entregaId,
        payload,
        empleado.id,
        sedeSeleccionada?.id ?? '',
        // Si se llego por 'buscar' no hay foto nueva -- el backend trata un
        // string vacio como "no actualizar evidencia" (ver aplicar_actualizacion_items).
        evidenciaActual?.url ?? '',
        evidenciaActual?.hash ?? ''
      );
      setFase('resultado');
      setMensaje(
        estadoFinal === 'procesada'
          ? 'Entrega registrada correctamente.'
          : 'Registrada, pero necesita revisión manual (baja confianza de la IA).'
      );
    } catch (err: any) {
      setMensaje(err?.detail ?? err?.message ?? 'Error al guardar las cantidades.');
    } finally {
      setCargando(false);
    }
  };

  const actualizarValorItem = (id: string, valor: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, valor } : item)));
  };

  const actualizarNotaItem = (id: string, nota: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, nota } : item)));
  };

  const actualizarDescripcionItem = (id: string, descripcion: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, descripcion } : item)));
  };

  const actualizarCantidadLeidaItem = (id: string, textoCrudo: string) => {
    const limpio = textoCrudo.replace(/[^0-9]/g, '');
    const cantidad_entregada = limpio === '' ? 0 : Number(limpio);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, cantidad_entregada } : item)));
  };

  // Que items tienen el editor de nota abierto -- separado del texto en si,
  // asi se puede abrir el editor sin que eso cuente como "tiene nota".
  const alternarNota = (id: string) => {
    setNotasAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  // Mismo patron que alternarNota -- separado del texto en si.
  const alternarDescripcion = (id: string) => {
    setDescripcionesAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  const alternarCantidadLeida = (id: string) => {
    setCantidadesLeidasAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  const alternarDevolucion = (id: string) => {
    setDevolucionesAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  // Se pide el historial una sola vez por entrega (todos los productos
  // comparten el mismo fetch a /logs); si ya esta cargado, solo alterna la
  // visibilidad de este item puntual.
  const alternarHistorial = async (id: string) => {
    setHistorialesAbiertos((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });

    if (historial !== null || !entregaId || historialesAbiertos.has(id)) return;
    setCargandoHistorial(true);
    try {
      setHistorial(await fetchHistorialEntrega(entregaId));
    } catch {
      // Sin historial no se rompe nada mas -- se ve la lista vacia y listo.
      setHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  };

  const actualizarDraftDevolucion = (id: string, cambios: Partial<DevolucionDraft>) => {
    setDevolucionDrafts((prev) => ({
      ...prev,
      [id]: { ...DEVOLUCION_DRAFT_VACIO, ...prev[id], ...cambios },
    }));
  };

  // Devolucion de un producto ya entregado -- accion propia e inmediata,
  // no forma parte del guardado general de confirmar(). Actualiza el item
  // local con lo que devuelve el backend (cantidades ya corregidas).
  const registrarDevolucionItem = async (item: ItemFormulario) => {
    if (!entregaId) return;
    const draft = devolucionDrafts[item.id];
    const cantidad = Number((draft?.cantidad ?? '').trim());
    if (!draft?.motivo || !draft?.resolucion || !/^\d+$/.test(draft.cantidad.trim())) return;
    if (cantidad <= 0 || cantidad > item.cantidad_entregada) return;

    setCargando(true);
    setMensaje('Registrando devolución...');
    try {
      const { item: itemActualizado } = await registrarDevolucion(entregaId, {
        item_id: item.id,
        cantidad,
        motivo: draft.motivo,
        resolucion: draft.resolucion,
        operador_id: empleado.id,
        sede_id: sedeSeleccionada?.id ?? '',
      });
      // El valor tipeado (entregado hoy) puede haber quedado invalido contra
      // el nuevo pendiente -- se limpia para que lo carguen de nuevo.
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, ...itemActualizado, valor: '', nota: itemActualizado.nota ?? '' } : it
        )
      );
      setDevolucionDrafts((prev) => {
        const { [item.id]: _descartado, ...resto } = prev;
        return resto;
      });
      alternarDevolucion(item.id);
      setHistorial(null); // se acaba de sumar un evento nuevo -- refresca al reabrir
      setMensaje('Devolución registrada.');
    } catch (err: any) {
      setMensaje(err?.detail ?? err?.message ?? 'Error al registrar la devolución.');
    } finally {
      setCargando(false);
    }
  };

  // Check "todo entregado" -- evita tener que tipear el numero a mano.
  // Tocarlo de nuevo lo destilda y deja el campo vacio para tipear otra cosa.
  const alternarTodoEntregado = (item: ItemFormulario) => {
    if (!situacion) return;
    const completo = String(valorTodoEntregado(item, situacion));
    const marcado = item.valor.trim() === completo;
    actualizarValorItem(item.id, marcado ? '' : completo);
  };

  const reiniciar = () => {
    setFoto(null);
    setNecesitaTraslado(null);
    setFotoTraslado(null);
    setFase('captura');
    setMensaje('');
    setEntregaId(null);
    setSituacion(null);
    setEstadoFinal(null);
    setItems([]);
    setEvidenciaActual(null);
    setIndicativoBusqueda('');
    setNotasAbiertas(new Set());
    setDevolucionesAbiertas(new Set());
    setDevolucionDrafts({});
    setHistorial(null);
    setHistorialesAbiertos(new Set());
  };

  // Cancelar en la pantalla de confirmacion: procesarEntrega (paso 1) ya
  // insertó la entrega si situacion es 'nueva' -- sin esto, cancelar dejaba
  // esa fila en la base como si se hubiera enviado igual. Solo hace falta
  // avisarle al backend para 'nueva': para 'actualizable' (re-escaneo o
  // consulta) el paso 1 no escribe nada, no hay nada que deshacer.
  const cancelarConfirmacion = async () => {
    if (situacion === 'nueva' && entregaId) {
      setCargando(true);
      try {
        await cancelarEntrega(entregaId, empleado.id, sedeSeleccionada?.id ?? '');
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

  // Boton de volver del header -- consistente en todas las pestañas menos
  // 'captura' (esa es la pantalla inicial, no hay a donde volver). En
  // 'confirmando' tiene que pasar por cancelarConfirmacion (deshace el
  // insert de una entrega 'nueva' sin confirmar); en el resto alcanza con
  // reiniciar.
  const volverAtras = () => {
    if (fase === 'confirmando') {
      cancelarConfirmacion();
    } else {
      reiniciar();
    }
  };

  // Items que requieren una cantidad valida para poder confirmar. Para
  // 'nueva' son TODOS -- el pendiente inicial de cada item (incluido el que
  // quedo en 0 via el check "todo entregado") todavia no se guardo en
  // ningun lado, asi que aunque esBloqueado() lo marque como "bloqueado"
  // para no dejarlo seguir editando, igual hay que mandarlo. Para
  // 'actualizable' un item ya bloqueado significa que la DB ya dice
  // pendiente=0 -- no hay cantidad que confirmarle.
  const itemsConCambioCantidad =
    situacion === 'actualizable' ? items.filter((item) => !esBloqueado(item, situacion)) : items;
  // Items que de verdad hay que mandar al guardar: los de arriba, mas
  // cualquier item bloqueado al que se le haya agregado una nota o
  // corregido el nombre (eso tambien es un cambio real, aunque no toque
  // cantidades).
  const itemsAEnviar =
    situacion === 'actualizable'
      ? items.filter(
          (item) =>
            !esBloqueado(item, situacion) ||
            item.nota.trim() !== '' ||
            item.descripcion.trim() !== item.descripcionOriginal.trim()
        )
      : items;
  const cantidadesValidas =
    situacion !== null && itemsConCambioCantidad.every((item) => valorValido(item, situacion));
  // Si necesitaTraslado esta activo (el tipo leido pertenece a otra sede),
  // hace falta tambien la foto del traslado para poder reenviar.
  const puedeEnviar = !!foto && !!sedeSeleccionada && !cargando && (!necesitaTraslado || !!fotoTraslado);
  const puedeBuscar = !!indicativoBusqueda.trim() && !!tipoBusqueda.trim() && !cargando;
  const puedeConfirmar = itemsAEnviar.length > 0 && cantidadesValidas && !cargando;
  // Puramente sobre cantidades -- no se ve afectado por si se esta cargando
  // una nota, asi el aviso de "nada pendiente" sigue siendo cierto aunque
  // itemsAEnviar (lo que hay que mandar) ya no este vacio por una nota nueva.
  const documentoCompleto =
    fase === 'confirmando' &&
    situacion === 'actualizable' &&
    items.length > 0 &&
    itemsConCambioCantidad.length === 0;
  const infoEstadoFinal = fase === 'resultado' && estadoFinal ? ESTADO_INFO[estadoFinal] : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerFila}>
            {fase !== 'captura' ? (
              <Pressable onPress={volverAtras} disabled={cargando} hitSlop={8} style={styles.botonVolverHeader}>
                <Ionicons name="chevron-back" size={26} color={cargando ? NEUTRAL_500 : '#fff'} />
              </Pressable>
            ) : null}
            {/* Sede + operador compactados en un solo recuadro -- la sede ya
                llega elegida por props desde el login, no hace falta la
                tarjeta aparte que habia antes. */}
            <View style={styles.recuadroIdentidad}>
              <Ionicons name="location" size={14} color={ACENTO} />
              <Text style={styles.recuadroSedeTexto} numberOfLines={1}>
                {sedeSeleccionada.nombre}
              </Text>
              <Text style={styles.recuadroDivisor}>·</Text>
              <Ionicons name="person-outline" size={13} color={NEUTRAL_400} />
              <Text style={styles.recuadroOperadorTexto} numberOfLines={1}>
                {empleado.nombre}
              </Text>
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
                onCerrarSesion();
              }}
              hitSlop={8}
            >
              <Text style={[styles.cerrarSesion, cargando && styles.cerrarSesionDeshabilitado]}>
                Cerrar sesión
              </Text>
            </Pressable>
          </View>
        </View>

        {fase === 'captura' ? (
          <>
            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>Evidencia</Text>
              {foto ? (
                <Pressable onPress={() => setFotoAmpliada(foto)}>
                  <Image source={{ uri: foto }} style={styles.preview} resizeMode="cover" />
                  <View style={styles.iconoAmpliar}>
                    <Ionicons name="expand-outline" size={16} color={TEXTO_PRIMARIO} />
                  </View>
                </Pressable>
              ) : (
                <View style={[styles.preview, styles.previewVacio]}>
                  <Ionicons name="camera-outline" size={40} color={NEUTRAL_400} />
                  <Text style={styles.previewTexto}>Sin foto capturada</Text>
                  <Text style={styles.previewSubtexto}>
                    Encuadrá el documento completo, con buena luz
                  </Text>
                </View>
              )}
            </View>

            {necesitaTraslado ? (
              <View style={styles.tarjeta}>
                <Text style={styles.etiquetaSeccion}>Traslado requerido</Text>
                <Text style={styles.previewSubtexto}>
                  {necesitaTraslado.rechazado
                    ? 'La foto del traslado no menciona el número de esta factura -- prueba con la correcta.'
                    : `El tipo "${necesitaTraslado.tipo}" pertenece a otra sede -- para procesarlo desde acá, adjunta una foto del traslado.`}
                </Text>
                {fotoTraslado ? (
                  <Pressable onPress={() => setFotoAmpliada(fotoTraslado)}>
                    <Image source={{ uri: fotoTraslado }} style={styles.preview} resizeMode="cover" />
                    <View style={styles.iconoAmpliar}>
                      <Ionicons name="expand-outline" size={16} color={TEXTO_PRIMARIO} />
                    </View>
                  </Pressable>
                ) : (
                  <View style={[styles.preview, styles.previewVacio]}>
                    <Ionicons name="document-attach-outline" size={36} color={NEUTRAL_400} />
                    <Text style={styles.previewTexto}>Sin foto de traslado</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
                    onPress={tomarFotoTraslado}
                  >
                    <ContenidoBoton
                      icono={fotoTraslado ? 'camera-reverse-outline' : 'camera-outline'}
                      texto={fotoTraslado ? 'Repetir foto' : 'Tomar foto'}
                    />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
                    onPress={elegirTrasladoDeGaleria}
                  >
                    <ContenidoBoton icono="images-outline" texto="Galería" />
                  </Pressable>
                </View>
              </View>
            ) : null}

            {cargando ? (
              <View style={[styles.tarjeta, styles.estadoBox]}>
                <ActivityIndicator color="#c8631f" />
                <Text style={styles.mensajeSubiendo}>{mensaje}</Text>
              </View>
            ) : null}

            <View style={styles.acciones}>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={tomarFoto}
              >
                <ContenidoBoton
                  icono={foto ? 'camera-reverse-outline' : 'camera-outline'}
                  texto={foto ? 'Repetir foto' : 'Tomar foto'}
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={elegirDeGaleria}
              >
                <ContenidoBoton
                  icono="images-outline"
                  texto={foto ? 'Cambiar de galería' : 'Elegir de galería'}
                />
              </Pressable>

              {foto ? (
                <Pressable
                  disabled={!puedeEnviar}
                  style={({ pressed }) => [
                    styles.boton,
                    styles.botonPrimario,
                    !puedeEnviar && styles.botonDeshabilitado,
                    pressed && puedeEnviar && styles.botonPresionado,
                  ]}
                  onPress={enviar}
                >
                  <ContenidoBoton
                    icono="checkmark-circle-outline"
                    texto={cargando ? 'Procesando...' : 'Enviar y procesar'}
                  />
                </Pressable>
              ) : null}

              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={() => {
                  setMensaje('');
                  setFase('buscar');
                }}
              >
                <ContenidoBoton icono="search-outline" texto="Consultar factura" />
              </Pressable>
            </View>
          </>
        ) : null}

        {fase === 'buscar' ? (
          <>
            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>Tipo de documento</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectorSedesContenido}
              >
                {TIPOS_DOCUMENTO.map((t) => {
                  const activo = !tipoBusquedaCustom && tipoBusqueda === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => {
                        setTipoBusquedaCustom(false);
                        setTipoBusqueda(t);
                      }}
                      style={[styles.chipSede, activo && styles.chipSedeActiva]}
                    >
                      <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>{t}</Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => {
                    setTipoBusquedaCustom(true);
                    setTipoBusqueda('');
                  }}
                  style={[styles.chipSede, styles.chipSedeFila, tipoBusquedaCustom && styles.chipSedeActiva]}
                >
                  <Ionicons
                    name="add-outline"
                    size={14}
                    color={tipoBusquedaCustom ? '#fff' : NEUTRAL_400}
                  />
                  <Text style={[styles.chipSedeTexto, tipoBusquedaCustom && styles.chipSedeTextoActivo]}>
                    Otro
                  </Text>
                </Pressable>
              </ScrollView>

              {tipoBusquedaCustom ? (
                <TextInput
                  value={tipoBusqueda}
                  onChangeText={(texto) => setTipoBusqueda(texto.toUpperCase())}
                  placeholder="Escribí el tipo (ej: OT, NC)"
                  placeholderTextColor="#6b7688"
                  autoCapitalize="characters"
                  style={styles.inputCantidad}
                />
              ) : null}
            </View>

            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>Indicativo / número</Text>
              <TextInput
                value={indicativoBusqueda}
                onChangeText={setIndicativoBusqueda}
                placeholder="Ej: 10254"
                placeholderTextColor="#6b7688"
                keyboardType="number-pad"
                style={styles.inputCantidad}
              />
            </View>

            {mensaje ? <Text style={styles.textoErrorInline}>{mensaje}</Text> : null}

            <View style={styles.acciones}>
              <Pressable
                disabled={!puedeBuscar}
                style={({ pressed }) => [
                  styles.boton,
                  styles.botonPrimario,
                  !puedeBuscar && styles.botonDeshabilitado,
                  pressed && puedeBuscar && styles.botonPresionado,
                ]}
                onPress={buscarFactura}
              >
                <ContenidoBoton icono="search-outline" texto={cargando ? 'Buscando...' : 'Buscar'} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={reiniciar}
              >
                <ContenidoBoton icono="chevron-back-outline" texto="Volver" color={NEUTRAL_400} />
              </Pressable>
            </View>
          </>
        ) : null}

        {fase === 'confirmando' ? (
          <>
            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>
                {situacion === 'nueva' ? 'Documento nuevo' : 'Ya estaba registrado'}
              </Text>
              <Text style={styles.previewSubtexto}>
                {situacion === 'nueva'
                  ? 'Cargá cuánto quedó pendiente de cada producto.'
                  : documentoCompleto
                    ? 'Ya se entregó todo lo de este documento.'
                    : 'Todavía le queda algo pendiente. Cargá cuánto entregaste hoy de cada producto.'}
              </Text>
            </View>

            {items.map((item) => {
              const bloqueado = situacion ? esBloqueado(item, situacion) : false;
              const tope = situacion ? topeValor(item, situacion) : 0;
              const valorTexto = item.valor.trim();
              const marcadoTodoEntregado =
                !bloqueado && situacion !== null && valorTexto === String(valorTodoEntregado(item, situacion));
              // Se avisa en el momento, sin esperar el error del servidor --
              // el backend igual lo vuelve a validar (ver PATCH /items).
              const excedeTope =
                !bloqueado && situacion !== null && /^\d+$/.test(valorTexto) && Number(valorTexto) > tope;
              const notaAbierta = notasAbiertas.has(item.id);
              // Solo se puede corregir el nombre recien leido por la IA
              // (situacion 'nueva') -- al consultar un documento que ya
              // existia (buscar o re-escaneo, siempre 'actualizable') el
              // nombre ya quedo confirmado antes, no tiene sentido seguir
              // permitiendo tocarlo desde cualquier consulta.
              const puedeEditarDescripcion = situacion === 'nueva';
              const descripcionAbierta = puedeEditarDescripcion && descripcionesAbiertas.has(item.id);
              const descripcionEditada = item.descripcion.trim() !== item.descripcionOriginal.trim();
              const cantidadLeidaAbierta = cantidadesLeidasAbiertas.has(item.id);
              const cantidadLeidaEditada = item.cantidad_entregada !== item.cantidadEntregadaOriginal;
              // Una devolucion es sobre algo ya entregado antes -- no tiene
              // sentido en un documento recien escaneado sin confirmar
              // (situacion 'nueva'), ni si todavia no se entrego nada.
              // item.confirmado cubre el caso donde "Consultar factura"
              // trae un documento que la IA leyo pero que nadie confirmo
              // todavia: ahi situacion siempre llega como 'actualizable'
              // (ver GET /entregas/buscar) y cantidad_entregada ya es el
              // valor que leyo la IA, no lo que se entrego de verdad.
              const puedeDevolver = situacion === 'actualizable' && item.cantidad_entregada > 0 && item.confirmado;
              const devolucionAbierta = devolucionesAbiertas.has(item.id);
              const draft = devolucionDrafts[item.id] ?? DEVOLUCION_DRAFT_VACIO;
              const cantidadDevolucionValida =
                /^\d+$/.test(draft.cantidad.trim()) &&
                Number(draft.cantidad.trim()) > 0 &&
                Number(draft.cantidad.trim()) <= item.cantidad_entregada;
              const puedeRegistrarDevolucion =
                cantidadDevolucionValida && !!draft.motivo && !!draft.resolucion && !cargando;
              // El historial de fechas solo tiene sentido para algo que ya
              // existia antes -- un documento recien escaneado sin confirmar
              // todavia no tiene nada que mostrar.
              const puedeVerHistorial = situacion === 'actualizable';
              const historialAbierto = historialesAbiertos.has(item.id);
              const eventosHistorial = historial ? historialDeItem(historial, item.id) : [];
              return (
                <View key={item.id} style={styles.tarjeta}>
                  <View style={styles.filaTitulo}>
                    {descripcionAbierta ? (
                      <TextInput
                        value={item.descripcion}
                        onChangeText={(texto) => actualizarDescripcionItem(item.id, texto)}
                        placeholder="Nombre del producto"
                        placeholderTextColor={NEUTRAL_500}
                        autoFocus
                        style={[styles.itemDescripcion, styles.inputDescripcion, { flex: 1 }]}
                      />
                    ) : (
                      <Text style={[styles.itemDescripcion, { flex: 1 }]}>
                        {item.descripcion || 'Producto sin descripción'}
                      </Text>
                    )}
                    {puedeEditarDescripcion ? (
                      <Pressable onPress={() => alternarDescripcion(item.id)} hitSlop={8}>
                        <Ionicons
                          name={descripcionEditada || descripcionAbierta ? 'pencil' : 'pencil-outline'}
                          size={20}
                          color={descripcionEditada || descripcionAbierta ? ACENTO : NEUTRAL_400}
                        />
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Acciones secundarias del item, separadas del lapiz de
                      arriba (edita el nombre, esta fila no toca el nombre). */}
                  <View style={styles.filaAccionesItem}>
                    {puedeVerHistorial ? (
                      <Pressable onPress={() => alternarHistorial(item.id)} hitSlop={8}>
                        <Ionicons
                          name={historialAbierto ? 'time' : 'time-outline'}
                          size={20}
                          color={historialAbierto ? ACENTO : NEUTRAL_400}
                        />
                      </Pressable>
                    ) : null}
                    {puedeDevolver ? (
                      <Pressable onPress={() => alternarDevolucion(item.id)} hitSlop={8}>
                        <Ionicons
                          name="arrow-undo-outline"
                          size={20}
                          color={devolucionAbierta ? ACENTO : NEUTRAL_400}
                        />
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => alternarNota(item.id)} hitSlop={8}>
                      <Ionicons
                        name={item.nota.trim() ? 'document-text' : 'document-text-outline'}
                        size={20}
                        color={item.nota.trim() || notaAbierta ? ACENTO : NEUTRAL_400}
                      />
                    </Pressable>
                  </View>

                  {historialAbierto ? (
                    <View style={styles.historialCaja}>
                      {cargandoHistorial ? (
                        <ActivityIndicator color="#c8631f" />
                      ) : eventosHistorial.length === 0 ? (
                        <Text style={styles.previewSubtexto}>Sin cambios registrados todavía.</Text>
                      ) : (
                        eventosHistorial.map((evento, i) => (
                          <View key={i} style={styles.historialFila}>
                            <Text style={styles.historialFecha}>
                              {new Date(evento.fecha).toLocaleString('es-CO', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                            {evento.esDevolucion ? (
                              <Ionicons name="arrow-undo-outline" size={12} color={NEUTRAL_500} />
                            ) : null}
                            <Text style={styles.historialTexto}>{evento.texto}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}

                  {notaAbierta ? (
                    <TextInput
                      value={item.nota}
                      onChangeText={(texto) => actualizarNotaItem(item.id, texto)}
                      placeholder="Información adicional de este producto (opcional)"
                      placeholderTextColor="#6b7688"
                      style={styles.inputNota}
                      multiline
                    />
                  ) : item.nota.trim() ? (
                    <Pressable onPress={() => alternarNota(item.id)} style={styles.notaPreviewFila}>
                      <Ionicons name="document-text-outline" size={13} color={NEUTRAL_400} />
                      <Text style={styles.notaPreview}>{item.nota}</Text>
                    </Pressable>
                  ) : null}

                  {devolucionAbierta ? (
                    <View style={styles.devolucionCaja}>
                      <Text style={styles.etiquetaSeccion}>Devolución -- cantidad</Text>
                      <TextInput
                        value={draft.cantidad}
                        onChangeText={(texto) => actualizarDraftDevolucion(item.id, { cantidad: texto })}
                        keyboardType="number-pad"
                        placeholder={`Máx. ${item.cantidad_entregada}`}
                        placeholderTextColor="#6b7688"
                        style={styles.inputCantidad}
                      />

                      <Text style={styles.etiquetaSeccion}>Motivo</Text>
                      <View style={styles.chipsEnvoltorio}>
                        {MOTIVOS_DEVOLUCION.map((m) => {
                          const activo = draft.motivo === m.valor;
                          return (
                            <Pressable
                              key={m.valor}
                              onPress={() => actualizarDraftDevolucion(item.id, { motivo: m.valor })}
                              style={[styles.chipSede, activo && styles.chipSedeActiva]}
                            >
                              <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>
                                {m.texto}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={styles.etiquetaSeccion}>Resolución</Text>
                      <View style={styles.chipsEnvoltorio}>
                        {(
                          [
                            { valor: 'reposicion', texto: 'Repongo', icono: 'repeat-outline' },
                            { valor: 'reembolso', texto: 'Reembolso', icono: 'cash-outline' },
                          ] as const
                        ).map((r) => {
                          const activo = draft.resolucion === r.valor;
                          return (
                            <Pressable
                              key={r.valor}
                              onPress={() => actualizarDraftDevolucion(item.id, { resolucion: r.valor })}
                              style={[styles.chipSede, styles.chipSedeFila, activo && styles.chipSedeActiva]}
                            >
                              <Ionicons name={r.icono} size={14} color={activo ? '#fff' : NEUTRAL_400} />
                              <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>
                                {r.texto}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {draft.resolucion === 'reposicion' ? (
                        <Text style={styles.previewSubtexto}>Vuelve a quedar pendiente -- se debe re-entregar.</Text>
                      ) : draft.resolucion === 'reembolso' ? (
                        <Text style={styles.previewSubtexto}>
                          Se devuelve el dinero -- esa cantidad queda cerrada, no vuelve a pendiente.
                        </Text>
                      ) : null}

                      <Pressable
                        disabled={!puedeRegistrarDevolucion}
                        style={({ pressed }) => [
                          styles.boton,
                          styles.botonPrimario,
                          !puedeRegistrarDevolucion && styles.botonDeshabilitado,
                          pressed && puedeRegistrarDevolucion && styles.botonPresionado,
                        ]}
                        onPress={() => registrarDevolucionItem(item)}
                      >
                        <ContenidoBoton icono="arrow-undo-outline" texto="Registrar devolución" />
                      </Pressable>
                    </View>
                  ) : null}

                  {situacion === 'nueva' ? (
                    <View style={styles.filaConIcono}>
                      {cantidadLeidaAbierta ? (
                        <>
                          <Text style={styles.previewSubtexto}>Cantidad leída:</Text>
                          <TextInput
                            value={String(item.cantidad_entregada)}
                            onChangeText={(texto) => actualizarCantidadLeidaItem(item.id, texto)}
                            keyboardType="number-pad"
                            autoFocus
                            style={[styles.inputCantidad, styles.inputCantidadLeida]}
                          />
                        </>
                      ) : (
                        <Text style={styles.previewSubtexto}>Cantidad leída: {item.cantidad_entregada}</Text>
                      )}
                      <Pressable onPress={() => alternarCantidadLeida(item.id)} hitSlop={8}>
                        <Ionicons
                          name={cantidadLeidaEditada || cantidadLeidaAbierta ? 'pencil' : 'pencil-outline'}
                          size={16}
                          color={cantidadLeidaEditada || cantidadLeidaAbierta ? ACENTO : NEUTRAL_400}
                        />
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.previewSubtexto}>Pendiente actual: {item.cantidad_pendiente}</Text>
                  )}

                  {bloqueado ? null : (
                    <Pressable
                      onPress={() => alternarTodoEntregado(item)}
                      hitSlop={8}
                      style={styles.checkboxFila}
                    >
                      <View style={[styles.checkboxCaja, marcadoTodoEntregado && styles.checkboxCajaMarcada]}>
                        {marcadoTodoEntregado ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                      </View>
                      <Text style={styles.checkboxTexto}>
                        {situacion === 'nueva'
                          ? 'Todo entregado (nada pendiente)'
                          : 'Entregué todo lo que quedaba pendiente'}
                      </Text>
                    </Pressable>
                  )}

                  <Text style={styles.etiquetaSeccion}>
                    {situacion === 'nueva' ? 'Cantidad pendiente' : 'Entregado hoy'}
                  </Text>
                  <TextInput
                    value={item.valor}
                    onChangeText={(valor) => actualizarValorItem(item.id, valor)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#6b7688"
                    editable={!bloqueado && !marcadoTodoEntregado}
                    style={[
                      styles.inputCantidad,
                      (bloqueado || marcadoTodoEntregado) && styles.inputCantidadBloqueado,
                      excedeTope && styles.inputCantidadError,
                    ]}
                  />
                  {bloqueado ? (
                    <Text style={styles.previewSubtexto}>Ya entregado — sin nada pendiente de este producto.</Text>
                  ) : marcadoTodoEntregado ? (
                    // El input debajo sigue mostrando "cuanto entregaste hoy" (lo
                    // que realmente se manda al backend), no el pendiente final --
                    // sin esto no queda claro que tildar el check deja el
                    // pendiente en 0 al guardar (se ve el numero de hoy, que
                    // encima suele coincidir con el total si nunca se entrego
                    // nada de este producto).
                    <View style={styles.filaConIcono}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={NEUTRAL_500} />
                      <Text style={styles.previewSubtexto}>Vas a entregar los {tope} pendientes — quedará en 0.</Text>
                    </View>
                  ) : excedeTope ? (
                    <Text style={styles.textoErrorInline}>
                      {situacion === 'nueva'
                        ? `No puede quedar pendiente más de ${tope} (lo que leyó la IA).`
                        : `No podés entregar más de ${tope} — es lo único que queda pendiente.`}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            {items.length === 0 ? (
              <View style={styles.tarjeta}>
                <Text style={styles.previewSubtexto}>
                  La IA no encontró productos en la foto — repetí la captura con mejor luz/encuadre.
                </Text>
              </View>
            ) : null}

            {documentoCompleto ? (
              <View style={[styles.badgeEstado, { backgroundColor: 'rgba(52,211,153,0.12)' }]}>
                <Ionicons name="checkmark-circle" size={22} color="#34d399" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.badgeEstadoTitulo, { color: '#34d399' }]}>Documento completo</Text>
                  <Text style={styles.badgeEstadoMensaje}>
                    No queda nada pendiente de entregar en este documento.
                  </Text>
                </View>
              </View>
            ) : null}

            {mensaje ? <Text style={styles.textoErrorInline}>{mensaje}</Text> : null}

            <View style={styles.acciones}>
              {itemsAEnviar.length === 0 ? null : (
                <Pressable
                  disabled={!puedeConfirmar}
                  style={({ pressed }) => [
                    styles.boton,
                    styles.botonPrimario,
                    !puedeConfirmar && styles.botonDeshabilitado,
                    pressed && puedeConfirmar && styles.botonPresionado,
                  ]}
                  onPress={confirmar}
                >
                  <ContenidoBoton
                    icono={itemsConCambioCantidad.length === 0 ? 'document-text-outline' : 'checkmark-circle-outline'}
                    texto={
                      cargando
                        ? 'Guardando...'
                        : itemsConCambioCantidad.length === 0
                          ? 'Guardar nota'
                          : 'Confirmar cantidades'
                    }
                  />
                </Pressable>
              )}
              <Pressable
                disabled={cargando}
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={cancelarConfirmacion}
              >
                <ContenidoBoton
                  icono="close-outline"
                  texto={itemsAEnviar.length === 0 ? 'Volver' : 'Cancelar'}
                  color={NEUTRAL_400}
                />
              </Pressable>
            </View>
          </>
        ) : null}

        {fase === 'resultado' ? (
          <>
            {infoEstadoFinal ? (
              <View style={[styles.badgeEstado, { backgroundColor: infoEstadoFinal.fondo }]}>
                <Ionicons name={infoEstadoFinal.icono} size={22} color={infoEstadoFinal.color} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.badgeEstadoTitulo, { color: infoEstadoFinal.color }]}>
                    {infoEstadoFinal.texto}
                  </Text>
                  <Text style={styles.badgeEstadoMensaje}>{mensaje}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.acciones}>
              <Pressable
                style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
                onPress={reiniciar}
              >
                <ContenidoBoton icono="camera-outline" texto="Nueva captura" />
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
      {fotoAmpliada ? (
        <VisorFotoZoom uri={fotoAmpliada} onCerrar={() => setFotoAmpliada(null)} />
      ) : null}
    </SafeAreaView>
  );
}

const NEUTRAL_900 = '#0f1520'; // fondo
const NEUTRAL_850 = '#161d29'; // tarjetas
const NEUTRAL_800 = '#1d2635'; // inputs / superficies elevadas
const NEUTRAL_700 = '#2a3446'; // borde
const BORDE_FUERTE = '#384158'; // borde de mas contraste (checkbox, foco)
const NEUTRAL_500 = '#6b7688'; // texto terciario
const NEUTRAL_400 = '#9aa3b5'; // texto secundario
const TEXTO_PRIMARIO = '#f5f3ef'; // blanco calido, no #fff puro
const ACENTO = '#c8631f';

// Space Grotesk para titulos/labels/numeros (caracter tecnico, va bien con
// cantidades); Manrope para texto de cuerpo (mas calido, legible en chico).
// Los pesos vienen del archivo de fuente en si -- no combinar con
// fontWeight numerico en los estilos de abajo, un font file cargado ya
// tiene un solo peso real.
const FUENTE_DISPLAY = 'SpaceGrotesk_700Bold';
const FUENTE_DISPLAY_SEMI = 'SpaceGrotesk_600SemiBold';
const FUENTE_BODY = 'Manrope_400Regular';
const FUENTE_BODY_MEDIA = 'Manrope_500Medium';
const FUENTE_BODY_SEMI = 'Manrope_600SemiBold';
const FUENTE_BODY_BOLD = 'Manrope_700Bold';

const estilosVisorZoom = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#000000f2', alignItems: 'center', justifyContent: 'center' },
  botonCerrar: { position: 'absolute', top: 54, right: 20, zIndex: 10, padding: 6 },
  area: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  imagen: { width: ANCHO_PANTALLA, height: ALTO_PANTALLA * 0.82 },
  ayuda: {
    position: 'absolute',
    bottom: 36,
    color: NEUTRAL_400,
    fontSize: 12,
    fontFamily: FUENTE_BODY_SEMI,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL_900,
    paddingTop: RNStatusBar.currentHeight ?? 0,
  },
  scroll: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { marginTop: 8, marginBottom: 4, gap: 4 },
  headerFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonVolverHeader: { marginRight: 2 },
  recuadroIdentidad: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  recuadroSedeTexto: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_DISPLAY, flexShrink: 1 },
  recuadroDivisor: { color: NEUTRAL_500, fontSize: 14 },
  recuadroOperadorTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI, flexShrink: 1 },
  cerrarSesion: { color: '#f87171', fontSize: 12, fontFamily: FUENTE_BODY_SEMI, marginTop: 6 },
  cerrarSesionDeshabilitado: { color: NEUTRAL_500 },
  tarjeta: {
    backgroundColor: NEUTRAL_850,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    padding: 18,
    gap: 12,
    // Sombra ambiente para despegar la tarjeta del fondo -- shadow* para
    // iOS, elevation para Android (RN no comparte una sola propiedad).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 6,
  },
  etiquetaSeccion: {
    color: NEUTRAL_500,
    fontSize: 11,
    fontFamily: FUENTE_DISPLAY_SEMI,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  itemDescripcion: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_BOLD },
  inputDescripcion: {
    borderBottomWidth: 1.5,
    borderBottomColor: ACENTO,
    paddingVertical: 2,
  },
  inputCantidadLeida: {
    minWidth: 56,
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  textoErrorInline: { color: '#f87171', fontSize: 13, fontFamily: FUENTE_BODY_MEDIA },
  inputCantidad: {
    borderWidth: 1.5,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXTO_PRIMARIO,
    fontSize: 17,
    fontFamily: FUENTE_DISPLAY_SEMI,
  },
  inputCantidadBloqueado: { opacity: 0.5 },
  inputCantidadError: { borderColor: '#f87171' },
  checkboxFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxCaja: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.6,
    borderColor: BORDE_FUERTE,
    backgroundColor: NEUTRAL_800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCajaMarcada: { backgroundColor: ACENTO, borderColor: ACENTO },
  checkboxTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI, flexShrink: 1 },
  filaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filaAccionesItem: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  filaConIcono: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inputNota: {
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXTO_PRIMARIO,
    fontSize: 13,
    fontFamily: FUENTE_BODY,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  notaPreviewFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notaPreview: { color: NEUTRAL_400, fontSize: 13, fontStyle: 'italic', flexShrink: 1 },
  devolucionCaja: {
    gap: 9,
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  chipsEnvoltorio: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  historialCaja: {
    gap: 6,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  historialFila: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  historialFecha: { color: NEUTRAL_500, fontSize: 11, fontFamily: FUENTE_DISPLAY_SEMI, fontVariant: ['tabular-nums'] },
  historialTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY, flexShrink: 1 },
  selectorSedesContenido: { gap: 8, paddingRight: 4 },
  chipSede: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  chipSedeActiva: { backgroundColor: ACENTO, borderColor: ACENTO },
  chipSedeFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipSedeTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_BOLD },
  chipSedeTextoActivo: { color: TEXTO_PRIMARIO },
  preview: { width: '100%', height: 300, borderRadius: 14, backgroundColor: NEUTRAL_800 },
  iconoAmpliar: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#00000099',
    borderRadius: 999,
    padding: 6,
  },
  previewVacio: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BORDE_FUERTE,
    borderStyle: 'dashed',
    gap: 4,
  },
  previewTexto: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY_SEMI, marginTop: 4 },
  previewSubtexto: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY },
  estadoBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mensajeSubiendo: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY, flexShrink: 1 },
  badgeEstado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    padding: 16,
  },
  badgeEstadoTitulo: { fontSize: 14, fontFamily: FUENTE_DISPLAY_SEMI },
  badgeEstadoMensaje: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY, marginTop: 2 },
  acciones: { gap: 10, marginTop: 4 },
  boton: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  botonPresionado: { opacity: 0.75 },
  botonDeshabilitado: { opacity: 0.4 },
  botonPrimario: { backgroundColor: ACENTO, borderColor: ACENTO },
  botonTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 15 },
  botonContenido: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
