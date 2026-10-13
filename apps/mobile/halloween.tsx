// Decoracion de temporada de Halloween: una capa POR ENCIMA del diseño, sin
// tocar colores, fuentes ni logica (ver tema.tsx / vidrio.tsx, que siguen
// iguales). Solo se ve entre el 1 de octubre y el 2 de noviembre (fecha local
// del celular); fuera de esa ventana todo devuelve null y la app queda tal
// cual. Es JS puro (emoji + Animated de React Native, sin librerias nativas),
// asi que llega por OTA sin generar un .apk nuevo.
//   - CapaHalloween: murcielagos y fantasmas que cruzan toda la pantalla, a
//     distintas alturas y en ambos sentidos, y telarañas en las esquinas de
//     arriba. Va montada una sola vez en App.tsx, encima de todas las
//     pantallas, con pointerEvents="none": no bloquea ningun toque.
//   - DecoracionEntrada: calabazas, fantasma y un resplandor naranja en el
//     fondo de la pantalla de entrada (ver FondoEntrada en PantallaEntrada.tsx).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NavigationContainerRefWithCurrent, ParamListBase } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// "Reducir movimiento" del sistema. Es el mismo criterio que
// useReducirMovimiento de PantallaInicio.tsx, pero no se importa de ahi:
// Inicio importa este archivo (CalabazasEncabezado) y quedaria un ciclo.
function useSinMovimiento() {
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    let vigente = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => vigente && setActiva(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setActiva);
    return () => {
      vigente = false;
      sub.remove();
    };
  }, []);
  return activa;
}

// Ponerlo en true para ver la decoracion fuera de temporada (pruebas).
const FORZAR_HALLOWEEN = false;

const esTemporadaHalloween = (hoy: Date) => {
  const mes = hoy.getMonth(); // 0 = enero
  const dia = hoy.getDate();
  return mes === 9 || (mes === 10 && dia <= 2);
};

export const HALLOWEEN_ACTIVO = FORZAR_HALLOWEEN || esTemporadaHalloween(new Date());

// Cada murcielago: altura de partida como fraccion de la pantalla (repartidos
// de arriba a abajo), cuanto sube o baja al cruzar, sentido (1 = izquierda a
// derecha, -1 = al reves), tamaño, cuanto se demora en cruzar y con que
// retraso arranca dentro de la ronda.
// Pocos a proposito: los celulares de los operadores son de gama baja, y
// mientras algo se anima la pantalla se redibuja en cada cuadro (bateria).
const MURCIELAGOS = [
  { alto: 0.06, deriva: 40, sentido: 1, tamano: 30, duracion: 6000, retraso: 0 },
  { alto: 0.3, deriva: -50, sentido: -1, tamano: 26, duracion: 6500, retraso: 2500 },
  { alto: 0.52, deriva: 40, sentido: 1, tamano: 24, duracion: 7000, retraso: 6000 },
  { alto: 0.74, deriva: -40, sentido: -1, tamano: 32, duracion: 6200, retraso: 4000 },
];

// Pausa larga entre rondas: la mayor parte del tiempo la pantalla queda
// quieta y no se redibuja.
const PAUSA_ENTRE_RONDAS = 10000;

// Pantallas donde no vuela nada (camara, firma y fotos): ahi la fluidez
// importa mas que la decoracion. Telarañas y calabazas, que son quietas y no
// cuestan, se quedan. Son los nombres de las rutas de Navegacion.tsx.
const RUTAS_SIN_VOLADORES = new Set([
  'Captura',
  'Confirmando',
  'NuevoTraslado',
  'FirmaTransportador',
  'RecepcionTraslado',
  'NovedadDetalle',
]);

const ALETEOS_POR_SEGUNDO = 4;
const ALAS_ABAJO = 0.4;

// Para interpolate: alterna alas arriba (1) y abajo (ALAS_ABAJO) a lo largo
// del cruce, segun cuanto dure.
const rangoAleteo = (duracion: number) => {
  const aleteos = Math.round((duracion / 1000) * ALETEOS_POR_SEGUNDO);
  const pasos = aleteos * 2;
  return {
    inputRange: Array.from({ length: pasos + 1 }, (_, i) => i / pasos),
    outputRange: Array.from({ length: pasos + 1 }, (_, i) => (i % 2 === 0 ? 1 : ALAS_ABAJO)),
  };
};

// Fantasmas: menos y mas lentos, flotando con un vaiven amplio en vez de
// aletear.
const FANTASMAS = [
  { alto: 0.4, deriva: 30, sentido: -1, tamano: 35, duracion: 14000, retraso: 3000 },
  { alto: 0.82, deriva: -20, sentido: 1, tamano: 33, duracion: 15000, retraso: 12000 },
];

type Ruta = (typeof MURCIELAGOS)[number];

// Lo que comparten murcielagos y fantasmas: cruzar la pantalla de
// borde a borde (empiezan y terminan fuera de ella) en diagonal suave segun la
// deriva, en rondas con pausa. El contenido se dibuja mirando a la derecha y se
// voltea solo cuando el sentido es de derecha a izquierda.
function Volador({
  alto,
  deriva,
  sentido,
  tamano,
  duracion,
  retraso,
  aleteo = false,
  vaiven = 10,
  reducirMovimiento,
  children,
}: Ruta & {
  aleteo?: boolean;
  vaiven?: number;
  reducirMovimiento: boolean;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const avance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducirMovimiento) return;
    const ronda = Animated.loop(
      Animated.sequence([
        Animated.delay(retraso),
        Animated.timing(avance, {
          toValue: 1,
          duration: duracion,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(avance, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(PAUSA_ENTRE_RONDAS),
      ]),
    );
    ronda.start();
    return () => ronda.stop();
  }, [avance, duracion, retraso, reducirMovimiento]);

  if (reducirMovimiento) return null;

  const fuera = tamano * 2;
  const translateX = avance.interpolate({
    inputRange: [0, 1],
    outputRange: sentido === 1 ? [-fuera, width + fuera] : [width + fuera, -fuera],
  });
  const translateY = avance.interpolate({
    inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1],
    outputRange: [
      0,
      deriva * 0.2 - vaiven,
      deriva * 0.4 + vaiven / 2,
      deriva * 0.6 - vaiven,
      deriva * 0.8 + vaiven / 2,
      deriva,
    ],
  });
  // Aleteo (murcielagos): la silueta se aplasta y se estira en vertical unas 4
  // veces por segundo, y a ese tamaño se lee como alas que suben y bajan. Sale
  // del mismo valor del vuelo (no es otra animacion): se queda quieto en la
  // pausa entre rondas, sin gasto extra.
  const scaleY = aleteo ? avance.interpolate(rangoAleteo(duracion)) : 1;

  return (
    <Animated.View
      style={[
        estilos.volador,
        {
          top: height * alto,
          transform: [{ translateX }, { translateY }, { scaleY }, { scaleX: sentido }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Silueta de caricatura (no el emoji, que en Android parece un animal real):
// negra con brillo naranja alrededor.
function Murcielago({ tamano }: { tamano: number }) {
  return <MaterialCommunityIcons name="bat" size={tamano} color="#0d0716" style={estilos.brilloNaranja} />;
}

// Fantasma blanco con un brillo suave alrededor.
function Fantasma({ tamano }: { tamano: number }) {
  return <MaterialCommunityIcons name="ghost" size={tamano} color="#f5f3ef" style={estilos.brilloFantasma} />;
}

// Adorno quieto pegado a un borde: `lado` y `separacion` lo ubican en
// horizontal; `arriba`/`abajo` en vertical, medidos desde el borde seguro.
type Adorno = {
  lado: 'left' | 'right';
  separacion?: number;
  arriba?: number;
  abajo?: number;
  tamano: number;
  opacidad: number;
  giro?: string;
};

const posicionAdorno = (a: Adorno, insets: { top: number; bottom: number }) => ({
  [a.lado]: a.separacion ?? 4,
  ...(a.arriba !== undefined ? { top: insets.top + a.arriba } : { bottom: insets.bottom + (a.abajo ?? 0) }),
  opacity: a.opacidad,
  transform: [{ rotate: a.giro ?? '0deg' }],
});

// Telarañas: las esquinas de arriba, unas a media altura y las esquinas de
// abajo (por encima de la barra de tabs, que tiene ~62 px mas la zona de
// botones de Android). `giro` las acomoda a cada esquina.
const TELARANAS: Adorno[] = [
  { lado: 'right', arriba: 2, tamano: 40, opacidad: 0.6, giro: '0deg' },
  { lado: 'left', arriba: 2, tamano: 34, opacidad: 0.5, giro: '-90deg' },
  { lado: 'right', arriba: 60, tamano: 22, opacidad: 0.35, giro: '20deg' },
  { lado: 'left', arriba: 240, tamano: 26, opacidad: 0.35, giro: '-70deg' },
  { lado: 'right', arriba: 380, tamano: 24, opacidad: 0.35, giro: '10deg' },
  { lado: 'left', abajo: 76, tamano: 30, opacidad: 0.45, giro: '180deg' },
  { lado: 'right', abajo: 76, tamano: 34, opacidad: 0.5, giro: '90deg' },
];

// Calabazas sentadas sobre el borde de arriba de la barra de tabs, una en
// cada separacion entre las 4 tabs (25 %, 50 % y 75 % del ancho), asi no
// quedan encima de ningun icono. La barra mide 62 px mas la zona de botones
// de Android (ver useEstiloTabBar en tema.tsx); `ABAJO_SOBRE_TABS` deja la
// calabaza montada sobre el filo.
const CALABAZAS_TABS = [
  { centro: 0.25, tamano: 24, opacidad: 0.9 },
  { centro: 0.5, tamano: 28, opacidad: 0.95 },
  { centro: 0.75, tamano: 24, opacidad: 0.9 },
];
const ABAJO_SOBRE_TABS = 54;

// Nombre de la pantalla abierta (la mas interna: Captura, Confirmando...).
// Escucha el contenedor de navegacion desde aca y no con onStateChange en
// App.tsx, para que cambiar de pantalla solo vuelva a dibujar esta capa y no
// toda la navegacion.
function useRutaActual(navegacion: NavigationContainerRefWithCurrent<ParamListBase>) {
  const [ruta, setRuta] = useState<string | undefined>();
  useEffect(() => {
    const actualizar = () => setRuta(navegacion.getCurrentRoute()?.name);
    if (navegacion.isReady()) actualizar();
    return navegacion.addListener('state', actualizar);
  }, [navegacion]);
  return ruta;
}

// En las pantallas de RUTAS_SIN_VOLADORES los voladores se desmontan y sus
// animaciones se detienen.
export function CapaHalloween({
  navegacion,
}: {
  navegacion: NavigationContainerRefWithCurrent<ParamListBase>;
}) {
  const insets = useSafeAreaInsets();
  const reducirMovimiento = useSinMovimiento();
  const rutaActual = useRutaActual(navegacion);
  if (!HALLOWEEN_ACTIVO) return null;
  const conVoladores = !rutaActual || !RUTAS_SIN_VOLADORES.has(rutaActual);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {conVoladores ? (
        <View style={[StyleSheet.absoluteFill, { top: insets.top }]}>
          {MURCIELAGOS.map((ruta, i) => (
            <Volador key={`m${i}`} {...ruta} aleteo reducirMovimiento={reducirMovimiento}>
              <Murcielago tamano={ruta.tamano} />
            </Volador>
          ))}
          {FANTASMAS.map((ruta, i) => (
            <Volador key={`f${i}`} {...ruta} vaiven={24} reducirMovimiento={reducirMovimiento}>
              <Fantasma tamano={ruta.tamano} />
            </Volador>
          ))}
        </View>
      ) : null}
      {TELARANAS.map((t, i) => (
        <Text key={`t${i}`} style={[estilos.emoji, posicionAdorno(t, insets), { fontSize: t.tamano }]}>
          🕸️
        </Text>
      ))}
    </View>
  );
}

// Las calabazas de la barra de tabs van aparte: solo con sesion iniciada (se
// montan encima de las tabs, ver la pantalla Principal en Navegacion.tsx). La
// pantalla de entrada ya tiene las suyas en el fondo (DecoracionEntrada).
// Mismo emoji que esas.
export function CalabazasBorde() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (!HALLOWEEN_ACTIVO) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {CALABAZAS_TABS.map((c, i) => {
        // Caja un poco mas ancha que el emoji y texto centrado, para que el
        // centro de la calabaza caiga justo en la separacion.
        const ancho = c.tamano * 1.6;
        return (
          <Text
            key={`ct${i}`}
            style={[
              estilos.emoji,
              {
                width: ancho,
                textAlign: 'center',
                left: width * c.centro - ancho / 2,
                bottom: insets.bottom + ABAJO_SOBRE_TABS,
                fontSize: c.tamano,
                opacity: c.opacidad,
              },
            ]}
          >
            🎃
          </Text>
        );
      })}
    </View>
  );
}

// Dos calabazas en las esquinas de abajo del encabezado de Inicio (va justo
// despues de FondoEncabezado en PantallaInicio.tsx, por detras del contenido).
// Caben en el paddingBottom de 26 px del encabezado, debajo de las cifras, y
// se separan de los bordes lo justo para no quedar recortadas por las
// esquinas redondeadas (radio 32).
export function CalabazasEncabezado() {
  if (!HALLOWEEN_ACTIVO) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Text style={[estilos.emoji, estilos.calabazaEncabezado, { left: 30, transform: [{ rotate: '-12deg' }] }]}>
        🎃
      </Text>
      <Text style={[estilos.emoji, estilos.calabazaEncabezado, { right: 30, transform: [{ rotate: '12deg' }] }]}>
        🎃
      </Text>
    </View>
  );
}

// Una telaraña en cada extremo de la barra de tabs (va en tabBarBackground,
// ver FondoTabs en Navegacion.tsx), por detras de los iconos.
export function DecoracionTabs() {
  if (!HALLOWEEN_ACTIVO) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Text style={[estilos.emoji, estilos.telaranaTab, { left: 0, transform: [{ rotate: '-90deg' }] }]}>🕸️</Text>
      <Text style={[estilos.emoji, estilos.telaranaTab, { right: 0 }]}>🕸️</Text>
    </View>
  );
}

// Quieta a proposito, igual que el resto de FondoEntrada: en iOS el vidrio
// desenfoca este fondo y recalcula el desenfoque cada vez que algo se mueve.
export function DecoracionEntrada() {
  const { height } = useWindowDimensions();
  if (!HALLOWEEN_ACTIVO) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Resplandor naranja que sube desde abajo, como luz de calabaza. */}
      <LinearGradient
        colors={['rgba(255,122,26,0)', 'rgba(255,122,26,0.3)']}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Text style={[estilos.emoji, estilos.calabazaGrande]}>🎃</Text>
      <Text style={[estilos.emoji, estilos.calabazaChica]}>🎃</Text>
      <Text style={[estilos.emoji, estilos.fantasma, { top: height * 0.12 }]}>👻</Text>
      <Text style={[estilos.emoji, estilos.luna]}>🌕</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  emoji: {
    position: 'absolute',
    opacity: 0.5,
  },
  volador: {
    position: 'absolute',
    left: 0,
    opacity: 0.9,
  },
  brilloFantasma: {
    textShadowColor: 'rgba(255,255,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  brilloNaranja: {
    textShadowColor: 'rgba(255,122,26,1)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  calabazaEncabezado: {
    bottom: 2,
    fontSize: 20,
    opacity: 0.95,
  },
  telaranaTab: {
    top: 0,
    fontSize: 20,
    opacity: 0.35,
  },
  calabazaGrande: {
    bottom: 24,
    left: 18,
    fontSize: 54,
    opacity: 0.9,
  },
  calabazaChica: {
    bottom: 30,
    right: 26,
    fontSize: 38,
    opacity: 0.8,
  },
  fantasma: {
    right: 22,
    fontSize: 38,
    opacity: 0.6,
  },
  luna: {
    top: 48,
    left: 20,
    fontSize: 36,
    opacity: 0.7,
  },
});
