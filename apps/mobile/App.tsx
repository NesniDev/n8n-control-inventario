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

import {
  confirmarItems,
  fetchSedes,
  procesarEntrega,
  subirEvidencia,
  type Empleado,
  type ItemEntrega,
  type Sede,
} from './api';
import PantallaLogin from './PantallaLogin';

// captura: tomar/elegir foto y mandarla (paso 1, identifica el documento).
// confirmando: el bodeguero ve los productos y carga cantidades (paso 2).
// resultado: pantalla final (procesada / pendiente de revision / error).
type Fase = 'captura' | 'confirmando' | 'resultado';
type EstadoFinal = 'procesada' | 'pendiente_revision' | 'error';

const ESTADO_INFO: Record<EstadoFinal, { icono: string; texto: string; color: string; fondo: string }> = {
  procesada: { icono: '✅', texto: 'Procesada', color: '#34d399', fondo: 'rgba(52,211,153,0.12)' },
  pendiente_revision: { icono: '🕵️', texto: 'Pendiente de revisión', color: '#fbbf24', fondo: 'rgba(251,191,36,0.12)' },
  error: { icono: '⚠️', texto: 'Error', color: '#f87171', fondo: 'rgba(248,113,113,0.12)' },
};

interface ItemFormulario extends ItemEntrega {
  valor: string;
}

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
  const [fase, setFase] = useState<Fase>('captura');
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeSeleccionada, setSedeSeleccionada] = useState<Sede | null>(null);
  const [errorSedes, setErrorSedes] = useState<string | null>(null);

  // Datos de la evidencia ya subida, necesarios para el paso 2.
  const [entregaId, setEntregaId] = useState<string | null>(null);
  const [situacion, setSituacion] = useState<'nueva' | 'actualizable' | null>(null);
  const [estadoFinal, setEstadoFinal] = useState<EstadoFinal | null>(null);
  const [items, setItems] = useState<ItemFormulario[]>([]);
  const [evidenciaActual, setEvidenciaActual] = useState<{ url: string; hash: string } | null>(null);

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

  const usarResultado = (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      setFoto(resultado.assets[0].uri);
      setFase('captura');
      setMensaje('');
    }
  };

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

    usarResultado(resultado);
  };

  const elegirDeGaleria = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a las fotos para elegir la guía.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });

    usarResultado(resultado);
  };

  // Paso 1: sube la foto y le pide al backend que identifique el documento.
  const enviar = async () => {
    if (!foto || !sedeSeleccionada) return;
    setCargando(true);
    setMensaje('Subiendo evidencia...');

    try {
      const { url, hash } = await subirEvidencia(foto);
      setEvidenciaActual({ url, hash });
      setMensaje('Extrayendo datos con IA...');

      const resultado = await procesarEntrega({
        evidencia_url: url,
        hash_evidencia: hash,
        sede_origen_id: sedeSeleccionada.id,
        operador_id: empleado.id,
        capturado_at: new Date().toISOString(),
      });

      setEntregaId(resultado.id);
      setSituacion(resultado.situacion);
      setEstadoFinal(resultado.estado);
      setItems(resultado.items.map((item) => ({ ...item, valor: '' })));
      setFase('confirmando');
      setMensaje('');
    } catch (err: any) {
      setFase('resultado');
      setEstadoFinal('error');
      const mensajeError: string =
        err?.status === 409
          ? (err?.detail ?? 'Este documento ya fue entregado por completo — acción bloqueada.')
          : (err?.detail ?? err?.message ?? 'Error al procesar la entrega.');
      setMensaje(mensajeError);

      if (err?.status === 409) {
        // Ya no queda nada pendiente: es la alerta mas importante del flujo
        // (evita doble despacho entre sedes) — un popup nativo no se puede
        // pasar por alto como el texto en pantalla.
        Alert.alert('⚠️ Nada pendiente', mensajeError, [{ text: 'Entendido' }]);
      }
    } finally {
      setCargando(false);
    }
  };

  // Paso 2: confirma lo que cargo el bodeguero por producto.
  const confirmar = async () => {
    if (!entregaId || !situacion || !evidenciaActual) return;
    setCargando(true);
    setMensaje('Guardando...');

    try {
      const payload = items.map((item) =>
        situacion === 'nueva'
          ? { id: item.id, cantidad_pendiente: Number(item.valor.trim()) }
          : { id: item.id, entregado_hoy: Number(item.valor.trim()) }
      );
      await confirmarItems(
        entregaId,
        payload,
        empleado.id,
        sedeSeleccionada?.id ?? '',
        evidenciaActual.url,
        evidenciaActual.hash
      );
      setFase('resultado');
      setMensaje(
        estadoFinal === 'procesada'
          ? 'Entrega registrada correctamente.'
          : 'Registrada, pero necesita revisión manual (baja confianza de la IA).'
      );
    } catch (err: any) {
      setMensaje(err?.detail ?? err?.message ?? 'Error al guardar las cantidades.');
    } finally {
      setCargando(false);
    }
  };

  const actualizarValorItem = (id: string, valor: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, valor } : item)));
  };

  const reiniciar = () => {
    setFoto(null);
    setFase('captura');
    setMensaje('');
    setEntregaId(null);
    setSituacion(null);
    setEstadoFinal(null);
    setItems([]);
    setEvidenciaActual(null);
  };

  const itemsValidos =
    items.length > 0 && items.every((item) => /^\d+$/.test(item.valor.trim()));
  const puedeEnviar = !!foto && !!sedeSeleccionada && !cargando;
  const puedeConfirmar = itemsValidos && !cargando;
  const infoEstadoFinal = fase === 'resultado' && estadoFinal ? ESTADO_INFO[estadoFinal] : null;

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

        {fase === 'captura' ? (
          <>
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

            {cargando ? (
              <View style={[styles.tarjeta, styles.estadoBox]}>
                <ActivityIndicator color="#c8631f" />
                <Text style={styles.mensajeSubiendo}>{mensaje}</Text>
              </View>
            ) : null}

            <View style={styles.acciones}>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={tomarFoto}
              >
                <Text style={styles.botonTexto}>{foto ? '🔁 Repetir foto' : '📷 Tomar foto'}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={elegirDeGaleria}
              >
                <Text style={styles.botonTexto}>{foto ? '🖼️ Cambiar de galería' : '🖼️ Elegir de galería'}</Text>
              </Pressable>

              {foto ? (
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
                  <Text style={styles.botonTexto}>{cargando ? 'Procesando...' : '✅ Enviar y procesar'}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}

        {fase === 'confirmando' ? (
          <>
            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>
                {situacion === 'nueva' ? 'Documento nuevo' : 'Ya estaba registrado'}
              </Text>
              <Text style={styles.previewSubtexto}>
                {situacion === 'nueva'
                  ? 'Cargá cuánto quedó pendiente de cada producto.'
                  : 'Todavía le queda algo pendiente. Cargá cuánto entregaste hoy de cada producto.'}
              </Text>
            </View>

            {items.map((item) => {
              const bloqueado = situacion === 'nueva' && item.valor.trim() === '0';
              return (
                <View key={item.id} style={styles.tarjeta}>
                  <Text style={styles.itemDescripcion}>{item.descripcion || 'Producto sin descripción'}</Text>
                  <Text style={styles.previewSubtexto}>
                    {situacion === 'nueva'
                      ? `Cantidad leída: ${item.cantidad_entregada}`
                      : `Pendiente actual: ${item.cantidad_pendiente}`}
                  </Text>
                  <Text style={styles.etiquetaSeccion}>
                    {situacion === 'nueva' ? 'Cantidad pendiente' : 'Entregado hoy'}
                  </Text>
                  <TextInput
                    value={item.valor}
                    onChangeText={(valor) => actualizarValorItem(item.id, valor)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#6b7688"
                    editable={!bloqueado}
                    style={[styles.inputCantidad, bloqueado && styles.inputCantidadBloqueado]}
                  />
                  {bloqueado ? (
                    <Text style={styles.previewSubtexto}>En 0 — sin nada pendiente de este producto.</Text>
                  ) : null}
                </View>
              );
            })}

            {items.length === 0 ? (
              <View style={styles.tarjeta}>
                <Text style={styles.previewSubtexto}>
                  La IA no encontró productos en la foto — repetí la captura con mejor luz/encuadre.
                </Text>
              </View>
            ) : null}

            {mensaje ? <Text style={styles.textoErrorInline}>{mensaje}</Text> : null}

            <View style={styles.acciones}>
              <Pressable
                disabled={!puedeConfirmar}
                style={({ pressed }) => [
                  styles.boton,
                  styles.botonPrimario,
                  !puedeConfirmar && styles.botonDeshabilitado,
                  pressed && puedeConfirmar && styles.botonPresionado,
                ]}
                onPress={confirmar}
              >
                <Text style={styles.botonTexto}>{cargando ? 'Guardando...' : '✅ Confirmar cantidades'}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={reiniciar}
              >
                <Text style={styles.botonTexto}>Cancelar</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {fase === 'resultado' ? (
          <>
            {infoEstadoFinal ? (
              <View style={[styles.badgeEstado, { backgroundColor: infoEstadoFinal.fondo }]}>
                <Text style={styles.badgeEstadoIcono}>{infoEstadoFinal.icono}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.badgeEstadoTitulo, { color: infoEstadoFinal.color }]}>
                    {infoEstadoFinal.texto}
                  </Text>
                  <Text style={styles.badgeEstadoMensaje}>{mensaje}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.acciones}>
              <Pressable
                style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
                onPress={reiniciar}
              >
                <Text style={styles.botonTexto}>➕ Nueva captura</Text>
              </Pressable>
            </View>
          </>
        ) : null}
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
  itemDescripcion: { color: '#fff', fontSize: 15, fontWeight: '700' },
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
  inputCantidadBloqueado: { opacity: 0.5 },
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
