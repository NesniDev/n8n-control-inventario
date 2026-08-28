import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fetchSedes, loginConPin, type Empleado, type Sede } from './api';

// sede: elegir desde donde se va a despachar hoy (puede no ser la sede del
// perfil del empleado, ej. cubriendo turno en otra). pin: el PIN identifica
// al empleado (ver POST /auth/pin) -- no hace falta elegirlo aparte.
type PasoLogin = 'sede' | 'pin';

export default function PantallaLogin({
  onLogin,
}: {
  onLogin: (empleado: Empleado, sede: Sede) => void;
}) {
  const [paso, setPaso] = useState<PasoLogin>('sede');

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [cargandoSedes, setCargandoSedes] = useState(true);
  const [errorSedes, setErrorSedes] = useState<string | null>(null);
  const [sedeElegida, setSedeElegida] = useState<Sede | null>(null);

  const [pin, setPin] = useState('');
  const [cargandoLogin, setCargandoLogin] = useState(false);
  const [errorLogin, setErrorLogin] = useState<string | null>(null);

  const cargarSedes = () => {
    setCargandoSedes(true);
    setErrorSedes(null);
    fetchSedes()
      .then(setSedes)
      .catch((err) => setErrorSedes(err instanceof Error ? err.message : 'No se pudieron cargar las sedes'))
      .finally(() => setCargandoSedes(false));
  };

  // Una sola vez al montar -- elegir sede es el primer paso, siempre visible.
  useEffect(() => {
    cargarSedes();
  }, []);

  const elegirSede = (sede: Sede) => {
    setSedeElegida(sede);
    setPaso('pin');
  };

  // Limpia el PIN/error al volver, para que un reintento no arrastre el
  // mensaje de la eleccion anterior.
  const volver = () => {
    setPin('');
    setErrorLogin(null);
    setSedeElegida(null);
    setPaso('sede');
  };

  const ingresar = async () => {
    if (!sedeElegida || pin.length < 4) return;
    setCargandoLogin(true);
    setErrorLogin(null);
    try {
      const empleado = await loginConPin(pin);
      onLogin(empleado, sedeElegida);
    } catch (err) {
      setErrorLogin(err instanceof Error ? err.message : 'PIN incorrecto');
      setPin('');
    } finally {
      setCargandoLogin(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {paso === 'pin' ? (
          <Pressable onPress={volver} hitSlop={8} style={styles.botonVolver}>
            <Ionicons name="chevron-back" size={26} color={TEXTO_PRIMARIO} />
          </Pressable>
        ) : null}

        <View style={styles.iconoCaja}>
          <Ionicons name={paso === 'sede' ? 'business-outline' : 'lock-closed'} size={26} color={ACENTO} />
        </View>

        {paso === 'sede' ? (
          <>
            <Text style={styles.titulo}>Elegí tu sede</Text>
            <Text style={styles.subtitulo}>Desde dónde vas a despachar hoy</Text>

            {cargandoSedes ? (
              <ActivityIndicator color={ACENTO} style={styles.spinner} />
            ) : errorSedes ? (
              <View style={styles.bloqueError}>
                <Text style={styles.error}>{errorSedes}</Text>
                <Pressable onPress={cargarSedes} style={styles.botonReintentar}>
                  <Text style={styles.botonReintentarTexto}>Reintentar</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.chips}>
                {sedes.map((sede) => (
                  <Pressable
                    key={sede.id}
                    onPress={() => elegirSede(sede)}
                    style={({ pressed }) => [styles.chipSede, pressed && styles.chipSedeActiva]}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.chipSedeTexto, pressed && styles.chipSedeTextoActivo]}>
                        {sede.nombre}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}

        {paso === 'pin' && sedeElegida ? (
          <>
            <Text style={styles.titulo}>Ingresá tu PIN</Text>
            <Text style={styles.subtitulo}>{sedeElegida.nombre} · sin usuario ni contraseña</Text>

            <TextInput
              value={pin}
              onChangeText={(v) => {
                setPin(v.replace(/[^0-9]/g, '').slice(0, 6));
                setErrorLogin(null);
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

            {errorLogin ? <Text style={styles.error}>{errorLogin}</Text> : null}

            <Pressable
              disabled={pin.length < 4 || cargandoLogin}
              onPress={ingresar}
              style={({ pressed }) => [
                styles.boton,
                (pin.length < 4 || cargandoLogin) && styles.botonDeshabilitado,
                pressed && styles.botonPresionado,
              ]}
            >
              {cargandoLogin ? (
                <ActivityIndicator color={TEXTO_PRIMARIO} />
              ) : (
                <Text style={styles.botonTexto}>Ingresar</Text>
              )}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// Mismos tokens que App.tsx -- se repiten aca porque son dos entry points
// distintos (esta pantalla se muestra ANTES de que exista un empleado
// logueado, App.tsx recien monta PantallaCaptura despues).
const NEUTRAL_900 = '#0f1520';
const NEUTRAL_850 = '#161d29';
const NEUTRAL_800 = '#1d2635';
const NEUTRAL_700 = '#2a3446';
const NEUTRAL_500 = '#6b7688';
const NEUTRAL_400 = '#9aa3b5';
const TEXTO_PRIMARIO = '#f5f3ef';
const ACENTO = '#c8631f';
const FUENTE_DISPLAY = 'SpaceGrotesk_700Bold';
const FUENTE_DISPLAY_SEMI = 'SpaceGrotesk_600SemiBold';
const FUENTE_BODY = 'Manrope_400Regular';
const FUENTE_BODY_SEMI = 'Manrope_600SemiBold';
const FUENTE_BODY_BOLD = 'Manrope_700Bold';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL_900,
    paddingTop: RNStatusBar.currentHeight ?? 0,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 8,
  },
  botonVolver: { alignSelf: 'flex-start', marginBottom: 4 },
  iconoCaja: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  titulo: { color: TEXTO_PRIMARIO, fontSize: 24, fontFamily: FUENTE_DISPLAY, textAlign: 'center' },
  subtitulo: {
    color: NEUTRAL_500,
    fontSize: 13.5,
    fontFamily: FUENTE_BODY,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 260,
  },
  spinner: { marginTop: 12 },
  bloqueError: { alignItems: 'center', gap: 10, marginTop: 8 },
  botonReintentar: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  botonReintentarTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_BODY_SEMI, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  chipSede: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  chipSedeActiva: { backgroundColor: ACENTO, borderColor: ACENTO },
  chipSedeTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_BOLD },
  chipSedeTextoActivo: { color: TEXTO_PRIMARIO },
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
  error: { color: '#f87171', fontSize: 13, fontFamily: FUENTE_BODY_SEMI, marginTop: 12, textAlign: 'center' },
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
