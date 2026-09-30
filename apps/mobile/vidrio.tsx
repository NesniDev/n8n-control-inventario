// Piezas visuales de la entrada (PantallaEntrada + PantallaLogin): vidrio con
// desenfoque real (expo-blur), avatares y boton con degradado
// (expo-linear-gradient) y vibracion al tocar (expo-haptics).
//
// Las tres son librerias nativas: este cambio necesita un .apk nuevo (ver
// CLAUDE.md, "Actualizaciones de la app movil"); los .apk viejos no reciben
// esta actualizacion por OTA hasta reinstalar.
//
// Android solo desenfoca lo que esta dentro de un BlurTargetView: el fondo
// de la entrada va envuelto en uno y su ref llega a cada Vidrio por
// ProveedorFondo. En Android < 12 (SDK 31) no hay desenfoque y el vidrio
// queda como una capa oscura translucida -- se sigue leyendo bien.
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { FUENTE_DISPLAY, FUENTE_DISPLAY_SEMI, TEXTO_PRIMARIO } from './tema';

const ContextoFondo = createContext<RefObject<View | null> | null>(null);

export const ProveedorFondo = ContextoFondo.Provider;

export function Vidrio({
  style,
  intensidad = 45,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  intensidad?: number;
  children?: ReactNode;
}) {
  const objetivo = useContext(ContextoFondo);
  return (
    <BlurView
      intensity={intensidad}
      tint="dark"
      blurMethod="dimezisBlurViewSdk31Plus"
      blurTarget={objetivo ?? undefined}
      style={[estilos.vidrio, style]}
    >
      {children}
    </BlurView>
  );
}

// Paleta de la entrada, sacada del logo de la empresa: cielo azul, campo
// verde y letras doradas. Solo la usan la entrada y el login; el resto de la
// app sigue con el naranja de tema.tsx.
export const MARCA = {
  cielo: '#1f56b8',
  azul: '#123a82',
  noche: '#081633',
  oro: '#f5c542',
  // Verde oficial de la marca, indicado explicitamente -- usar este tono.
  verde: '#3d8e33',
  // Texto/iconos encima del dorado: el blanco no contrasta sobre amarillo.
  tinta: '#0b1d45',
} as const;

// Degradado dorado -- boton principal y pastilla del selector.
export const DEGRADADO_ACENTO = ['#ffd766', '#f0b21a'] as const;

// Pares de degradado para los avatares; el nombre elige siempre el mismo, asi
// cada persona se reconoce por su color en la lista.
const DEGRADADOS_AVATAR = [
  ['#f59e4b', '#c8631f'],
  ['#60a5fa', '#2f5fb3'],
  ['#4ade80', '#1f8a5a'],
  ['#c084fc', '#7a3fb8'],
  ['#fb7185', '#b8334f'],
  ['#fcd34d', '#b3861f'],
] as const;

const degradadoDe = (nombre: string) =>
  DEGRADADOS_AVATAR[[...nombre].reduce((suma, letra) => suma + letra.charCodeAt(0), 0) % DEGRADADOS_AVATAR.length];

const iniciales = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join('');

// Avatar redondo con degradado: iniciales del nombre, o un icono si viene.
export function Avatar({ nombre, tamano, icono }: { nombre: string; tamano: number; icono?: ReactNode }) {
  return (
    <LinearGradient
      colors={icono ? DEGRADADO_ACENTO : degradadoDe(nombre)}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[estilos.avatar, { width: tamano, height: tamano, borderRadius: tamano / 2 }]}
    >
      {icono ?? (
        <Text style={[estilos.avatarTexto, { fontSize: tamano * 0.36, fontFamily: tamano > 70 ? FUENTE_DISPLAY : FUENTE_DISPLAY_SEMI }]}>
          {iniciales(nombre)}
        </Text>
      )}
    </LinearGradient>
  );
}

export function BotonDegradado({
  texto,
  onPress,
  deshabilitado = false,
  cargando = false,
}: {
  texto: string;
  onPress: () => void;
  deshabilitado?: boolean;
  cargando?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado || cargando}
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado || cargando, busy: cargando }}
      style={({ pressed }) => [estilos.boton, deshabilitado && estilos.botonDeshabilitado, pressed && estilos.botonPresionado]}
    >
      <LinearGradient colors={DEGRADADO_ACENTO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={estilos.botonFondo}>
        {cargando ? <ActivityIndicator color={MARCA.tinta} /> : <Text style={estilos.botonTexto}>{texto}</Text>}
      </LinearGradient>
    </Pressable>
  );
}

// Vibracion corta de confirmacion. Si el celular no tiene motor de
// vibracion (o esta desactivado) simplemente no pasa nada.
const sinFalla = (promesa: Promise<void>) => {
  promesa.catch(() => {});
};

export const vibrar = {
  seleccion: () => sinFalla(Haptics.selectionAsync()),
  exito: () => sinFalla(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => sinFalla(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

const estilos = StyleSheet.create({
  // Fondo oscuro translucido encima del desenfoque: garantiza contraste del
  // texto aunque detras haya partes claras de la foto.
  vidrio: {
    overflow: 'hidden',
    backgroundColor: 'rgba(8,22,51,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarTexto: { color: TEXTO_PRIMARIO },
  boton: { width: '100%', borderRadius: 18, overflow: 'hidden' },
  botonFondo: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  botonDeshabilitado: { opacity: 0.4 },
  botonPresionado: { opacity: 0.8 },
  botonTexto: { color: MARCA.tinta, fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 16 },
});
