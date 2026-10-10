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

import { extraerTalonario, subirEvidencia, type Punto } from './api';
import { quitarCodigo } from './PantallaEntrada';
import EvitarTeclado from './EvitarTeclado';
import { mensajeError } from './errorMessages';
import CampoFirma from './CampoFirma';
import { comprimirParaEnvio } from './EntregaContext';
import HojaModal from './HojaModal';
import ModalProducto, { productoValido } from './ModalProducto';
import { formatearFechaCorta, formatearFechaLarga } from './SelectorFecha';
import { AvisoRol } from './ResumenTraslado';
import { HeaderTraslado, nuevoItemDraft, useTraslado, type ItemTrasladoDraft } from './TrasladoContext';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';
import type { TrasladosStackParamList } from './Navegacion';

type IconoNombre = keyof typeof Ionicons.glyphMap;

type NavegacionNuevo =NativeStackNavigationProp<TrasladosStackParamList, 'NuevoTraslado'>;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(valor: string): boolean {
  if (!FECHA_REGEX.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00`);
  return !Number.isNaN(fecha.getTime());
}

// Punto del recorrido (origen o destino) en la tarjeta de datos leidos: nombre
// sin el codigo y el codigo aparte, en un chip.
function PuntoRuta({ etiqueta, punto, icono }: { etiqueta: string; punto: Punto | null; icono: IconoNombre }) {
  return (
    <View style={estilos.puntoRuta}>
      <View style={estilos.puntoRutaIcono}>
        <Ionicons name={icono} size={18} color={ACENTO} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.etiquetaSeccion}>{etiqueta}</Text>
        <Text style={estilos.valorLectura} numberOfLines={1}>
          {punto ? quitarCodigo(punto) : '—'}
        </Text>
      </View>
      {punto?.codigo ? (
        <View style={estilos.chipCodigo}>
          <Text style={estilos.chipCodigoTexto}>{punto.codigo}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Dato chico del encabezado (transportador, fecha) con su icono.
function DatoLectura({ etiqueta, valor, icono }: { etiqueta: string; valor: string; icono: IconoNombre }) {
  return (
    <View style={estilos.datoLectura}>
      <View style={estilos.datoLecturaEtiqueta}>
        <Ionicons name={icono} size={14} color={NEUTRAL_500} />
        <Text style={styles.etiquetaSeccion}>{etiqueta}</Text>
      </View>
      <Text style={estilos.valorLectura} numberOfLines={2}>
        {valor || '—'}
      </Text>
    </View>
  );
}

// Chip de detalle de un producto (marca, presentacion, vencimiento).
function ChipDetalle({ icono, texto, destacado }: { icono: IconoNombre; texto: string; destacado?: boolean }) {
  return (
    <View style={[estilos.chipDetalle, destacado && estilos.chipDetalleDestacado]}>
      <Ionicons name={icono} size={12} color={destacado ? ACENTO : NEUTRAL_400} />
      <Text style={[estilos.chipDetalleTexto, destacado && { color: ACENTO }]} numberOfLines={1}>
        {texto}
      </Text>
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
              {/* Datos leidos de la foto, solo lectura: n.º de talonario
                  destacado (como el recuadro impreso), recorrido origen ->
                  destino y abajo transportador y fecha. */}
              <View style={styles.tarjeta}>
                <View style={estilos.encabezadoLectura}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={styles.etiquetaSeccion}>N.º de talonario</Text>
                    <View style={estilos.cajaTalonario}>
                      <Text style={estilos.numeroTalonario} numberOfLines={1}>
                        {draft.numeroTalonario}
                      </Text>
                    </View>
                  </View>
                  <View style={estilos.badgeLeido} accessibilityLabel="Datos leídos de la foto, no editables">
                    <Ionicons name="lock-closed" size={11} color={NEUTRAL_400} />
                    <Text style={estilos.badgeLeidoTexto}>Leído de la foto</Text>
                  </View>
                </View>

                <View style={estilos.separador} />

                <View>
                  <PuntoRuta etiqueta="Origen" punto={punto ?? null} icono="storefront-outline" />
                  <View style={estilos.conectorRuta}>
                    <View style={estilos.lineaRuta} />
                    <Ionicons name="arrow-down" size={14} color={NEUTRAL_500} />
                    <View style={estilos.lineaRuta} />
                  </View>
                  <PuntoRuta etiqueta="Destino" punto={draft.destino} icono="flag-outline" />
                </View>

                <View style={estilos.separador} />

                <View style={estilos.filaDatos}>
                  <DatoLectura etiqueta="Transportador" valor={draft.transportadorNombre} icono="person-outline" />
                  <DatoLectura
                    etiqueta="Fecha"
                    valor={fechaValida(draft.fecha) ? formatearFechaLarga(draft.fecha) : ''}
                    icono="calendar-outline"
                  />
                </View>
              </View>

              <View style={estilos.encabezadoProductos}>
                <View style={estilos.tituloProductos}>
                  <Text style={styles.etiquetaSeccion}>Productos</Text>
                  <View style={estilos.contador}>
                    <Text style={estilos.contadorTexto}>{draft.items.length}</Text>
                  </View>
                </View>
                {draft.items.length > 0 ? (
                  <View style={estilos.pista}>
                    <Ionicons name="create-outline" size={13} color={NEUTRAL_500} />
                    <Text style={styles.previewSubtexto}>Toca uno para corregirlo</Text>
                  </View>
                ) : null}
              </View>
              {draft.items.length === 0 ? (
                <Text style={styles.previewSubtexto}>No quedan productos. Repite la foto para leerlos de nuevo.</Text>
              ) : null}
              {draft.items.map((item) => (
                // Tocar la tarjeta la edita en el modal; la papelera la quita.
                <Pressable
                  key={item.localId}
                  onPress={() => setProductoEditado(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Corregir ${item.producto}`}
                  style={({ pressed }) => [styles.tarjeta, estilos.tarjetaProducto, pressed && { opacity: 0.8 }]}
                >
                  <View style={estilos.cantidadCaja}>
                    <Text style={estilos.cantidadTexto}>{item.cantidad}</Text>
                    <Text style={estilos.cantidadEtiqueta}>und</Text>
                  </View>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={styles.itemDescripcion} numberOfLines={2}>
                      {item.producto}
                    </Text>
                    {item.marca || item.presentacion || item.fechaVencimiento ? (
                      <View style={estilos.chips}>
                        {item.marca ? <ChipDetalle icono="pricetag-outline" texto={item.marca} /> : null}
                        {item.presentacion ? <ChipDetalle icono="cube-outline" texto={item.presentacion} /> : null}
                        {item.fechaVencimiento ? (
                          <ChipDetalle
                            icono="calendar-outline"
                            texto={`Vence ${formatearFechaCorta(item.fechaVencimiento)}`}
                            destacado
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => quitarItem(item.localId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar ${item.producto}`}
                    style={({ pressed }) => [estilos.botonQuitar, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="trash-outline" size={18} color={NEUTRAL_400} />
                  </Pressable>
                </Pressable>
              ))}

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
  valorLectura: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  encabezadoLectura: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cajaTalonario: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: ACENTO,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(245,197,66,0.08)',
  },
  numeroTalonario: { color: ACENTO, fontSize: 22, fontFamily: FUENTE_DISPLAY, letterSpacing: 1 },
  badgeLeido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  badgeLeidoTexto: { color: NEUTRAL_400, fontSize: 11, fontFamily: FUENTE_BODY_SEMI },
  separador: { height: 1, backgroundColor: NEUTRAL_700, opacity: 0.6 },
  puntoRuta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  puntoRutaIcono: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(245,197,66,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCodigo: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  chipCodigoTexto: { color: NEUTRAL_400, fontSize: 11, fontFamily: FUENTE_DISPLAY, letterSpacing: 0.5 },
  // Linea vertical entre origen y destino, centrada bajo el icono (40 px).
  conectorRuta: { width: 40, alignItems: 'center', paddingVertical: 2, gap: 2 },
  lineaRuta: { width: 1.5, height: 6, backgroundColor: NEUTRAL_700 },
  filaDatos: { flexDirection: 'row', gap: 12 },
  datoLectura: {
    flex: 1,
    gap: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: NEUTRAL_800,
  },
  datoLecturaEtiqueta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  encabezadoProductos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  tituloProductos: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contador: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: 'rgba(245,197,66,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contadorTexto: { color: ACENTO, fontSize: 12, fontFamily: FUENTE_DISPLAY },
  pista: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipDetalle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: NEUTRAL_800,
  },
  chipDetalleDestacado: { backgroundColor: 'rgba(245,197,66,0.10)' },
  chipDetalleTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY_SEMI, flexShrink: 1 },
  botonQuitar: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cantidadEtiqueta: { color: NEUTRAL_500, fontSize: 10, fontFamily: FUENTE_BODY_SEMI, marginTop: -2 },
  miniatura: { width: '100%', height: 180, borderRadius: 12 },
  leyendo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filaBotones: { flexDirection: 'row', gap: 10 },
  tarjetaProducto: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cantidadCaja: {
    minWidth: 52,
    height: 52,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(245,197,66,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cantidadTexto: { color: ACENTO, fontSize: 18, fontFamily: FUENTE_DISPLAY },
});
