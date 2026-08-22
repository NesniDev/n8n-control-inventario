import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { loginConPin, type Empleado } from './api';

export default function PantallaLogin({ onLogin }: { onLogin: (empleado: Empleado) => void }) {
  const [pin, setPin] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingresar = async () => {
    if (pin.length < 4) return;
    setCargando(true);
    setError(null);
    try {
      const empleado = await loginConPin(pin);
      onLogin(empleado);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN incorrecto');
      setPin('');
    } finally {
      setCargando(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconoCaja}>
        <Ionicons name="lock-closed" size={26} color={ACENTO} />
      </View>
      <Text style={styles.titulo}>Ingresá tu PIN</Text>
      <Text style={styles.subtitulo}>Sin usuario ni contraseña — solo tu PIN de operador</Text>

      <TextInput
        value={pin}
        onChangeText={(v) => {
          setPin(v.replace(/[^0-9]/g, '').slice(0, 6));
          setError(null);
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoFocus
        placeholder="• • • •"
        placeholderTextColor={NEUTRAL_500}
        style={styles.input}
        onSubmitEditing={ingresar}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        disabled={pin.length < 4 || cargando}
        onPress={ingresar}
        style={({ pressed }) => [
          styles.boton,
          (pin.length < 4 || cargando) && styles.botonDeshabilitado,
          pressed && styles.botonPresionado,
        ]}
      >
        {cargando ? (
          <ActivityIndicator color={TEXTO_PRIMARIO} />
        ) : (
          <Text style={styles.botonTexto}>Ingresar</Text>
        )}
      </Pressable>
    </View>
  );
}

// Mismos tokens que App.tsx -- se repiten aca porque son dos entry points
// distintos (esta pantalla se muestra ANTES de que exista un empleado
// logueado, App.tsx recien monta PantallaCaptura despues).
const NEUTRAL_900 = '#0f1520';
const NEUTRAL_850 = '#161d29';
const NEUTRAL_700 = '#2a3446';
const NEUTRAL_500 = '#6b7688';
const TEXTO_PRIMARIO = '#f5f3ef';
const ACENTO = '#c8631f';
const FUENTE_DISPLAY = 'SpaceGrotesk_700Bold';
const FUENTE_DISPLAY_SEMI = 'SpaceGrotesk_600SemiBold';
const FUENTE_BODY = 'Manrope_400Regular';
const FUENTE_BODY_SEMI = 'Manrope_600SemiBold';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL_900,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: RNStatusBar.currentHeight ?? 0,
    gap: 8,
  },
  iconoCaja: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  titulo: { color: TEXTO_PRIMARIO, fontSize: 24, fontFamily: FUENTE_DISPLAY },
  subtitulo: {
    color: NEUTRAL_500,
    fontSize: 13.5,
    fontFamily: FUENTE_BODY,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 260,
  },
  input: {
    width: '100%',
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 16,
    paddingVertical: 17,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    color: TEXTO_PRIMARIO,
    fontFamily: FUENTE_DISPLAY_SEMI,
  },
  error: { color: '#f87171', fontSize: 13, fontFamily: FUENTE_BODY_SEMI, marginTop: 12 },
  boton: {
    width: '100%',
    backgroundColor: ACENTO,
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  botonDeshabilitado: { opacity: 0.4 },
  botonPresionado: { opacity: 0.75 },
  botonTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 15 },
});
