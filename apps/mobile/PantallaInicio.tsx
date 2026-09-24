// Tab de Inicio -- lo primero que se ve al abrir la app, ANTES de cualquier
// login (cada area tiene el suyo), asi que no muestra datos de ninguna sede
// ni punto: portada a todo el ancho con la imagen de la empresa y, encima, el
// saludo con la fecha; debajo, el estado de conexion con el backend +
// version/actualizacion instalada (para saber si se puede trabajar y, en
// soporte, que version tiene el celular).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, ImageBackground, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_850,
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
]

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

// Carrusel de consejos: pasa solo al siguiente cada SEGUNDOS_POR_CONSEJO con
// un fundido (Animated del core, sin librerias), tocar adelanta uno, y los
// puntos marcan cual se esta viendo. Se pausa cuando Inicio no esta en
// pantalla (useIsFocused) para no trabajar de fondo.
function CarruselConsejos() {
  const enPantalla = useIsFocused();
  const [indice, setIndice] = useState(() => indiceDelDia(new Date()));
  const opacidad = useRef(new Animated.Value(1)).current;

  const avanzar = useCallback(() => {
    Animated.timing(opacidad, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setIndice((i) => (i + 1) % CONSEJOS.length);
      Animated.timing(opacidad, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    });
  }, [opacidad]);

  // Se reinicia el temporizador en cada cambio (tambien al tocar), asi un
  // consejo recien adelantado a mano se ve los segundos completos.
  useEffect(() => {
    if (!enPantalla) return;
    const id = setTimeout(avanzar, SEGUNDOS_POR_CONSEJO * 1000);
    return () => clearTimeout(id);
  }, [enPantalla, indice, avanzar]);

  const consejo = CONSEJOS[indice];
  const area = AREAS_CONSEJO[consejo.area];

  return (
    <Pressable onPress={avanzar} style={({ pressed }) => [estilos.consejo, pressed && { opacity: 0.85 }]}>
      <View style={estilos.consejoEncabezado}>
        <Ionicons name="bulb-outline" size={16} color="#fbbf24" />
        <Text style={estilos.consejoEtiqueta}>Consejos</Text>
        <Animated.View style={[estilos.chipArea, { borderColor: area.color, opacity: opacidad }]}>
          <Ionicons name={area.icono} size={12} color={area.color} />
          <Text style={[estilos.chipAreaTexto, { color: area.color }]}>{area.texto}</Text>
        </Animated.View>
        <Text style={estilos.consejoContador}>
          {indice + 1}/{CONSEJOS.length}
        </Text>
      </View>
      <Animated.View style={[estilos.consejoFila, { opacity: opacidad }]}>
        <Ionicons name={consejo.icono} size={22} color={NEUTRAL_400} />
        <Text style={estilos.consejoTexto}>{consejo.texto}</Text>
      </Animated.View>
      <View style={estilos.puntos}>
        {CONSEJOS.map((_, i) => (
          <View key={i} style={[estilos.puntoConsejo, i === indice && estilos.puntoConsejoActivo]} />
        ))}
      </View>
    </Pressable>
  );
}

// Fundido de la portada hacia el fondo de la app, sin expo-linear-gradient
// (trae codigo nativo y obligaria a generar un .apk nuevo; asi sigue
// llegando por EAS Update). Capas acumuladas: cada una arranca en su altura
// y llega hasta abajo, con la opacidad justa para que la suma siga la curva
// (i/N)^2. Asi no hay bordes que se pisen -- con franjas contiguas quedaban
// lineas visibles (claras si habia hueco, oscuras si se superponian).
const CAPAS_DEGRADADO = 32;
const OPACIDADES_CAPAS = Array.from({ length: CAPAS_DEGRADADO }, (_, i) => {
  const objetivo = (k: number) => Math.pow(k / CAPAS_DEGRADADO, 2);
  const antes = objetivo(i);
  const despues = objetivo(i + 1);
  return 1 - (1 - despues) / (1 - antes);
});

function Degradado({ alto }: { alto: number }) {
  const paso = alto / CAPAS_DEGRADADO;
  return (
    <View style={[estilos.degradado, { height: alto }]} pointerEvents="none">
      {OPACIDADES_CAPAS.map((opacidad, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: Math.round(i * paso),
            bottom: 0,
            backgroundColor: NEUTRAL_900,
            opacity: opacidad,
          }}
        />
      ))}
    </View>
  );
}

export default function PantallaInicio() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [ahora, setAhora] = useState(() => new Date());
  const [conexion, setConexion] = useState<EstadoConexion>('verificando');

  // Se refresca cada minuto -- para que el saludo y la fecha cambien solos
  // si la app queda abierta al pasar el mediodia o la medianoche.
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

  const infoConexion = {
    verificando: { texto: 'Verificando conexión…', color: NEUTRAL_400, icono: 'sync-outline' as const },
    conectado: { texto: 'Conectado al servidor', color: '#34d399', icono: 'cloud-done-outline' as const },
    sin_conexion: { texto: 'Sin conexión al servidor', color: '#f87171', icono: 'cloud-offline-outline' as const },
  }[conexion];

  const { texto: textoSaludo, icono: iconoSaludo } = saludo(ahora.getHours());
  // Portada mas baja que antes: logo + saludo sin el hueco vacio de abajo.
  const altoPortada = Math.max(width * 0.86, 340) + insets.top;
  const dia = DIAS[ahora.getDay()];

  const abrirWhatsapp = () =>
    abrirEnlace(
      `https://wa.me/${SOPORTE.telefonoInternacional}?text=${encodeURIComponent('Hola Neider, necesito ayuda con la app de despachos.')}`,
      'WhatsApp'
    );

  return (
    <View style={estilos.contenedor}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
        {/* Portada: la imagen de la empresa a todo el ancho como fondo
            (desenfocada y oscurecida, asi el texto propio del logo no choca
            con el saludo), con el logo nitido encima y el texto sobre ella.
            Pasa por debajo de la barra de estado. */}
        <ImageBackground source={LOGO} style={{ width, height: altoPortada }} resizeMode="cover" blurRadius={18}>
          <View style={estilos.velo} />
          <Degradado alto={altoPortada * 0.5} />

          {/* Estado de conexion como pastilla (tocar re-verifica) -- es un
              dato secundario, no merece una tarjeta entera. */}
          <Pressable
            onPress={verificarConexion}
            hitSlop={8}
            style={[estilos.pastillaConexion, { top: insets.top + 12, borderColor: infoConexion.color }]}
          >
            <View style={[estilos.puntoConexion, { backgroundColor: infoConexion.color }]} />
            <Text style={[estilos.pastillaConexionTexto, { color: infoConexion.color }]}>
              {conexion === 'conectado' ? 'Conectado' : conexion === 'sin_conexion' ? 'Sin conexión · Reintentar' : 'Verificando…'}
            </Text>
          </Pressable>

          <View style={[estilos.contenidoPortada, { paddingTop: insets.top + 36 }]}>
            <View style={estilos.marcoLogo}>
              <Image source={LOGO} style={estilos.logo} resizeMode="cover" />
            </View>

            <View style={estilos.textoPortada}>
              <View style={estilos.filaSaludo}>
                <Ionicons name={iconoSaludo} size={26} color={ACENTO} />
                <Text style={estilos.saludo}>{textoSaludo}</Text>
              </View>
              <Text style={estilos.fecha}>
                {dia.charAt(0).toUpperCase() + dia.slice(1)} {ahora.getDate()} de {MESES[ahora.getMonth()]} de{' '}
                {ahora.getFullYear()}
              </Text>
            </View>
          </View>
        </ImageBackground>

        <View style={estilos.cuerpo}>
          {conexion === 'sin_conexion' ? (
            // Aviso visible solo cuando hace falta: sin servidor no se puede
            // enviar nada, mejor saberlo antes de entrar a un area.
            <Pressable onPress={verificarConexion} style={estilos.avisoSinConexion}>
              <Ionicons name="cloud-offline-outline" size={20} color="#f87171" />
              <Text style={estilos.avisoSinConexionTexto}>
                No hay conexión con el servidor. Espera a tener señal antes de enviar.
              </Text>
              <Ionicons name="refresh" size={18} color="#f87171" />
            </Pressable>
          ) : null}

          <CarruselConsejos />

          {/* Soporte en una sola fila, con el boton de WhatsApp a la derecha. */}
          <Pressable
            onPress={abrirWhatsapp}
            style={({ pressed }) => [estilos.soporte, pressed && { opacity: 0.85 }]}
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
          </Pressable>

          <View style={{ flex: 1 }} />

          {/* Pie: indicacion para empezar + version, discretos, justo arriba
              del menu de tabs. */}
          <View style={estilos.pie}>
            <View style={estilos.pieIndicacion}>
              <Text style={estilos.pieIndicacionTexto}>Elige tu área en el menú de abajo</Text>
              <Ionicons name="arrow-down" size={14} color={ACENTO} />
            </View>
            <Text style={estilos.version}>{textoActualizacion()}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: NEUTRAL_900 },
  degradado: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  velo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,21,32,0.45)' },
  pastillaConexion: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(15,21,32,0.6)',
  },
  pastillaConexionTexto: { fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  puntoConexion: { width: 8, height: 8, borderRadius: 4 },
  contenidoPortada: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 16, gap: 18 },
  marcoLogo: {
    width: 150,
    height: 150,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  logo: { width: '100%', height: '100%' },
  textoPortada: { alignItems: 'center', gap: 4, paddingHorizontal: 20 },
  filaSaludo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saludo: {
    color: TEXTO_PRIMARIO,
    fontSize: 32,
    fontFamily: FUENTE_DISPLAY,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 8,
  },
  fecha: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI, opacity: 0.85 },
  cuerpo: { flex: 1, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, gap: 12 },
  avisoSinConexion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(248,113,113,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
  },
  avisoSinConexionTexto: { flex: 1, color: '#fca5a5', fontSize: 13, fontFamily: FUENTE_BODY },
  consejo: {
    gap: 12,
    padding: 18,
    borderRadius: 18,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  consejoEncabezado: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  consejoEtiqueta: { color: '#fbbf24', fontSize: 12, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase' },
  chipArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    marginLeft: 4,
  },
  chipAreaTexto: { fontSize: 11.5, fontFamily: FUENTE_BODY_SEMI },
  consejoContador: { marginLeft: 'auto', color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  // Alto minimo fijo: los consejos tienen largos distintos y sin esto la
  // tarjeta "saltaria" de alto en cada cambio.
  consejoFila: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 66 },
  consejoTexto: { flex: 1, color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY, lineHeight: 22 },
  puntos: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  puntoConsejo: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(251,191,36,0.25)' },
  puntoConsejoActivo: { width: 16, backgroundColor: '#fbbf24' },
  soporte: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  soporteIcono: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(200,99,31,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soporteTitulo: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  soporteTexto: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY },
  botonWhatsapp: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1faa59',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pie: { alignItems: 'center', gap: 6, paddingTop: 12 },
  pieIndicacion: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pieIndicacionTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  version: { color: NEUTRAL_500, fontSize: 11.5, fontFamily: FUENTE_BODY },
});
