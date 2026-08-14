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
      <Text style={styles.icono}>🔒</Text>
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
        placeholderTextColor="#4b5568"
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
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.botonTexto}>Ingresar</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: RNStatusBar.currentHeight ?? 0,
    gap: 8,
  },
  icono: { fontSize: 40, marginBottom: 8 },
  titulo: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subtitulo: { color: '#8a94a6', fontSize: 13, textAlign: 'center', marginBottom: 24 },
  input: {
    width: '100%',
    backgroundColor: '#1c2534',
    borderWidth: 1,
    borderColor: '#2a3446',
    borderRadius: 12,
    paddingVertical: 16,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    color: '#fff',
  },
  error: { color: '#f87171', fontSize: 13, marginTop: 12 },
  boton: {
    width: '100%',
    backgroundColor: '#c8631f',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  botonDeshabilitado: { opacity: 0.4 },
  botonPresionado: { opacity: 0.75 },
  botonTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
