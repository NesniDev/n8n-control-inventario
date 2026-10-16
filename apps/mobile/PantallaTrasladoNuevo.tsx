// Paso 1 de crear un traslado (bodega origen): se fotografia el talonario de
// papel y la IA lee el encabezado (n.º de talonario, destino, transportador,
// fecha) y los productos. El encabezado es de solo lectura -- si algo no se
// lee bien se repite la foto, no se edita a mano --; los productos se pueden
// editar y quitar, pero no agregar. Despues van observaciones y la firma de
// quien despacha. El origen es fijo -- el punto del usuario logueado. El envio
// real (crear el traslado en el backend) pasa en FirmaTransportador, no aca
// -- esta pantalla solo arma el borrador (ver TrasladoContext.tsx).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { extraerTalonario, fetchTalonariosPunto, subirEvidencia, type Punto, type TalonarioPunto } from './api';
import { quitarCodigo } from './PantallaEntrada';
import EvitarTeclado from './EvitarTeclado';
import { mensajeError } from './errorMessages';
import CampoFirma from './CampoFirma';
import { comprimirParaEnvio } from './EntregaContext';
import HojaModal from './HojaModal';
import VisorFotoZoom from './VisorFotoZoom';
import { datosEmpresa, EMPRESAS_TALONARIO, InsigniaEmpresa } from './ModalTalonario';
import ModalProducto, { productoValido } from './ModalProducto';
import { formatearFechaCorta, formatearFechaLarga } from './SelectorFecha';
import { AvisoRol } from './ResumenTraslado';
import { HeaderTraslado, nuevoItemDraft, useTraslado, type ItemTrasladoDraft } from './TrasladoContext';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY,
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
  // Visor a pantalla completa de la foto (zoom y giro) abierto.
  const [fotoAbierta, setFotoAbierta] = useState(false);
  // Giro de la foto en grados (solo de la vista: la imagen leida no cambia) y
  // ancho de la miniatura, para que girada de lado siga entrando completa.
  const [giroFoto, setGiroFoto] = useState(0);
  // Foto tomada o elegida que todavia no se envio a leer: se revisa (girar,
  // ampliar) y se manda con "Enviar foto". null = no hay foto en espera.
  const [fotoPendiente, setFotoPendiente] = useState<string | null>(null);
  const [anchoMiniatura, setAnchoMiniatura] = useState(0);
  // Error de la lectura (red, IA) y lista de campos que no se pudieron leer:
  // en cualquiera de los dos casos solo se puede repetir la foto.
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [faltantes, setFaltantes] = useState<string[]>([]);
  // Talonarios activos del punto (uno por letra): de ahi salen las hojas que
  // pueden fotografiarse. undefined = todavia no se sabe (no bloquea; el
  // backend valida igual).
  const [talonarios, setTalonarios] = useState<TalonarioPunto[] | undefined>(undefined);
  // Empresa (letra del talonario) elegida antes de la foto; si se vuelve a
  // esta pantalla con una lectura hecha, sale de la hoja ya leida.
  const [letra, setLetra] = useState(() => /^\s*([A-Za-z]{1,3})/.exec(draft.numeroTalonario)?.[1].toUpperCase() ?? '');

  useEffect(() => {
    if (!punto) return;
    fetchTalonariosPunto(punto.id, { forzar: true })
      .then(setTalonarios)
      .catch(() => undefined);
  }, [punto]);

  const sinConfigurar = talonarios !== undefined && talonarios.length === 0;
  const sinTalonario = sinConfigurar || (talonarios !== undefined && talonarios.every((t) => t.agotado));
  // Talonario de la empresa elegida (solo si tiene hojas).
  const elegido = (talonarios ?? []).find((t) => t.letra === letra && !t.agotado) ?? null;

  // Con un solo talonario con hojas no hay nada que elegir: se marca solo.
  useEffect(() => {
    if (letra || !talonarios) return;
    const conHojas = talonarios.filter((t) => !t.agotado);
    if (conHojas.length === 1) setLetra(conHojas[0].letra);
  }, [talonarios, letra]);

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
      setGiroFoto(0);
      const { url } = await subirEvidencia(uri);
      const lectura = await extraerTalonario(url, punto.id, letra);
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
          producto: item.producto.toUpperCase(),
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

  // Cambiar de empresa descarta la foto y lo leido: era de otro talonario.
  const elegirEmpresa = (nueva: string) => {
    if (nueva === letra || leyendo) return;
    setLetra(nueva);
    setFotoUri(null);
    setFotoPendiente(null);
    setErrorLectura(null);
    setFaltantes([]);
    limpiarLectura();
  };

  // La foto nueva queda en espera para revisarla; lo leido antes se descarta.
  const usarResultado = async (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      const uri = resultado.assets[0].uri;
      setFotoPendiente(uri);
      setFotoUri(uri);
      setGiroFoto(0);
      setErrorLectura(null);
      setFaltantes([]);
      limpiarLectura();
    }
  };

  // Envia la foto en espera a leer, ya girada como se ve en pantalla (el giro
  // se aplica al archivo para que la IA la reciba derecha).
  const enviarFoto = async () => {
    if (!fotoPendiente) return;
    let uri = fotoPendiente;
    if (giroFoto !== 0) {
      const girada = await manipulateAsync(uri, [{ rotate: giroFoto }], { compress: 1, format: SaveFormat.JPEG });
      uri = girada.uri;
    }
    setFotoPendiente(null);
    await procesarFoto(uri);
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
  // Mientras se cargan los talonarios no se bloquea (el backend valida igual).
  const puedeFotografiar = talonarios === undefined || elegido !== null;
  const hayProblema = errorLectura !== null || faltantes.length > 0;
  const empresaElegida = datosEmpresa(letra);

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
            {/* 1. Empresa: define que talonario se usa; sin elegirla no hay foto.
                Solo se pueden elegir las que tienen talonario con hojas. */}
            {!sinTalonario ? (
              <>
                <Text style={styles.etiquetaSeccion}>Empresa del talonario</Text>
                <View style={estilos.empresas} accessibilityRole="radiogroup">
                  {EMPRESAS_TALONARIO.map((e) => {
                    const t = (talonarios ?? []).find((x) => x.letra === e.letra);
                    const disponible = !!t && !t.agotado;
                    const activa = letra === e.letra;
                    return (
                      <Pressable
                        key={e.letra}
                        onPress={() => elegirEmpresa(e.letra)}
                        disabled={!disponible || leyendo}
                        style={({ pressed }) => [
                          estilos.empresa,
                          activa && { borderColor: e.claro, backgroundColor: `${e.color}26` },
                          !disponible && { opacity: 0.4 },
                          pressed && { opacity: 0.8 },
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: activa, disabled: !disponible }}
                        accessibilityLabel={`${e.nombre}${disponible ? `, hoja ${t!.siguiente_hoja}` : ', sin talonario disponible'}`}
                      >
                        <InsigniaEmpresa letra={e.letra} tamano={30} />
                        <View style={{ flex: 1 }}>
                          <Text style={estilos.empresaNombre} numberOfLines={1}>
                            {e.corto}
                          </Text>
                          <Text style={[estilos.empresaHoja, activa && { color: e.claro }]} numberOfLines={1}>
                            {disponible ? `Hoja ${t!.siguiente_hoja}` : t ? 'Agotado' : 'Sin talonario'}
                          </Text>
                        </View>
                        {activa ? <Ionicons name="checkmark-circle" size={18} color={e.claro} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* 2. Foto de la hoja del talonario elegido. */}
            <Text style={styles.etiquetaSeccion}>Foto de la hoja</Text>
            {elegido && !sinTalonario ? (
              <View style={estilos.hojaEsperada}>
                <Ionicons name="document-text-outline" size={16} color={empresaElegida?.claro ?? ACENTO} />
                <Text style={estilos.hojaEsperadaTexto}>
                  Fotografía la hoja{' '}
                  <Text style={{ color: empresaElegida?.claro ?? ACENTO }}>{elegido.siguiente_hoja}</Text>
                </Text>
              </View>
            ) : !sinTalonario && talonarios !== undefined ? (
              <Text style={styles.previewSubtexto}>Primero elige la empresa del talonario.</Text>
            ) : null}
            {sinTalonario ? (
              <Text style={styles.textoErrorInline}>
                {sinConfigurar
                  ? 'Tu punto no tiene un talonario activo. Vuelve al inicio y configura tu talonario.'
                  : 'Talonario agotado. Pide un talonario y configúralo desde el inicio.'}
              </Text>
            ) : null}
            {hayFoto ? (
              <View style={estilos.miniatura} onLayout={(e) => setAnchoMiniatura(e.nativeEvent.layout.width)}>
                <Pressable
                  onPress={() => setFotoAbierta(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Ver la foto en grande"
                  style={({ pressed }) => [estilos.miniaturaToque, pressed && { opacity: 0.85 }]}
                >
                  <Image
                    source={{ uri: fotoUri ?? draft.fotoTalonarioUrl }}
                    resizeMode="contain"
                    style={[
                      // De lado se cambian ancho y alto para que, girada, entre completa.
                      giroFoto % 180 !== 0
                        ? { width: ALTO_MINIATURA, height: anchoMiniatura }
                        : { width: anchoMiniatura, height: ALTO_MINIATURA },
                      { transform: [{ rotate: `${giroFoto}deg` }] },
                    ]}
                  />
                </Pressable>
                {/* Acciones sobre la foto: girar y ampliar, una al lado de la otra. */}
                <View style={estilos.accionesFoto}>
                  <Pressable
                    onPress={() => setGiroFoto((g) => (g + 90) % 360)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Girar la foto"
                    style={({ pressed }) => [estilos.accionFoto, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="refresh-outline" size={15} color={TEXTO_PRIMARIO} />
                    <Text style={estilos.accionFotoTexto}>Girar</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setFotoAbierta(true)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Ampliar la foto"
                    style={({ pressed }) => [estilos.accionFoto, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="expand-outline" size={15} color={TEXTO_PRIMARIO} />
                    <Text style={estilos.accionFotoTexto}>Ampliar</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {leyendo ? (
              <View style={estilos.leyendo}>
                <ActivityIndicator color={ACENTO} />
                <Text style={styles.previewSubtexto}>Leyendo el talonario...</Text>
              </View>
            ) : sinTalonario ? null : (
              <>
              {fotoPendiente ? (
                <View style={{ gap: 6 }}>
                  <Text style={styles.previewSubtexto}>
                    Revisa que la hoja se vea completa y derecha (puedes girarla). Luego envíala para leerla.
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
                    onPress={enviarFoto}
                    accessibilityRole="button"
                  >
                    <ContenidoBoton icono="send-outline" texto="Enviar foto" color={TEXTO_SOBRE_ACENTO} />
                  </Pressable>
                </View>
              ) : null}
              <View style={estilos.filaBotones}>
                <Pressable
                  style={({ pressed }) => [
                    styles.boton,
                    { flex: 1 },
                    !puedeFotografiar && styles.botonDeshabilitado,
                    pressed && styles.botonPresionado,
                  ]}
                  onPress={tomarFoto}
                  disabled={!puedeFotografiar}
                >
                  <ContenidoBoton
                    icono="camera-outline"
                    texto={hayFoto ? 'Repetir foto' : 'Tomar foto'}
                    color={TEXTO_PRIMARIO}
                  />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.boton,
                    { flex: 1 },
                    !puedeFotografiar && styles.botonDeshabilitado,
                    pressed && styles.botonPresionado,
                  ]}
                  onPress={elegirDeGaleria}
                  disabled={!puedeFotografiar}
                >
                  <ContenidoBoton icono="images-outline" texto="Galería" color={NEUTRAL_400} />
                </Pressable>
              </View>
              </>
            )}
            {/* Un solo aviso, corto: el detalle de que fallo no le sirve al operador. */}
            {hayProblema && !leyendo ? (
              <View style={estilos.avisoLectura}>
                <Ionicons name="alert-circle-outline" size={18} color="#f87171" />
                <Text style={estilos.avisoLecturaTexto}>
                  {errorLectura ?? 'No se pudo leer el talonario. Toma la foto otra vez.'}
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
      {fotoAbierta && (fotoUri ?? draft.fotoTalonarioUrl) ? (
        <VisorFotoZoom
          uri={(fotoUri ?? draft.fotoTalonarioUrl)!}
          giro={giroFoto}
          onCerrar={() => setFotoAbierta(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// Alto de la miniatura de la foto del talonario.
const ALTO_MINIATURA = 180;

const estilos = StyleSheet.create({
  hojaEsperada: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empresas: { flexDirection: 'row', gap: 8 },
  empresa: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  empresaNombre: { color: TEXTO_PRIMARIO, fontSize: 13.5, fontFamily: FUENTE_BODY_SEMI },
  empresaHoja: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY },
  hojaEsperadaTexto: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
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
  miniatura: { width: '100%', height: ALTO_MINIATURA, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000000' },
  miniaturaToque: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avisoLectura: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(248,113,113,0.10)',
  },
  avisoLecturaTexto: { flex: 1, color: '#fca5a5', fontSize: 13.5, fontFamily: FUENTE_BODY_SEMI },
  accionesFoto: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 6 },
  accionFoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(8,22,51,0.82)',
  },
  accionFotoTexto: { color: TEXTO_PRIMARIO, fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI },
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
