// Contenido de una tab a la que la sesion actual no tiene acceso (ver
// tieneAcceso en SesionContext.tsx). La tab se sigue viendo en la barra --
// asi todos saben que existe -- pero en vez de montar su stack real se
// muestra una vista "fantasma" de la seccion, oscurecida, con el aviso
// encima. El oscurecido es una capa semitransparente (no un blur real):
// expo-blur es nativo y obligaria a generar un .apk nuevo.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { nombreSesion, useSesion } from './SesionContext';
import {
  ACENTO,
  FUENTE_BODY,
  FUENTE_DISPLAY,
  FUENTE_DISPLAY_SEMI,
  NEUTRAL_400,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  NEUTRAL_850,
  NEUTRAL_900,
  TEXTO_PRIMARIO,
} from './tema';

export default function SinAcceso({
  titulo,
  icono,
}: {
  titulo: string;
  icono: keyof typeof Ionicons.glyphMap;
}) {
  const insets = useSafeAreaInsets();
  const { sesion, cerrarSesion } = useSesion();

  return (
    <View style={estilos.contenedor}>
      {/* Vista fantasma: solo la silueta de la seccion, sin datos. */}
      <View style={[estilos.fantasma, { paddingTop: insets.top + 24 }]} pointerEvents="none">
        <View style={estilos.fantasmaEncabezado}>
          <View style={estilos.fantasmaIcono}>
            <Ionicons name={icono} size={22} color={ACENTO} />
          </View>
          <Text style={estilos.fantasmaTitulo}>{titulo}</Text>
        </View>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={estilos.fantasmaTarjeta}>
            <View style={[estilos.fantasmaLinea, { width: '60%' }]} />
            <View style={[estilos.fantasmaLinea, { width: '85%' }]} />
          </View>
        ))}
      </View>

      <View style={estilos.velo}>
        <View style={estilos.tarjeta}>
          <View style={estilos.candado}>
            <Ionicons name="lock-closed-outline" size={28} color={ACENTO} />
          </View>
          <Text style={estilos.mensaje}>A esta área no tienes acceso</Text>
          <Text style={estilos.detalle}>
            Estás en la sesión de {nombreSesion(sesion)}. Si necesitas entrar a {titulo}, cierra sesión y entra con
            una cuenta que tenga acceso.
          </Text>
          <Pressable
            onPress={cerrarSesion}
            style={({ pressed }) => [estilos.boton, pressed && estilos.botonPresionado]}
          >
            <Text style={estilos.botonTexto}>Cerrar sesión</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: NEUTRAL_900 },
  fantasma: { flex: 1, paddingHorizontal: 20, gap: 14 },
  fantasmaEncabezado: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  fantasmaIcono: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(245,197,66,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fantasmaTitulo: { color: TEXTO_PRIMARIO, fontSize: 22, fontFamily: FUENTE_DISPLAY },
  fantasmaTarjeta: {
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  fantasmaLinea: { height: 12, borderRadius: 6, backgroundColor: NEUTRAL_800 },

  // Mismo fondo que el popup "¿Quién eres?" de PantallaLogin.
  velo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(4,7,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  tarjeta: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 20,
    padding: 22,
    gap: 14,
    alignItems: 'center',
  },
  candado: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,197,66,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mensaje: { color: TEXTO_PRIMARIO, fontSize: 19, fontFamily: FUENTE_DISPLAY, textAlign: 'center' },
  detalle: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY, textAlign: 'center', lineHeight: 19 },
  boton: {
    width: '100%',
    marginTop: 4,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  botonPresionado: { borderColor: NEUTRAL_500 },
  botonTexto: { color: '#f87171', fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 14 },
});

