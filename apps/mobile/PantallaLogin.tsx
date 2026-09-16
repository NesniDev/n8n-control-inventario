import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fetchEmpleados, fetchSedes, loginConPin, type Empleado, type EmpleadoBasico, type Sede } from './api';
import { mensajeError } from './errorMessages';

// elegir: elegir sede, centrada en la pantalla. Al tocar una sede se abre un
// popup con el personal de esa sede (ver modalBodeguero mas abajo) -- no es
// otro paso, es una ventana encima de la misma pantalla. pin: recien ahi
// confirma la identidad del bodeguero ya elegido (ver POST /auth/pin) -- no
// busca a quien pertenece.
type PasoLogin = 'elegir' | 'pin';

export default function PantallaLogin({
  onLogin,
}: {
  onLogin: (empleado: Empleado, sede: Sede) => void;
}) {
  const [paso, setPaso] = useState<PasoLogin>('elegir');

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [cargandoSedes, setCargandoSedes] = useState(true);
  const [errorSedes, setErrorSedes] = useState<string | null>(null);
  const [sedeElegida, setSedeElegida] = useState<Sede | null>(null);

  // El popup de bodegueros es independiente de sedeElegida: cerrarlo (X o
  // tocar afuera) no borra cual sede quedo marcada, solo oculta la ventana.
  const [modalBodegueroAbierto, setModalBodegueroAbierto] = useState(false);
  const [empleados, setEmpleados] = useState<EmpleadoBasico[]>([]);
  const [cargandoEmpleados, setCargandoEmpleados] = useState(false);
  const [errorEmpleados, setErrorEmpleados] = useState<string | null>(null);
  const [empleadoElegido, setEmpleadoElegido] = useState<EmpleadoBasico | null>(null);

  const [pin, setPin] = useState('');
  const [cargandoLogin, setCargandoLogin] = useState(false);
  const [errorLogin, setErrorLogin] = useState<string | null>(null);

  const cargarSedes = () => {
    setCargandoSedes(true);
    setErrorSedes(null);
    fetchSedes()
      .then(setSedes)
      .catch((err) => setErrorSedes(mensajeError(err, 'sedes')))
      .finally(() => setCargandoSedes(false));
  };

  // Una sola vez al montar -- elegir sede es el primer paso, siempre visible.
  useEffect(() => {
    cargarSedes();
  }, []);

  const cargarEmpleados = (sede: Sede) => {
    setCargandoEmpleados(true);
    setErrorEmpleados(null);
    fetchEmpleados(sede.id)
      // 'faia_viewer' es de solo lectura de fotos (panel /faia del
      // dashboard, en el navegador) -- no tiene nada que hacer en esta app
      // (el login ya lo rechaza si se cuela, ver ingresar() mas abajo), asi
      // que ni se lo ofrece como opcion en el selector de "quien sos".
      .then((lista) => setEmpleados(lista.filter((e) => e.rol !== 'faia_viewer')))
      .catch((err) => setErrorEmpleados(mensajeError(err, 'empleados')))
      .finally(() => setCargandoEmpleados(false));
  };

  // Tocar una sede abre el popup con su personal -- la sede queda marcada
  // de una, el popup solo agrega el paso de elegir quien es.
  const elegirSede = (sede: Sede) => {
    setSedeElegida(sede);
    setEmpleadoElegido(null);
    setModalBodegueroAbierto(true);
    cargarEmpleados(sede);
  };

  const elegirEmpleado = (empleado: EmpleadoBasico) => {
    setEmpleadoElegido(empleado);
    setModalBodegueroAbierto(false);
    setPaso('pin');
  };

  // Limpia el PIN/error al volver. La sede elegida queda como estaba -- solo
  // se resetea el empleado, no hace falta re-elegir sede para reintentar.
  const volver = () => {
    setPin('');
    setErrorLogin(null);
    setEmpleadoElegido(null);
    setPaso('elegir');
  };

  const ingresar = async () => {
    if (!sedeElegida || !empleadoElegido || pin.length < 4) return;
    setCargandoLogin(true);
    setErrorLogin(null);
    try {
      const empleado = await loginConPin(pin, empleadoElegido.id);
      // 'faia_viewer' es de solo lectura de fotos (panel /faia del
      // dashboard, en el navegador) -- no tiene nada que hacer en esta app,
      // ni siquiera entrar. El backend igual lo bloquea si de algun modo
      // llegara a fotografiar/confirmar (ver RolNoAutorizado), pero aca
      // se corta antes, con un mensaje que tenga sentido.
      if (empleado.rol === 'faia_viewer') {
        setErrorLogin('Este usuario es solo para ver fotos FAIA -- entrá desde el panel en la computadora.');
        setPin('');
        return;
      }
      onLogin(empleado, sedeElegida);
    } catch (err) {
      setErrorLogin(mensajeError(err, 'login'));
      setPin('');
    } finally {
      setCargandoLogin(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.marca}>
        <View style={styles.iconoCaja}>
          <Ionicons name="cube-outline" size={24} color={ACENTO} />
        </View>
        <Text style={styles.marcaTexto}>Control de despachos</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {paso === 'pin' ? (
          <Pressable onPress={volver} hitSlop={8} style={styles.botonVolver}>
            <Ionicons name="chevron-back" size={20} color={TEXTO_PRIMARIO} />
            <Text style={styles.botonVolverTexto}>Volver</Text>
          </Pressable>
        ) : null}

        {paso === 'elegir' ? (
          <View style={styles.seccion}>
            <Text style={styles.tituloSeccionCentrado}>Elige tu sede</Text>
            <Text style={[styles.subtituloSeccion, styles.subtituloCentrado]}>Desde dónde vas a trabajar hoy</Text>

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
              <View style={styles.filaTarjetas}>
                {sedes.map((sede) => {
                  const activa = sedeElegida?.id === sede.id;
                  return (
                    <Pressable
                      key={sede.id}
                      onPress={() => elegirSede(sede)}
                      style={({ pressed }) => [
                        styles.tarjetaSede,
                        activa && styles.tarjetaSedeActiva,
                        pressed && !activa && styles.tarjetaSedePresionada,
                      ]}
                    >
                      <View style={[styles.tarjetaSedeIcono, activa && styles.tarjetaSedeIconoActivo]}>
                        <Ionicons name="business" size={22} color={activa ? TEXTO_PRIMARIO : ACENTO} />
                      </View>
                      <Text style={[styles.tarjetaSedeTexto, activa && styles.tarjetaSedeTextoActivo]}>
                        {sede.nombre}
                      </Text>
                      {activa ? (
                        <View style={styles.marcaSeleccion}>
                          <Ionicons name="checkmark-circle" size={18} color={ACENTO} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {paso === 'pin' && sedeElegida && empleadoElegido ? (
          <View style={styles.seccion}>
            <View style={styles.identidadPin}>
              <View style={styles.avatarGrande}>
                <Text style={styles.avatarGrandeTexto}>{empleadoElegido.nombre.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.tituloSeccionCentrado}>{empleadoElegido.nombre}</Text>
              <View style={styles.badgeSede}>
                <Ionicons name="location" size={12} color={ACENTO} />
                <Text style={styles.badgeSedeTexto}>{sedeElegida.nombre}</Text>
              </View>
            </View>

            <Text style={styles.etiquetaPin}>Ingresa tu PIN</Text>

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
          </View>
        ) : null}
      </ScrollView>

      {/* Popup de bodegueros -- se abre al tocar una sede, encima de la
          misma pantalla. Cerrarlo (X o tocar afuera) no pierde la sede
          marcada, solo oculta la ventana. */}
      <Modal
        visible={modalBodegueroAbierto}
        transparent
        animationType="fade"
        onRequestClose={() => setModalBodegueroAbierto(false)}
      >
        <Pressable style={styles.fondoModal} onPress={() => setModalBodegueroAbierto(false)}>
          <Pressable style={styles.tarjetaModal} onPress={(e) => e.stopPropagation()}>
            <View style={styles.encabezadoModal}>
              <View>
                <Text style={styles.tituloSeccion}>¿Quién eres?</Text>
                <Text style={styles.subtituloSeccion}>Personal activo en {sedeElegida?.nombre}</Text>
              </View>
              <Pressable
                onPress={() => setModalBodegueroAbierto(false)}
                hitSlop={8}
                style={styles.botonCerrarModal}
              >
                <Ionicons name="close" size={20} color={NEUTRAL_400} />
              </Pressable>
            </View>

            {cargandoEmpleados ? (
              <ActivityIndicator color={ACENTO} style={styles.spinner} />
            ) : errorEmpleados ? (
              <View style={styles.bloqueError}>
                <Text style={styles.error}>{errorEmpleados}</Text>
                <Pressable
                  onPress={() => sedeElegida && cargarEmpleados(sedeElegida)}
                  style={styles.botonReintentar}
                >
                  <Text style={styles.botonReintentarTexto}>Reintentar</Text>
                </Pressable>
              </View>
            ) : empleados.length === 0 ? (
              <Text style={styles.sinDatos}>Todavía no hay personal registrado en esta sede.</Text>
            ) : (
              <ScrollView style={styles.listaPersonasScroll}>
                <View style={styles.listaPersonas}>
                  {empleados.map((empleado) => (
                    <Pressable
                      key={empleado.id}
                      onPress={() => elegirEmpleado(empleado)}
                      style={({ pressed }) => [styles.filaPersona, pressed && styles.filaPersonaPresionada]}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarTexto}>{empleado.nombre.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.filaPersonaTexto} numberOfLines={1}>
                        {empleado.nombre}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={NEUTRAL_500} />
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  marcaTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  iconoCaja: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonVolver: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  botonVolverTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_BODY_SEMI, fontSize: 14 },

  // flex:1 en el ScrollView (no solo en su contentContainerStyle) es lo que
  // hace que ocupe todo el alto restante debajo de "marca" -- sin esto,
  // "justifyContent: center" de abajo no tiene alto real donde centrar.
  scrollView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  seccion: {
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 20,
    padding: 22,
    gap: 18,
  },
  tituloSeccion: { color: TEXTO_PRIMARIO, fontSize: 18, fontFamily: FUENTE_DISPLAY },
  tituloSeccionCentrado: {
    color: TEXTO_PRIMARIO,
    fontSize: 22,
    fontFamily: FUENTE_DISPLAY,
    textAlign: 'center',
  },
  subtituloSeccion: { color: NEUTRAL_500, fontSize: 12.5, fontFamily: FUENTE_BODY, marginTop: 2 },
  subtituloCentrado: { textAlign: 'center', marginTop: -8 },

  spinner: { marginTop: 4 },
  bloqueError: { alignItems: 'center', gap: 10 },
  botonReintentar: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  botonReintentarTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_BODY_SEMI, fontSize: 13 },
  sinDatos: { color: NEUTRAL_500, fontSize: 13, fontFamily: FUENTE_BODY, textAlign: 'center' },

  // Sedes: tarjetas grandes lado a lado (son solo un par) -- mas facil de
  // tocar y de leer que chips chicos, y muestran claramente cual quedo
  // seleccionada.
  filaTarjetas: { flexDirection: 'row', gap: 14 },
  tarjetaSede: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    paddingVertical: 22,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1.5,
    borderColor: NEUTRAL_700,
  },
  tarjetaSedeActiva: { backgroundColor: 'rgba(200,99,31,0.14)', borderColor: ACENTO },
  tarjetaSedePresionada: { borderColor: NEUTRAL_500 },
  tarjetaSedeIcono: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(200,99,31,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tarjetaSedeIconoActivo: { backgroundColor: ACENTO },
  tarjetaSedeTexto: { color: NEUTRAL_400, fontSize: 15, fontFamily: FUENTE_BODY_BOLD, textAlign: 'center' },
  tarjetaSedeTextoActivo: { color: TEXTO_PRIMARIO },
  marcaSeleccion: { position: 'absolute', top: 10, right: 10 },

  // Popup de bodegueros -- Modal transparente con fondo oscuro, tarjeta
  // centrada. Tocar el fondo cierra; tocar la tarjeta no propaga al fondo.
  fondoModal: {
    flex: 1,
    backgroundColor: 'rgba(4,7,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  tarjetaModal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 20,
    padding: 20,
    gap: 16,
  },
  encabezadoModal: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  botonCerrarModal: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: NEUTRAL_800,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Personas: lista vertical con avatar (inicial del nombre) -- se lee como
  // un selector de contacto, mas intuitivo que chips sueltos para nombres.
  listaPersonasScroll: { flexGrow: 0 },
  listaPersonas: { gap: 8 },
  filaPersona: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  filaPersonaPresionada: { borderColor: ACENTO },
  filaPersonaTexto: { flex: 1, color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTexto: { color: ACENTO, fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 15 },

  identidadPin: { alignItems: 'center', gap: 8, marginBottom: 4 },
  avatarGrande: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGrandeTexto: { color: ACENTO, fontFamily: FUENTE_DISPLAY, fontSize: 22 },
  badgeSede: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: NEUTRAL_800,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeSedeTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  etiquetaPin: {
    color: NEUTRAL_500,
    fontSize: 12.5,
    fontFamily: FUENTE_BODY_SEMI,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  input: {
    width: '100%',
    backgroundColor: NEUTRAL_800,
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
  error: { color: '#f87171', fontSize: 13, fontFamily: FUENTE_BODY_SEMI, textAlign: 'center' },
  boton: {
    width: '100%',
    backgroundColor: ACENTO,
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
  },
  botonDeshabilitado: { opacity: 0.4 },
  botonPresionado: { opacity: 0.75 },
  botonTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 15 },
});
