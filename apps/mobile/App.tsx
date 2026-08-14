import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';

import { procesarEntrega, subirEvidencia } from './api';

// TODO: reemplazar por el login real del operador (sede + empleado autenticado).
const SEDE_ORIGEN_ID = 'sede-demo';
const OPERADOR_ID = 'operador-demo';

type Estado = 'idle' | 'subiendo' | 'procesada' | 'pendiente_revision' | 'error';

export default function App() {
  const [foto, setFoto] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>('idle');
  const [mensaje, setMensaje] = useState('');

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
    }
  };

  const enviar = async () => {
    if (!foto) return;
    setEstado('subiendo');
    setMensaje('Subiendo evidencia...');

    try {
      const { url, hash } = await subirEvidencia(foto);
      setMensaje('Extrayendo datos con IA...');

      const resultado = await procesarEntrega({
        evidencia_url: url,
        hash_evidencia: hash,
        sede_origen_id: SEDE_ORIGEN_ID,
        operador_id: OPERADOR_ID,
        capturado_at: new Date().toISOString(),
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
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.titulo}>Captura de Despacho</Text>
      <Text style={styles.subtitulo}>Sede: {SEDE_ORIGEN_ID}</Text>

      {foto ? (
        <Image source={{ uri: foto }} style={styles.preview} />
      ) : (
        <View style={[styles.preview, styles.previewVacio]}>
          <Text style={styles.previewTexto}>Sin foto capturada</Text>
        </View>
      )}

      {estado === 'subiendo' ? (
        <View style={styles.estadoBox}>
          <ActivityIndicator />
          <Text style={styles.mensaje}>{mensaje}</Text>
        </View>
      ) : mensaje ? (
        <Text
          style={[
            styles.mensaje,
            estado === 'error' && styles.mensajeError,
            estado === 'procesada' && styles.mensajeOk,
          ]}
        >
          {mensaje}
        </Text>
      ) : null}

      <View style={styles.acciones}>
        <Pressable style={styles.boton} onPress={tomarFoto}>
          <Text style={styles.botonTexto}>{foto ? 'Repetir foto' : 'Tomar foto'}</Text>
        </Pressable>

        {foto && estado !== 'subiendo' && (
          <Pressable style={[styles.boton, styles.botonPrimario]} onPress={enviar}>
            <Text style={styles.botonTexto}>Enviar y procesar</Text>
          </Pressable>
        )}

        {(estado === 'procesada' || estado === 'pendiente_revision') && (
          <Pressable style={styles.boton} onPress={reiniciar}>
            <Text style={styles.botonTexto}>Nueva captura</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101826', padding: 20, alignItems: 'center' },
  titulo: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 12 },
  subtitulo: { color: '#8a94a6', fontSize: 13, marginBottom: 20 },
  preview: { width: '100%', height: 320, borderRadius: 10, backgroundColor: '#1c2534' },
  previewVacio: { alignItems: 'center', justifyContent: 'center' },
  previewTexto: { color: '#5c6779' },
  estadoBox: { alignItems: 'center', marginTop: 16, gap: 8 },
  mensaje: { color: '#d3d9e6', marginTop: 16, textAlign: 'center' },
  mensajeOk: { color: '#3ecf8e' },
  mensajeError: { color: '#ef5350' },
  acciones: { marginTop: 24, width: '100%', gap: 12 },
  boton: {
    backgroundColor: '#1c2534',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  botonPrimario: { backgroundColor: '#c8631f' },
  botonTexto: { color: '#fff', fontWeight: '600' },
});
