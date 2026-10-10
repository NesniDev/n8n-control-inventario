// Paso 1 de crear un traslado (bodega origen): se fotografia el talonario de
// papel y la IA lee el encabezado (n.º de talonario, destino, transportador,
// fecha) y los productos. El encabezado es de solo lectura -- si algo no se
// lee bien se repite la foto, no se edita a mano --; los productos se pueden
// editar y quitar, pero no agregar. Despues van observaciones y la firma de
// quien despacha. El origen es fijo -- el punto del usuario logueado. El envio
// real (crear el traslado en el backend) pasa en FirmaTransportador, no aca
// -- esta pantalla solo arma el borrador (ver TrasladoContext.tsx).
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';

import { extraerTalonario, subirEvidencia } from './api';
import EvitarTeclado from './EvitarTeclado';
import { mensajeError } from './errorMessages';
import CampoFirma from './CampoFirma';
import { comprimirParaEnvio } from './EntregaContext';
import HojaModal from './HojaModal';
import ModalProducto, { productoValido } from './ModalProducto';
import { formatearFechaLarga, textoVencimiento } from './SelectorFecha';
import { AvisoRol } from './ResumenTraslado';
import { HeaderTraslado, nuevoItemDraft, useTraslado, type ItemTrasladoDraft } from './TrasladoContext';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  NEUTRAL_500,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';
import type { TrasladosStackParamList } from './Navegacion';

type NavegacionNuevo = NativeStackNavigationProp<TrasladosStackParamList, 'NuevoTraslado'>;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(valor: string): boolean {
  if (!FECHA_REGEX.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00`);
  return !Number.isNaN(fecha.getTime());
}

// Dato del encabezado leido de la foto, solo lectura.
function CampoLectura({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={estilos.campoLectura}>
      <Text style={styles.etiquetaSeccion}>{etiqueta}</Text>
      <Text style={estilos.valorLectura}>{valor || '—'}</Text>
    </View>
  );
}

export default function PantallaTrasladoNuevo() {
  const navigation = useNavigation<NavegacionNuevo>();
  const { punto, draft, actualizarDraft, cargando, setCargando } = useTraslado();

  const [observacionesAbiertas, setObservacionesAbiertas] = useState(false);
  // undefined = modal cerrado; item = editando ese (no se agregan productos a mano).
  const [productoEditado, setProductoEditado] = useState<ItemTrasladoDraft | undefined>(undefined);
  // Foto local para la miniatura mientras se sube y lee; despues se usa la URL
  // de Storage guardada en el borrador.
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  // Error de la lectura (red, IA) y lista de campos que no se pudieron leer:
  // en cualquiera de los dos casos solo se puede repetir la foto.
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [faltantes, setFaltantes] = useState<string[]>([]);

  const limpiarLectura = () => {
    actualizarDraft({
      numeroTalonario: '',
      fotoTalonarioUrl: '',
      destino: null,
      transportadorNombre: '',
      items: [],
    });
  };

  // Sube la foto, la manda a leer y, si salio completa, llena el borrador
  // (encabezado + productos). Repetir la foto reemplaza todo lo anterior.
  const procesarFoto = async (uriOriginal: string) => {
    if (!punto) return;
    setLeyendo(true);
    setCargando(true);
    setErrorLectura(null);
    setFaltantes([]);
    limpiarLectura();
    try {
      const uri = await comprimirParaEnvio(uriOriginal);
      setFotoUri(uri);
      const { url } = await subirEvidencia(uri);
      const lectura = await extraerTalonario(url, punto.id);
      if (lectura.faltantes.length > 0 || !lectura.punto_destino) {
        setFaltantes(lectura.faltantes.length > 0 ? lectura.faltantes : ['Destino']);
        return;
      }
      actualizarDraft({
        numeroTalonario: lectura.numero_talonario,
        fotoTalonarioUrl: url,
        destino: lectura.punto_destino,
        transportadorNombre: lectura.transportador,
        fecha: lectura.fecha,
        items: lectura.items.map((item) => ({
          ...nuevoItemDraft(),
          cantidad: String(item.cantidad),
          producto: item.producto,
          marca: item.marca,
          presentacion: item.presentacion,
          fechaVencimiento: item.fecha_vencimiento,
        })),
      });
    } catch (err) {
      setErrorLectura(mensajeError(err, 'traslado'));
    } finally {
      setLeyendo(false);
      setCargando(false);
    }
  };

  const usarResultado = async (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      await procesarFoto(resultado.assets[0].uri);
    }
  };

  const tomarFoto = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para fotografiar el talonario.');
      return;
    }
    await usarResultado(await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false, exif: false }));
  };

  const elegirDeGaleria = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a las fotos para elegir el talonario.');
      return;
    }
    await usarResultado(await ImagePicker.launchImageLibraryAsync({ quality: 1, allowsEditing: false, exif: false }));
  };

  // Solo edita un producto existente (el modal no agrega).
  const guardarItem = (guardado: ItemTrasladoDraft) => {
    actualizarDraft({
      items: draft.items.map((item) => (item.localId === guardado.localId ? guardado : item)),
    });
  };

  const quitarItem = (localId: string) => {
    actualizarDraft({ items: draft.items.filter((item) => item.localId !== localId) });
  };

  const hayObservaciones = draft.observaciones.trim() !== '';

  const lecturaCompleta = draft.fotoTalonarioUrl !== '' && !errorLectura && faltantes.length === 0;
  const itemsValidos = draft.items.length > 0 && draft.items.every(productoValido);
  const puedeContinuar =
    lecturaCompleta &&
    !leyendo &&
    draft.numeroTalonario.trim() !== '' &&
    !!draft.destino &&
    draft.transportadorNombre.trim() !== '' &&
    fechaValida(draft.fecha) &&
    itemsValidos &&
    !!draft.firmaDespachaBase64;

  const hayFoto = fotoUri !== null || draft.fotoTalonarioUrl !== '';
  const hayProblema = errorLectura !== null || faltantes.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <EvitarTeclado>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <HeaderTraslado />

          <AvisoRol
            icono="cube-outline"
            rol="Bodega origen · Despacho"
            texto="Fotografía el talonario: los datos y los productos se leen de la foto. Al final firma como quien despacha."
          />

          {/* Foto del talonario: sin foto, las dos formas de cargarla; con foto,
              miniatura + "Repetir foto" (que vuelve a leer y reemplaza todo). */}
          <View style={styles.tarjeta}>
            <Text style={styles.etiquetaSeccion}>Foto del talonario</Text>
            {hayFoto ? (
              <Image source={{ uri: fotoUri ?? draft.fotoTalonarioUrl }} style={estilos.miniatura} resizeMode="cover" />
            ) : null}
            {leyendo ? (
              <View style={estilos.leyendo}>
                <ActivityIndicator color={ACENTO} />
                <Text style={styles.previewSubtexto}>Leyendo el talonario...</Text>
              </View>
            ) : (
              <View style={estilos.filaBotones}>
                <Pressable
                  style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
                  onPress={tomarFoto}
                >
                  <ContenidoBoton
                    icono="camera-outline"
                    texto={hayFoto ? 'Repetir foto' : 'Tomar foto'}
                    color={TEXTO_PRIMARIO}
                  />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
                  onPress={elegirDeGaleria}
                >
                  <ContenidoBoton icono="images-outline" texto="Galería" color={NEUTRAL_400} />
                </Pressable>
              </View>
            )}
            {hayProblema && !leyendo ? (
              <View style={{ gap: 4 }}>
                <Text style={styles.textoErrorInline}>
                  {errorLectura ?? 'No se pudo leer el talonario con claridad.'}
                </Text>
                {faltantes.length > 0 ? (
                  <Text style={styles.textoErrorInline}>No se leyó: {faltantes.join(', ')}.</Text>
                ) : null}
                <Text style={styles.previewSubtexto}>
                  Toma la foto otra vez con buena luz y el talonario completo dentro del encuadre.
                </Text>
              </View>
            ) : null}
          </View>

          {lecturaCompleta ? (
            <>
              <View style={styles.tarjeta}>
                <CampoLectura etiqueta="Número de talonario" valor={draft.numeroTalonario} />
                <CampoLectura etiqueta="Origen" valor={punto?.nombre ?? '—'} />
                <CampoLectura etiqueta="Destino" valor={draft.destino?.nombre ?? ''} />
                <CampoLectura etiqueta="Transportador" valor={draft.transportadorNombre} />
                <CampoLectura
                  etiqueta="Fecha"
                  valor={fechaValida(draft.fecha) ? formatearFechaLarga(draft.fecha) : ''}
                />
              </View>

              <Text style={styles.etiquetaSeccion}>Productos</Text>
              {draft.items.length === 0 ? (
                <Text style={styles.previewSubtexto}>No quedan productos. Repite la foto para leerlos de nuevo.</Text>
              ) : null}
              {draft.items.map((item) => {
                const detalle = [item.marca, item.presentacion, textoVencimiento(item.fechaVencimiento)]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  // Tocar la tarjeta la edita en el modal; la papelera la quita.
                  <Pressable
                    key={item.localId}
                    onPress={() => setProductoEditado(item)}
                    style={({ pressed }) => [styles.tarjeta, estilos.tarjetaProducto, pressed && { opacity: 0.8 }]}
                  >
                    <View style={estilos.cantidadCaja}>
                      <Text style={estilos.cantidadTexto}>{item.cantidad}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemDescripcion} numberOfLines={2}>
                        {item.producto}
                      </Text>
                      {detalle ? <Text style={styles.previewSubtexto}>{detalle}</Text> : null}
                    </View>
                    <Pressable onPress={() => quitarItem(item.localId)} hitSlop={10}>
                      <Ionicons name="trash-outline" size={20} color={NEUTRAL_400} />
                    </Pressable>
                  </Pressable>
                );
              })}

              {/* Observaciones y firma de quien despacha van juntas: es lo ultimo
                  que se completa antes de pasarle el celular al conductor. */}
              <View style={styles.tarjeta}>
                <CampoFirma
                  titulo="Firma de quien despacha"
                  valor={draft.firmaDespachaBase64}
                  onCambio={(firma) => actualizarDraft({ firmaDespachaBase64: firma })}
                  accesorio={
                    <Pressable
                      style={({ pressed }) => [
                        styles.boton,
                        { flex: 1 },
                        hayObservaciones && { borderColor: ACENTO },
                        pressed && styles.botonPresionado,
                      ]}
                      onPress={() => setObservacionesAbiertas(true)}
                    >
                      <ContenidoBoton
                        icono={hayObservaciones ? 'chatbox-ellipses' : 'chatbox-ellipses-outline'}
                        texto="Observaciones"
                        color={hayObservaciones ? TEXTO_PRIMARIO : NEUTRAL_400}
                      />
                    </Pressable>
                  }
                />
                {hayObservaciones ? (
                  <Pressable onPress={() => setObservacionesAbiertas(true)} style={styles.notaPreviewFila}>
                    <Ionicons name="chatbox-ellipses-outline" size={14} color={NEUTRAL_500} />
                    <Text style={styles.notaPreview} numberOfLines={2}>
                      {draft.observaciones.trim()}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}

          <View style={styles.acciones}>
            <Pressable
              disabled={!puedeContinuar || cargando}
              style={({ pressed }) => [
                styles.boton,
                styles.botonPrimario,
                !puedeContinuar && styles.botonDeshabilitado,
                pressed && puedeContinuar && styles.botonPresionado,
              ]}
              onPress={() => navigation.navigate('FirmaTransportador')}
            >
              <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="arrow-forward-outline" texto="Continuar" />
            </Pressable>
          </View>
        </ScrollView>
      </EvitarTeclado>

      <HojaModal
        visible={observacionesAbiertas}
        titulo="Observaciones"
        onCerrar={() => setObservacionesAbiertas(false)}
      >
        <TextInput
          value={draft.observaciones}
          onChangeText={(v) => actualizarDraft({ observaciones: v })}
          placeholder="Información adicional del traslado (opcional)"
          placeholderTextColor={NEUTRAL_500}
          style={[styles.inputNota, { minHeight: 120, textAlignVertical: 'top' }]}
          multiline
          autoFocus
        />
        <Pressable
          style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
          onPress={() => setObservacionesAbiertas(false)}
        >
          <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="checkmark-outline" texto="Listo" />
        </Pressable>
      </HojaModal>
      <ModalProducto
        visible={productoEditado !== undefined}
        inicial={productoEditado ?? null}
        onGuardar={guardarItem}
        onCerrar={() => setProductoEditado(undefined)}
      />
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  campoLectura: { gap: 2 },
  valorLectura: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  miniatura: { width: '100%', height: 180, borderRadius: 12 },
  leyendo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filaBotones: { flexDirection: 'row', gap: 10 },
  tarjetaProducto: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cantidadCaja: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(245,197,66,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cantidadTexto: { color: ACENTO, fontSize: 18, fontFamily: FUENTE_DISPLAY },
});
