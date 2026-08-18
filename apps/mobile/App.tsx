import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { fetchSedes, procesarEntrega, subirEvidencia, type Empleado, type Sede } from './api';
import PantallaLogin from './PantallaLogin';

type Estado = 'idle' | 'subiendo' | 'procesada' | 'pendiente_revision' | 'error';

const ESTADO_INFO: Record<Exclude<Estado, 'idle' | 'subiendo'>, { icono: string; texto: string; color: string; fondo: string }> = {
  procesada: { icono: '✅', texto: 'Procesada', color: '#34d399', fondo: 'rgba(52,211,153,0.12)' },
  pendiente_revision: { icono: '🕵️', texto: 'Pendiente de revisión', color: '#fbbf24', fondo: 'rgba(251,191,36,0.12)' },
  error: { icono: '⚠️', texto: 'Error', color: '#f87171', fondo: 'rgba(248,113,113,0.12)' },
};

export default function App() {
  const [empleado, setEmpleado] = useState<Empleado | null>(null);

  if (!empleado) {
    return <PantallaLogin onLogin={setEmpleado} />;
  }

  return <PantallaCaptura empleado={empleado} onCerrarSesion={() => setEmpleado(null)} />;
}

function PantallaCaptura({
  empleado,
  onCerrarSesion,
}: {
  empleado: Empleado;
  onCerrarSesion: () => void;
}) {
  const [foto, setFoto] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>('idle');
  const [mensaje, setMensaje] = useState('');
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeSeleccionada, setSedeSeleccionada] = useState<Sede | null>(null);
  const [errorSedes, setErrorSedes] = useState<string | null>(null);
  // La cuenta el bodeguero a mano al tomar la foto — manda sobre lo que la
  // IA de vision llegue a leer para este campo (ver api.ts/procesarEntrega).
  const [cantidadPendiente, setCantidadPendiente] = useState('');

  useEffect(() => {
    fetchSedes()
      .then((lista) => {
        setSedes(lista);
        // Preseleccionamos la sede del empleado logueado, pero se puede
        // cambiar (un operador puede estar cubriendo otra sede ese dia).
        setSedeSeleccionada(
          (actual) => actual ?? lista.find((s) => s.id === empleado.sede_id) ?? lista[0] ?? null
        );
      })
      .catch((err) => setErrorSedes(err?.message ?? 'No se pudieron cargar las sedes'));
  }, [empleado.sede_id]);

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

    if (!resultado.canceled && resultado.assets[0]) {
      setFoto(resultado.assets[0].uri);
      setEstado('idle');
      setMensaje('');
      setCantidadPendiente('');
    }
  };

  const cantidadPendienteValida = /^\d+$/.test(cantidadPendiente.trim());

  const enviar = async () => {
    if (!foto || !sedeSeleccionada || !cantidadPendienteValida) return;
    setEstado('subiendo');
    setMensaje('Subiendo evidencia...');

    try {
      const { url, hash } = await subirEvidencia(foto);
      setMensaje('Extrayendo datos con IA...');

      const resultado = await procesarEntrega({
        evidencia_url: url,
        hash_evidencia: hash,
        sede_origen_id: sedeSeleccionada.id,
        operador_id: empleado.id,
        capturado_at: new Date().toISOString(),
        cantidad_pendiente: Number(cantidadPendiente.trim()),
      });

      setEstado(resultado.estado);
      setMensaje(
        resultado.estado === 'procesada'
          ? 'Entrega registrada correctamente.'
          : 'Registrada, pero necesita revisión manual (baja confianza de la IA).'
      );
    } catch (err: any) {
      setEstado('error');
      const mensajeError: string =
        err?.status === 409
          ? (err?.detail ?? 'Esta entrega ya fue procesada — acción bloqueada.')
          : (err?.detail ?? err?.message ?? 'Error al procesar la entrega.');
      setMensaje(mensajeError);

      if (err?.status === 409) {
        // Duplicado: es la alerta mas importante del flujo (evita doble
        // despacho entre sedes) — un popup nativo no se puede pasar por
        // alto como el texto en pantalla.
        Alert.alert('⚠️ Entrega duplicada', mensajeError, [{ text: 'Entendido' }]);
      }
    }
  };

  const reiniciar = () => {
    setFoto(null);
    setEstado('idle');
    setMensaje('');
    setCantidadPendiente('');
  };

  const puedeEnviar =
    !!foto && !!sedeSeleccionada && cantidadPendienteValida && estado !== 'subiendo';
  const infoEstado = estado !== 'idle' && estado !== 'subiendo' ? ESTADO_INFO[estado] : null;

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
            <View style={{ flex: 1 }}>
              <Text style={styles.titulo}>📦 Captura de Despacho</Text>
              <Text style={styles.subtitulo}>👤 {empleado.nombre}</Text>
            </View>
            <Pressable onPress={onCerrarSesion} hitSlop={8}>
              <Text style={styles.cerrarSesion}>Cerrar sesión</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.tarjeta}>
          <Text style={styles.etiquetaSeccion}>Sede</Text>
          {errorSedes ? (
            <Text style={styles.textoErrorInline}>{errorSedes}</Text>
          ) : sedes.length === 0 ? (
            <ActivityIndicator style={{ alignSelf: 'flex-start', marginTop: 4 }} color="#c8631f" />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.selectorSedesContenido}
            >
              {sedes.map((s) => {
                const activa = sedeSeleccionada?.id === s.id;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSedeSeleccionada(s)}
                    style={[styles.chipSede, activa && styles.chipSedeActiva]}
                  >
                    <Text style={[styles.chipSedeTexto, activa && styles.chipSedeTextoActivo]}>
                      {activa ? '📍 ' : ''}
                      {s.nombre}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        <View style={styles.tarjeta}>
          <Text style={styles.etiquetaSeccion}>Evidencia</Text>
          {foto ? (
            <Image source={{ uri: foto }} style={styles.preview} resizeMode="cover" />
          ) : (
            <View style={[styles.preview, styles.previewVacio]}>
              <Text style={styles.previewIcono}>📷</Text>
              <Text style={styles.previewTexto}>Sin foto capturada</Text>
              <Text style={styles.previewSubtexto}>
                Encuadrá el documento completo, con buena luz
              </Text>
            </View>
          )}
        </View>

        {foto ? (
          <View style={styles.tarjeta}>
            <Text style={styles.etiquetaSeccion}>Cantidad pendiente</Text>
            <TextInput
              value={cantidadPendiente}
              onChangeText={setCantidadPendiente}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#6b7688"
              style={styles.inputCantidad}
            />
            <Text style={styles.previewSubtexto}>
              Cuántas unidades quedaron pendientes de este despacho
            </Text>
          </View>
        ) : null}

        {estado === 'subiendo' ? (
          <View style={[styles.tarjeta, styles.estadoBox]}>
            <ActivityIndicator color="#c8631f" />
            <Text style={styles.mensajeSubiendo}>{mensaje}</Text>
          </View>
        ) : infoEstado ? (
          <View style={[styles.badgeEstado, { backgroundColor: infoEstado.fondo }]}>
            <Text style={styles.badgeEstadoIcono}>{infoEstado.icono}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.badgeEstadoTitulo, { color: infoEstado.color }]}>
                {infoEstado.texto}
              </Text>
              <Text style={styles.badgeEstadoMensaje}>{mensaje}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.acciones}>
          <Pressable
            style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
            onPress={tomarFoto}
          >
            <Text style={styles.botonTexto}>{foto ? '🔁 Repetir foto' : '📷 Tomar foto'}</Text>
          </Pressable>

          {foto && estado !== 'procesada' && estado !== 'pendiente_revision' && (
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
              <Text style={styles.botonTexto}>
                {estado === 'subiendo' ? 'Procesando...' : '✅ Enviar y procesar'}
              </Text>
            </Pressable>
          )}

          {(estado === 'procesada' || estado === 'pendiente_revision') && (
            <Pressable
              style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
              onPress={reiniciar}
            >
              <Text style={styles.botonTexto}>➕ Nueva captura</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const NEUTRAL_900 = '#111827';
const NEUTRAL_850 = '#161f2e';
const NEUTRAL_800 = '#1c2534';
const NEUTRAL_700 = '#2a3446';
const NEUTRAL_500 = '#6b7688';
const NEUTRAL_400 = '#8a94a6';
const ACENTO = '#c8631f';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL_900,
    paddingTop: RNStatusBar.currentHeight ?? 0,
  },
  scroll: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { marginTop: 8, marginBottom: 4, gap: 4 },
  headerFila: { flexDirection: 'row', alignItems: 'flex-start' },
  titulo: { color: '#fff', fontSize: 24, fontWeight: '800' },
  subtitulo: { color: NEUTRAL_400, fontSize: 13 },
  cerrarSesion: { color: '#f87171', fontSize: 12, fontWeight: '600', marginTop: 6 },
  tarjeta: {
    backgroundColor: NEUTRAL_850,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    padding: 14,
    gap: 10,
  },
  etiquetaSeccion: {
    color: NEUTRAL_500,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textoErrorInline: { color: '#f87171', fontSize: 13 },
  inputCantidad: {
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  selectorSedesContenido: { gap: 8, paddingRight: 4 },
  chipSede: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  chipSedeActiva: { backgroundColor: ACENTO, borderColor: ACENTO },
  chipSedeTexto: { color: NEUTRAL_400, fontSize: 13, fontWeight: '600' },
  chipSedeTextoActivo: { color: '#fff' },
  preview: { width: '100%', height: 300, borderRadius: 12, backgroundColor: NEUTRAL_800 },
  previewVacio: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: NEUTRAL_700,
    borderStyle: 'dashed',
    gap: 4,
  },
  previewIcono: { fontSize: 40, marginBottom: 4 },
  previewTexto: { color: NEUTRAL_400, fontSize: 14, fontWeight: '600' },
  previewSubtexto: { color: NEUTRAL_500, fontSize: 12 },
  estadoBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mensajeSubiendo: { color: '#d3d9e6', fontSize: 14, flexShrink: 1 },
  badgeEstado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    padding: 14,
  },
  badgeEstadoIcono: { fontSize: 22 },
  badgeEstadoTitulo: { fontSize: 14, fontWeight: '700' },
  badgeEstadoMensaje: { color: '#d3d9e6', fontSize: 13, marginTop: 2 },
  acciones: { gap: 10, marginTop: 4 },
  boton: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  botonPresionado: { opacity: 0.75 },
  botonDeshabilitado: { opacity: 0.4 },
  botonPrimario: { backgroundColor: ACENTO, borderColor: ACENTO },
  botonTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
