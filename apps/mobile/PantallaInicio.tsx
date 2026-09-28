// Tab de Inicio -- lo primero que se ve al abrir la app, ANTES de cualquier
// login (cada area tiene el suyo), asi que no muestra datos de ninguna sede
// ni punto: fondo con la imagen de la empresa desenfocada a pantalla completa,
// brillos de color que se mueven despacio y, encima, tarjetas translucidas
// ("vidrio"): saludo con la fecha, estado de conexion con el backend,
// consejos, soporte y version/actualizacion instalada (para saber si se puede
// trabajar y, en soporte, que version tiene el celular).
//
// Todo el efecto sale del core de React Native (Animated + blurRadius de la
// imagen), sin expo-blur ni expo-linear-gradient: esas traen codigo nativo y
// obligarian a generar un .apk nuevo; asi sigue llegando por EAS Update.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Image,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as Updates from 'expo-updates';

import { API_BASE_URL } from './api';
import {
  ACENTO,
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  NEUTRAL_900,
  TEXTO_PRIMARIO,
} from './tema';

// Sin numero de version a proposito: "version" de app.json entra en el
// fingerprint (runtimeVersion policy), cambiarlo haria que la actualizacion
// deje de llegar a los .apk instalados. La fecha de la actualizacion OTA
// (textoActualizacion) cambia sola en cada publicacion y es lo que sirve
// para soporte.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function saludo(hora: number): { texto: string; icono: keyof typeof Ionicons.glyphMap } {
  if (hora < 12) return { texto: 'Buenos días', icono: 'sunny-outline' };
  if (hora < 19) return { texto: 'Buenas tardes', icono: 'partly-sunny-outline' };
  return { texto: 'Buenas noches', icono: 'moon-outline' };
}

const dosDigitos = (n: number) => String(n).padStart(2, '0');

type EstadoConexion = 'verificando' | 'conectado' | 'sin_conexion';

// Que actualizacion OTA esta corriendo -- en Expo Go / desarrollo no hay.
function textoActualizacion(): string {
  if (__DEV__) return 'Modo desarrollo';
  if (Updates.isEmbeddedLaunch || !Updates.createdAt) return 'Versión instalada';
  const f = Updates.createdAt;
  return `Actualizada el ${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)} · ${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;
}

const LOGO = require('./assets/logo-empresa.jpg');

// Superficie "vidrio" de las tarjetas: translucida sobre el fondo desenfocado
// y con un borde claro muy suave que marca el canto.
const VIDRIO = 'rgba(22,29,41,0.55)';
const BORDE_VIDRIO = 'rgba(255,255,255,0.10)';

// Consejos que rotan en el carrusel de Inicio (ver CarruselConsejos). Para
// agregar o cambiar consejos, editar esta lista: llega por EAS Update sin
// tocar el backend.
type AreaConsejo = 'despachos' | 'traslados' | 'general';

// Etiqueta de area de cada consejo -- mismos iconos que las tabs del menu
// de abajo (ver Navegacion.tsx), para que se asocie de un vistazo.
const AREAS_CONSEJO: Record<AreaConsejo, { texto: string; icono: keyof typeof Ionicons.glyphMap; color: string }> = {
  despachos: { texto: 'Despachos', icono: 'cube-outline', color: '#60a5fa' },
  traslados: { texto: 'Traslados', icono: 'swap-horizontal', color: '#34d399' },
  general: { texto: 'General', icono: 'information-circle-outline', color: '#fbbf24' },
};

// Ordenados alternando areas, asi el carrusel no muestra varios seguidos de
// lo mismo.
const CONSEJOS: { area: AreaConsejo; icono: keyof typeof Ionicons.glyphMap; texto: string }[] = [
  { area: 'despachos', icono: 'camera-outline', texto: 'Toma la foto de la factura con buena luz y sin sombras: la lectura automática es más precisa.' },
  { area: 'traslados', icono: 'cube-outline', texto: 'Cuenta la mercancía antes de firmar como quien despacha. Una vez firmado, el traslado queda registrado.' },
  { area: 'general', icono: 'cloud-offline-outline', texto: 'Si ves «Sin conexión al servidor», espera a tener señal antes de enviar.' },
  { area: 'despachos', icono: 'scan-outline', texto: 'Antes de confirmar, revisa que el número de factura detectado coincida con el del papel.' },
  { area: 'traslados', icono: 'car-outline', texto: 'El conductor debe revisar la carga antes de firmar: su firma confirma lo que se lleva.' },
  { area: 'general', icono: 'log-out-outline', texto: 'Cierra sesión al terminar tu turno para que nadie trabaje con tu usuario.' },
  { area: 'despachos', icono: 'create-outline', texto: 'Si la lectura automática se equivocó en un producto, corrige el nombre antes de confirmar.' },
  { area: 'traslados', icono: 'alert-circle-outline', texto: 'Al recibir, si algo llegó incompleto o dañado, toca «Con diferencia» y anota la novedad.' },
  { area: 'general', icono: 'rainy-outline', texto: 'Si va a llover, cubre la carga antes de que el vehículo salga de la bodega.' },
  { area: 'despachos', icono: 'layers-outline', texto: 'Si la entrega es parcial, registra solo lo que sale hoy: lo pendiente queda abierto para la próxima.' },
  { area: 'traslados', icono: 'list-outline', texto: 'Escribe los productos igual que en el papel: cantidad, nombre, marca y presentación.' },
  { area: 'traslados', icono: 'download-outline', texto: 'Revisa «Por recibir» al llegar un vehículo: ahí aparecen los traslados que vienen a tu punto.' },
  { area: 'despachos', icono: 'search-outline', texto: 'Si no tienes la foto a mano, puedes buscar la factura por su número para actualizarla.' },
  { area: 'traslados', icono: 'chatbox-ellipses-outline', texto: 'Usa las observaciones para lo que no está en el papel: horarios, entregas parciales o avisos.' },
];

// Contacto de soporte -- boton de WhatsApp (link wa.me: abre la app si esta
// instalada, si no el navegador). Numero en formato internacional sin "+"
// ni espacios, como lo pide wa.me.
const SOPORTE = {
  nombre: 'Neider',
  telefonoVisible: '333 253 2220',
  telefonoInternacional: '573332532220',
};

async function abrirEnlace(url: string, queFallo: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('No se pudo abrir', `No se pudo abrir ${queFallo}. Escribe a ${SOPORTE.nombre} al ${SOPORTE.telefonoVisible}.`);
  }
}

// Indice del consejo con el que arranca el carrusel -- cambia cada dia, asi
// no siempre se ve primero el mismo.
function indiceDelDia(fecha: Date): number {
  const inicioAnio = new Date(fecha.getFullYear(), 0, 0);
  const diaDelAnio = Math.floor((fecha.getTime() - inicioAnio.getTime()) / 86400000);
  return diaDelAnio % CONSEJOS.length;
}

const SEGUNDOS_POR_CONSEJO = 7;

// Preferencias de accesibilidad del sistema: "reducir movimiento" y lector de
// pantalla (TalkBack). Se escuchan los cambios para no pedir reiniciar la app.
function usePreferenciaAccesibilidad(
  consultar: () => Promise<boolean>,
  evento: 'reduceMotionChanged' | 'screenReaderChanged'
): boolean {
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    let vigente = true;
    consultar()
      .then((v) => vigente && setActiva(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(evento, setActiva);
    return () => {
      vigente = false;
      sub.remove();
    };
  }, [consultar, evento]);
  return activa;
}

const useReducirMovimiento = () =>
  usePreferenciaAccesibilidad(AccessibilityInfo.isReduceMotionEnabled, 'reduceMotionChanged');

// Valor que va y viene entre 0 y 1 sin parar (ida y vuelta suave), para los
// movimientos de fondo. Se detiene cuando `activo` es false (Inicio fuera de
// pantalla o "reducir movimiento"), asi no gasta bateria.
function useVaiven(duracion: number, activo: boolean): Animated.Value {
  const valor = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!activo) return;
    const curva = Easing.inOut(Easing.sin);
    const bucle = Animated.loop(
      Animated.sequence([
        Animated.timing(valor, { toValue: 1, duration: duracion, easing: curva, useNativeDriver: true }),
        Animated.timing(valor, { toValue: 0, duration: duracion, easing: curva, useNativeDriver: true }),
      ])
    );
    bucle.start();
    return () => bucle.stop();
  }, [activo, duracion, valor]);
  return valor;
}

// Valor que sube de 0 a 1 y vuelve a empezar -- para los latidos (anillo que
// se expande y se desvanece).
function useLatido(duracion: number, activo: boolean): Animated.Value {
  const valor = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!activo) {
      valor.setValue(0);
      return;
    }
    const bucle = Animated.loop(
      Animated.timing(valor, { toValue: 1, duration: duracion, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    bucle.start();
    return () => bucle.stop();
  }, [activo, duracion, valor]);
  return valor;
}

// Entrada escalonada de las secciones: cada una aparece subiendo un poco y
// con fundido, una detras de otra. Con "reducir movimiento" quedan visibles
// de una.
function useEntrada(cantidad: number, reducirMovimiento: boolean): Animated.Value[] {
  const valores = useRef(Array.from({ length: cantidad }, () => new Animated.Value(0))).current;
  useEffect(() => {
    if (reducirMovimiento) {
      valores.forEach((v) => v.setValue(1));
      return;
    }
    Animated.stagger(
      90,
      valores.map((v) => Animated.spring(v, { toValue: 1, damping: 16, stiffness: 120, mass: 0.9, useNativeDriver: true }))
    ).start();
  }, [reducirMovimiento, valores]);
  return valores;
}

const estiloEntrada = (v: Animated.Value) => ({
  opacity: v,
  transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
});

// Tarjeta tocable que se "hunde" un poco al presionar (resorte), en vez de
// solo bajar la opacidad.
function Presionable({
  estilo,
  children,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & { estilo?: StyleProp<ViewStyle>; children: ReactNode }) {
  const escala = useRef(new Animated.Value(1)).current;
  const animar = (a: number) => Animated.spring(escala, { toValue: a, speed: 40, bounciness: 6, useNativeDriver: true }).start();
  return (
    <Pressable {...props} onPressIn={() => animar(0.97)} onPressOut={() => animar(1)}>
      <Animated.View style={[estilo, { transform: [{ scale: escala }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Brillo de color difuminado. React Native no desenfoca Views, asi que se
// arma con circulos concentricos casi transparentes: la opacidad se acumula
// hacia el centro y el borde queda suave.
const CAPAS_BRILLO = [1, 0.84, 0.68, 0.54, 0.4, 0.28];

function Brillo({
  color,
  tamano,
  posicion,
  vaiven,
  desplazamiento,
}: {
  color: string;
  tamano: number;
  posicion: ViewStyle;
  vaiven: Animated.Value;
  desplazamiento: { x: number; y: number };
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: tamano, height: tamano },
        posicion,
        {
          transform: [
            { translateX: vaiven.interpolate({ inputRange: [0, 1], outputRange: [0, desplazamiento.x] }) },
            { translateY: vaiven.interpolate({ inputRange: [0, 1], outputRange: [0, desplazamiento.y] }) },
            { scale: vaiven.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) },
          ],
        },
      ]}
    >
      {CAPAS_BRILLO.map((f) => (
        <View
          key={f}
          style={{
            position: 'absolute',
            width: tamano * f,
            height: tamano * f,
            borderRadius: (tamano * f) / 2,
            left: (tamano * (1 - f)) / 2,
            top: (tamano * (1 - f)) / 2,
            backgroundColor: color,
            opacity: 0.05,
          }}
        />
      ))}
    </Animated.View>
  );
}

// Fondo de toda la pantalla: la imagen de la empresa muy desenfocada, un velo
// oscuro para que el texto se lea, y dos brillos (naranja de la marca y azul)
// que derivan despacio.
function Fondo({ animar }: { animar: boolean }) {
  const { width } = useWindowDimensions();
  const vaivenA = useVaiven(7000, animar);
  const vaivenB = useVaiven(9000, animar);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ImageBackground source={LOGO} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={30} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,21,32,0.74)' }]} />
      <Brillo
        color={ACENTO}
        tamano={width * 1.1}
        posicion={{ top: -width * 0.45, right: -width * 0.5 }}
        vaiven={vaivenA}
        desplazamiento={{ x: -width * 0.12, y: width * 0.1 }}
      />
      <Brillo
        color="#3b82f6"
        tamano={width}
        posicion={{ bottom: -width * 0.3, left: -width * 0.55 }}
        vaiven={vaivenB}
        desplazamiento={{ x: width * 0.15, y: -width * 0.12 }}
      />
    </View>
  );
}

// Logo con una flotacion suave hacia arriba y abajo.
function LogoAnimado({ animar }: { animar: boolean }) {
  const flotacion = useVaiven(3200, animar);
  return (
    <Animated.View
      style={[
        estilos.logoZona,
        { transform: [{ translateY: flotacion.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] },
      ]}
    >
      <View style={estilos.marcoLogo}>
        <Image source={LOGO} style={estilos.logo} resizeMode="cover" accessibilityLabel="Logo de la empresa" />
      </View>
    </Animated.View>
  );
}

// Pastilla de estado de conexion (tocar re-verifica). Conectado: el punto
// verde late; verificando: el icono gira.
function PastillaConexion({
  conexion,
  onReintentar,
  animar,
}: {
  conexion: EstadoConexion;
  onReintentar: () => void;
  animar: boolean;
}) {
  const info = INFO_CONEXION[conexion];
  const latido = useLatido(1800, animar && conexion === 'conectado');
  const giro = useLatido(1000, animar && conexion === 'verificando');
  return (
    <Presionable
      onPress={onReintentar}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={info.texto}
      accessibilityHint="Toca para volver a verificar la conexión"
      accessibilityLiveRegion="polite"
      estilo={[estilos.pastilla, { borderColor: info.borde }]}
    >
      {conexion === 'verificando' ? (
        <Animated.View
          style={{ transform: [{ rotate: giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}
        >
          <Ionicons name="sync-outline" size={13} color={info.color} />
        </Animated.View>
      ) : (
        <View style={estilos.puntoZona}>
          <Animated.View
            style={[
              estilos.punto,
              {
                backgroundColor: info.color,
                opacity: latido.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{ scale: latido.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
              },
            ]}
          />
          <View style={[estilos.punto, { backgroundColor: info.color }]} />
        </View>
      )}
      <Text style={[estilos.pastillaTexto, { color: info.color }]}>{info.corto}</Text>
    </Presionable>
  );
}

const INFO_CONEXION: Record<EstadoConexion, { texto: string; corto: string; color: string; borde: string }> = {
  verificando: { texto: 'Verificando conexión…', corto: 'Verificando…', color: NEUTRAL_400, borde: 'rgba(154,163,181,0.35)' },
  conectado: { texto: 'Conectado al servidor', corto: 'Conectado', color: '#34d399', borde: 'rgba(52,211,153,0.4)' },
  sin_conexion: { texto: 'Sin conexión al servidor', corto: 'Sin conexión · Reintentar', color: '#f87171', borde: 'rgba(248,113,113,0.45)' },
};

// Carrusel de consejos: una barra de progreso se llena en
// SEGUNDOS_POR_CONSEJO y al completarse pasa al siguiente, que entra
// deslizandose con fundido (Animated del core, sin librerias); tocar adelanta
// uno. Se pausa cuando Inicio no esta en pantalla (useIsFocused) para no
// trabajar de fondo. Con "reducir movimiento" cambia sin deslizar, y con
// lector de pantalla no avanza solo (el texto cambiaria mientras se esta
// leyendo): se adelanta tocando.
function CarruselConsejos({ reducirMovimiento }: { reducirMovimiento: boolean }) {
  const enPantalla = useIsFocused();
  const lectorPantalla = usePreferenciaAccesibilidad(AccessibilityInfo.isScreenReaderEnabled, 'screenReaderChanged');
  const [indice, setIndice] = useState(() => indiceDelDia(new Date()));
  const [anchoBarra, setAnchoBarra] = useState(0);
  // -1 = entrando desde la derecha, 0 = visible, 1 = saliendo a la izquierda.
  const transicion = useRef(new Animated.Value(0)).current;
  const progreso = useRef(new Animated.Value(0)).current;

  const avanzar = useCallback(() => {
    if (reducirMovimiento) {
      setIndice((i) => (i + 1) % CONSEJOS.length);
      return;
    }
    Animated.timing(transicion, { toValue: 1, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      setIndice((i) => (i + 1) % CONSEJOS.length);
      transicion.setValue(-1);
      Animated.spring(transicion, { toValue: 0, damping: 18, stiffness: 160, useNativeDriver: true }).start();
    });
  }, [transicion, reducirMovimiento]);

  // La barra arranca de cero en cada consejo (tambien al tocar), asi uno
  // recien adelantado a mano se ve los segundos completos.
  useEffect(() => {
    progreso.setValue(0);
    if (!enPantalla || lectorPantalla) return;
    const llenado = Animated.timing(progreso, {
      toValue: 1,
      duration: SEGUNDOS_POR_CONSEJO * 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    llenado.start(({ finished }) => {
      if (finished) avanzar();
    });
    return () => llenado.stop();
  }, [indice, enPantalla, lectorPantalla, avanzar, progreso]);

  const consejo = CONSEJOS[indice];
  const area = AREAS_CONSEJO[consejo.area];
  const estiloTransicion = {
    opacity: transicion.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
    transform: [{ translateX: transicion.interpolate({ inputRange: [-1, 0, 1], outputRange: [18, 0, -18] }) }],
  };

  return (
    <Presionable
      onPress={avanzar}
      accessibilityRole="button"
      accessibilityLabel={`Consejo ${indice + 1} de ${CONSEJOS.length}, ${area.texto}: ${consejo.texto}`}
      accessibilityHint="Toca para ver el siguiente consejo"
      estilo={estilos.tarjeta}
    >
      <View style={estilos.consejoEncabezado}>
        <View style={estilos.consejoIconoBombilla}>
          <Ionicons name="bulb" size={14} color="#fbbf24" />
        </View>
        <Text style={estilos.consejoEtiqueta}>Consejo</Text>
        <Animated.View style={[estilos.chipArea, { borderColor: area.color }, estiloTransicion]}>
          <Ionicons name={area.icono} size={12} color={area.color} />
          <Text style={[estilos.chipAreaTexto, { color: area.color }]}>{area.texto}</Text>
        </Animated.View>
        <Text style={estilos.consejoContador}>
          {indice + 1}/{CONSEJOS.length}
        </Text>
      </View>

      <Animated.View style={[estilos.consejoFila, estiloTransicion]}>
        <View style={[estilos.consejoIcono, { backgroundColor: `${area.color}1f` }]}>
          <Ionicons name={consejo.icono} size={22} color={area.color} />
        </View>
        <Text style={estilos.consejoTexto}>{consejo.texto}</Text>
      </Animated.View>

      {/* Barra de tiempo hasta el siguiente consejo (decorativa para
          TalkBack; con lector de pantalla queda vacia porque no avanza solo). */}
      <View
        style={estilos.barraFondo}
        onLayout={(e) => setAnchoBarra(e.nativeEvent.layout.width)}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Animated.View
          style={[
            estilos.barraRelleno,
            {
              backgroundColor: area.color,
              width: anchoBarra,
              transform: [{ translateX: progreso.interpolate({ inputRange: [0, 1], outputRange: [-anchoBarra, 0] }) }],
            },
          ]}
        />
      </View>
    </Presionable>
  );
}

export default function PantallaInicio() {
  const insets = useSafeAreaInsets();
  const enPantalla = useIsFocused();
  const reducirMovimiento = useReducirMovimiento();
  const animar = enPantalla && !reducirMovimiento;
  const [ahora, setAhora] = useState(() => new Date());
  const [conexion, setConexion] = useState<EstadoConexion>('verificando');
  const entrada = useEntrada(4, reducirMovimiento);

  // Se refresca cada minuto -- para que el saludo y la fecha cambien solos si
  // la app queda abierta al pasar el mediodia o la medianoche.
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const verificarConexion = useCallback(async () => {
    setConexion('verificando');
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), 8000);
    try {
      const res = await fetch(`${API_BASE_URL}/health`, { signal: controlador.signal });
      setConexion(res.ok ? 'conectado' : 'sin_conexion');
    } catch {
      setConexion('sin_conexion');
    } finally {
      clearTimeout(limite);
    }
  }, []);

  // Cada vez que se vuelve a Inicio se re-chequea (ej. el celular recupero
  // senal mientras estaba en otra tab).
  useFocusEffect(
    useCallback(() => {
      verificarConexion();
    }, [verificarConexion])
  );

  const { texto: textoSaludo, icono: iconoSaludo } = saludo(ahora.getHours());
  const dia = DIAS[ahora.getDay()];

  const abrirWhatsapp = () =>
    abrirEnlace(
      `https://wa.me/${SOPORTE.telefonoInternacional}?text=${encodeURIComponent('Hola Neider, necesito ayuda con la app de despachos.')}`,
      'WhatsApp'
    );

  return (
    <View style={estilos.contenedor}>
      <Fondo animar={animar} />

      <ScrollView
        contentContainerStyle={[estilos.scroll, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Barra superior: nombre de la app y estado de conexion. */}
        <Animated.View style={[estilos.barraSuperior, estiloEntrada(entrada[0])]}>
          <Text style={estilos.marca}>Despachos El Imperio</Text>
          <PastillaConexion conexion={conexion} onReintentar={verificarConexion} animar={animar} />
        </Animated.View>

        {/* Portada: logo, saludo y fecha. */}
        <Animated.View style={[estilos.portada, estiloEntrada(entrada[1])]}>
          <LogoAnimado animar={animar} />
          <View style={estilos.filaSaludo}>
            <Ionicons name={iconoSaludo} size={26} color={ACENTO} />
            <Text style={estilos.saludo} accessibilityRole="header">
              {textoSaludo}
            </Text>
          </View>
          <View style={estilos.chipFecha}>
            <Ionicons name="calendar-outline" size={14} color={NEUTRAL_400} />
            <Text style={estilos.fecha}>
              {dia.charAt(0).toUpperCase() + dia.slice(1)} {ahora.getDate()} de {MESES[ahora.getMonth()]} de{' '}
              {ahora.getFullYear()}
            </Text>
          </View>
        </Animated.View>

        <Animated.View style={[estilos.seccion, estiloEntrada(entrada[2])]}>
          {conexion === 'sin_conexion' ? (
            // Aviso visible solo cuando hace falta: sin servidor no se puede
            // enviar nada, mejor saberlo antes de entrar a un area.
            <Presionable
              onPress={verificarConexion}
              accessibilityRole="button"
              accessibilityLabel="No hay conexión con el servidor. Espera a tener señal antes de enviar."
              accessibilityHint="Toca para volver a verificar la conexión"
              estilo={estilos.avisoSinConexion}
            >
              <Ionicons name="cloud-offline-outline" size={20} color="#f87171" />
              <Text style={estilos.avisoSinConexionTexto}>
                No hay conexión con el servidor. Espera a tener señal antes de enviar.
              </Text>
              <Ionicons name="refresh" size={18} color="#f87171" />
            </Presionable>
          ) : null}

          <CarruselConsejos reducirMovimiento={reducirMovimiento} />
        </Animated.View>

        <Animated.View style={[estilos.seccion, estiloEntrada(entrada[3])]}>
          {/* Soporte en una sola fila, con el boton de WhatsApp a la derecha. */}
          <Presionable
            onPress={abrirWhatsapp}
            accessibilityRole="button"
            accessibilityLabel="¿Algo no funciona? Escríbele a soporte por WhatsApp"
            estilo={[estilos.tarjeta, estilos.soporte]}
          >
            <View style={estilos.soporteIcono}>
              <Ionicons name="headset-outline" size={20} color={ACENTO} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={estilos.soporteTitulo}>¿Algo no funciona?</Text>
              <Text style={estilos.soporteTexto}>Escríbele a soporte por WhatsApp</Text>
            </View>
            <View style={estilos.botonWhatsapp}>
              <Ionicons name="logo-whatsapp" size={22} color="#ffffff" />
            </View>
          </Presionable>

          {/* Pie: indicacion para empezar + version, discretos, justo arriba
              del menu de tabs. */}
          <View style={estilos.pie}>
            <View style={estilos.pieIndicacion}>
              <Text style={estilos.pieIndicacionTexto}>Elige tu área en el menú de abajo</Text>
              <Ionicons name="arrow-down" size={14} color={ACENTO} />
            </View>
            <Text style={estilos.version}>{textoActualizacion()}</Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: NEUTRAL_900 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20, gap: 18 },
  seccion: { gap: 12 },

  barraSuperior: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  marca: {
    flexShrink: 1,
    color: NEUTRAL_400,
    fontSize: 12.5,
    fontFamily: FUENTE_BODY_SEMI,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  pastilla: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: VIDRIO,
  },
  pastillaTexto: { fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  puntoZona: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  punto: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },

  portada: { alignItems: 'center', gap: 12, paddingTop: 18, paddingBottom: 6 },
  logoZona: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  marcoLogo: {
    width: 120,
    height: 120,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  logo: { width: '100%', height: '100%' },
  filaSaludo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saludo: {
    color: TEXTO_PRIMARIO,
    fontSize: 34,
    fontFamily: FUENTE_DISPLAY,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 10,
  },
  chipFecha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: VIDRIO,
    borderWidth: 1,
    borderColor: BORDE_VIDRIO,
  },
  fecha: { color: TEXTO_PRIMARIO, fontSize: 14, fontFamily: FUENTE_BODY_SEMI, opacity: 0.9 },

  tarjeta: {
    gap: 12,
    padding: 18,
    borderRadius: 22,
    backgroundColor: VIDRIO,
    borderWidth: 1,
    borderColor: BORDE_VIDRIO,
  },
  avisoSinConexion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(248,113,113,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
  },
  avisoSinConexionTexto: { flex: 1, color: '#fca5a5', fontSize: 14, fontFamily: FUENTE_BODY },

  consejoEncabezado: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  consejoIconoBombilla: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(251,191,36,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  consejoEtiqueta: { color: '#fbbf24', fontSize: 13, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.6 },
  chipArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipAreaTexto: { fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI },
  consejoContador: { marginLeft: 'auto', color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  // Alto minimo fijo: los consejos tienen largos distintos y sin esto la
  // tarjeta "saltaria" de alto en cada cambio.
  consejoFila: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, minHeight: 72 },
  consejoIcono: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  consejoTexto: { flex: 1, color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_BODY, lineHeight: 24 },
  barraFondo: { height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  barraRelleno: { height: 3, borderRadius: 2 },

  soporte: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  soporteIcono: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soporteTitulo: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  soporteTexto: { color: NEUTRAL_400, fontSize: 13.5, fontFamily: FUENTE_BODY },
  botonWhatsapp: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1faa59',
    alignItems: 'center',
    justifyContent: 'center',
  },

  pie: { alignItems: 'center', gap: 6, paddingTop: 8 },
  pieIndicacion: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pieIndicacionTexto: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY_SEMI },
  version: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY },
});
