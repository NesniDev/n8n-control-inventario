// Paso 1: tomar/elegir la foto de la guia y mandarla al backend para que la
// IA identifique el documento. Primera pantalla de la sesion logueada --
// punto de entrada tanto para un documento nuevo como para re-escanear uno
// existente.
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// manipulateAsync es la API "legacy" de este paquete (SDK 57 la reemplazo por
// una API contextual/orientada a objetos, ver ImageManipulator.manipulate) --
// se usa igual aca por ser mas simple para un solo rotate() puntual, sin
// necesidad de mantener un contexto de manipulacion vivo.
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { confirmarItems, procesarEntrega, subirEvidencia, type ResultadoEnvio } from './api';
import {
  esErrorFacturacionPendiente,
  esErrorFacturaYaRegistrada,
  MENSAJE_FACTURACION_PENDIENTE,
  MENSAJE_FACTURA_YA_REGISTRADA,
  mensajeError,
} from './errorMessages';
import { comprimirParaEnvio, formatearIdentificador, HeaderEntrega, useEntrega } from './EntregaContext';
import {
  ACENTO,
  ContenidoBoton,
  ESTADO_INFO,
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  NEUTRAL_400,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  styles,
  TEXTO_PRIMARIO,
} from './tema';
import type { DespachosStackParamList } from './Navegacion';

type Props = NativeStackScreenProps<DespachosStackParamList, 'Captura'>;

// Recuadro de foto reutilizado por la evidencia y la foto de traslado.
// Sin foto: todo el recuadro es el boton para abrir la camara, con consejos
// adentro. Con foto: los controles (rotar, ampliar, repetir) van encima de la
// imagen como botones redondos, y mientras se procesa el aviso aparece sobre
// la misma foto -- asi la accion principal de la pantalla queda sola abajo.
function VistaFoto({
  uri,
  deshabilitado,
  procesando,
  mensajeProcesando,
  onTomar,
  onRotar,
  onAmpliar,
  vacioTitulo,
  vacioIcono,
  consejos,
}: {
  uri: string | null;
  deshabilitado: boolean;
  procesando: boolean;
  mensajeProcesando: string;
  onTomar: () => void;
  onRotar: () => void;
  onAmpliar: () => void;
  vacioTitulo: string;
  vacioIcono: keyof typeof Ionicons.glyphMap;
  consejos?: { icono: keyof typeof Ionicons.glyphMap; texto: string }[];
}) {
  if (!uri) {
    return (
      <Pressable
        onPress={onTomar}
        disabled={deshabilitado}
        style={({ pressed }) => [estilosFoto.vacio, pressed && estilosFoto.vacioPresionado]}
      >
        <View style={estilosFoto.circuloCamara}>
          <Ionicons name={vacioIcono} size={34} color={ACENTO} />
        </View>
        <Text style={estilosFoto.vacioTitulo}>{vacioTitulo}</Text>
        {consejos ? (
          <View style={estilosFoto.consejos}>
            {consejos.map((c) => (
              <View key={c.texto} style={estilosFoto.consejo}>
                <Ionicons name={c.icono} size={14} color={NEUTRAL_400} />
                <Text style={estilosFoto.consejoTexto}>{c.texto}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View>
      <Pressable onPress={onAmpliar} disabled={procesando}>
        <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
      </Pressable>

      {procesando ? (
        <View style={estilosFoto.velo}>
          <ActivityIndicator color={TEXTO_PRIMARIO} size="large" />
          <Text style={estilosFoto.veloTexto}>{mensajeProcesando}</Text>
        </View>
      ) : (
        <View style={estilosFoto.controles}>
          <BotonSobreFoto icono="reload-outline" etiqueta="Rotar" onPress={onRotar} deshabilitado={deshabilitado} />
          <BotonSobreFoto icono="expand-outline" etiqueta="Ampliar" onPress={onAmpliar} deshabilitado={deshabilitado} />
          <BotonSobreFoto icono="camera-reverse-outline" etiqueta="Repetir" onPress={onTomar} deshabilitado={deshabilitado} />
        </View>
      )}
    </View>
  );
}

function BotonSobreFoto({
  icono,
  etiqueta,
  onPress,
  deshabilitado,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  etiqueta: string;
  onPress: () => void;
  deshabilitado: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado}
      hitSlop={6}
      style={({ pressed }) => [estilosFoto.botonSobreFoto, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icono} size={18} color={TEXTO_PRIMARIO} />
      <Text style={estilosFoto.botonSobreFotoTexto}>{etiqueta}</Text>
    </Pressable>
  );
}

const CONSEJOS_FOTO: { icono: keyof typeof Ionicons.glyphMap; texto: string }[] = [
  { icono: 'sunny-outline', texto: 'Buena luz, sin sombras' },
  { icono: 'scan-outline', texto: 'Documento completo' },
  { icono: 'eye-outline', texto: 'Número de factura legible' },
];

export default function PantallaCapturaFoto({ navigation }: Props) {
  const {
    empleado,
    sede,
    cargando,
    setCargando,
    documentoIdentificado,
    setDocumentoIdentificado,
    setEntregaId,
    setSituacion,
    setEstadoFinal,
    setItems,
    evidenciaActual,
    setEvidenciaActual,
    setFotoAmpliada,
    setEsFaia,
    setNotaGeneral,
    setFirmaUrlConsultada,
    setNotaGeneralOriginal,
    setNecesitaTrasladoConfirmar,
  } = useEntrega();
  // La sede de trabajo ya se eligio en el login -- puede no ser la sede del
  // perfil del empleado (ej. cubriendo turno en otra).
  const sedeSeleccionada = sede;

  const [foto, setFoto] = useState<string | null>(null);
  // Solo se llena cuando procesarEntrega devolvio situacion
  // 'necesita_traslado' -- el tipo leido (ej. FEI) pertenece a otra sede
  // distinta de sedeSeleccionada. fotoTraslado es la foto que el bodeguero
  // adjunta para poder seguir igual (ver enviar()).
  // rechazado: true cuando YA se habia adjuntado una foto de traslado y el
  // backend igual devolvio necesita_traslado -- significa que el concepto de
  // esa foto no menciona el numero de esta factura (ver
  // _concepto_referencia_factura en el backend), no que falte adjuntar una.
  const [necesitaTraslado, setNecesitaTraslado] = useState<{
    tipo: string;
    indicativo_numero: string;
    rechazado: boolean;
    // Lectura original de la factura (items + confianza), guardada para
    // reenviarla como _conocido(s) en el reintento -- asi el backend no
    // vuelve a leerla con IA (ver enviar()).
    items: { descripcion: string; cantidad: number }[];
    confianza: Record<string, number>;
  } | null>(null);
  const [fotoTraslado, setFotoTraslado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  // Solo se usa para punto_venta -- ver enviar(). Ese rol no pasa por
  // Confirmando (no carga cantidades, no consulta facturas): factura,
  // ve este modal con lo que quedo registrado, y listo para la proxima foto.
  const [resultadoPuntoVenta, setResultadoPuntoVenta] = useState<ResultadoEnvio | null>(null);
  // Switch "Es FAIA" DENTRO del modal -- punto_venta es quien lo marca (el
  // bodeguero lo ve de solo lectura en PantallaConfirmando, ver ese
  // archivo). Como el modal solo aparece para una entrega recien creada
  // (FacturaYaRegistrada bloquea que punto_venta vuelva a ver una que ya
  // existe), siempre arranca en false -- no hace falta precargar nada.
  const [modalEsFaia, setModalEsFaia] = useState(false);
  const [guardandoFaia, setGuardandoFaia] = useState(false);

  const usarResultado = async (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      setFoto(await comprimirParaEnvio(resultado.assets[0].uri));
      // Foto nueva -- si venia de un intento anterior con necesita_traslado,
      // ese aviso ya no aplica (es de OTRO documento).
      setNecesitaTraslado(null);
      setFotoTraslado(null);
      setDocumentoIdentificado(null);
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

    await usarResultado(resultado);
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

    await usarResultado(resultado);
  };

  // Rota la foto ya tomada 90° en el momento -- cubre el caso de una guia
  // fotografiada de costado o al reves, sin tener que volver a la camara
  // (ver tambien el refuerzo de orientacion en el prompt de extraccion,
  // vision.py, defensa en profundidad). Genera un archivo nuevo, no pisa el
  // original.
  const rotarFoto = async () => {
    if (!foto) return;
    // WEBP, no JPEG -- foto ya viene en WebP de comprimirParaEnvio, si esto
    // devolviera JPEG se perderia esa optimizacion apenas alguien rota.
    const resultado = await manipulateAsync(foto, [{ rotate: 90 }], {
      compress: 0.9,
      format: SaveFormat.WEBP,
    });
    setFoto(resultado.uri);
  };

  // Espejo de tomarFoto/elegirDeGaleria, pero para la foto de traslado --
  // solo aparecen cuando necesitaTraslado esta seteado (ver enviar()).
  const usarResultadoTraslado = async (resultado: ImagePicker.ImagePickerResult) => {
    if (!resultado.canceled && resultado.assets[0]) {
      setFotoTraslado(await comprimirParaEnvio(resultado.assets[0].uri));
    }
  };

  const tomarFotoTraslado = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para capturar el traslado.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false, exif: false });
    await usarResultadoTraslado(resultado);
  };

  const elegirTrasladoDeGaleria = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a las fotos para elegir el traslado.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false, exif: false });
    await usarResultadoTraslado(resultado);
  };

  // Mismo tratamiento que rotarFoto, para la foto de traslado.
  const rotarFotoTraslado = async () => {
    if (!fotoTraslado) return;
    const resultado = await manipulateAsync(fotoTraslado, [{ rotate: 90 }], {
      compress: 0.9,
      format: SaveFormat.WEBP,
    });
    setFotoTraslado(resultado.uri);
  };

  // Cierra el modal de punto_venta. Si marco el switch, guarda el flag antes
  // de cerrar (PATCH /entregas/{id}/items con items:[] -- solo toca es_faia,
  // el backend rechaza a punto_venta si el request trajera algun item, ver
  // aplicar_actualizacion_items). Si algo falla se queda en el modal para
  // reintentar, no se pierde el toggle.
  const cerrarModalPuntoVenta = async () => {
    if (!modalEsFaia || !resultadoPuntoVenta?.id || !empleado || !sedeSeleccionada) {
      setResultadoPuntoVenta(null);
      setModalEsFaia(false);
      return;
    }
    setGuardandoFaia(true);
    try {
      await confirmarItems(
        resultadoPuntoVenta.id,
        [],
        empleado.id,
        sedeSeleccionada.id,
        evidenciaActual?.url ?? '',
        evidenciaActual?.hash ?? '',
        undefined,
        true
      );
      setResultadoPuntoVenta(null);
      setModalEsFaia(false);
    } catch (err) {
      Alert.alert('No se pudo guardar', mensajeError(err, 'entrega'), [{ text: 'Entendido' }]);
    } finally {
      setGuardandoFaia(false);
    }
  };

  // Paso 1: sube la foto y le pide al backend que identifique el documento.
  // Si ya se adjunto una foto de traslado (necesitaTraslado de un intento
  // anterior), se sube y se reenvia junto con la evidencia -- pero la
  // factura NO se vuelve a leer con IA: se reenvian tipo/indicativo_numero/
  // items/confianza ya leidos la primera vez (ver payload mas abajo), asi el
  // backend confia en esa lectura en vez de arriesgarse a que la IA lea algo
  // distinto en el reintento (no es determinista).
  const enviar = async () => {
    if (!foto || !sedeSeleccionada || !empleado) return;
    setCargando(true);
    setMensaje('Subiendo evidencia...');

    try {
      const { url, hash } = await subirEvidencia(foto);
      setEvidenciaActual({ url, hash });

      let trasladoUrl: string | undefined;
      if (fotoTraslado) {
        setMensaje('Subiendo traslado...');
        const subida = await subirEvidencia(fotoTraslado);
        trasladoUrl = subida.url;
      }

      setMensaje('Extrayendo datos con IA...');

      const resultado = await procesarEntrega({
        evidencia_url: url,
        hash_evidencia: hash,
        sede_origen_id: sedeSeleccionada.id,
        operador_id: empleado.id,
        capturado_at: new Date().toISOString(),
        traslado_url: trasladoUrl,
        // Reintento sobre la misma foto (necesitaTraslado ya seteado de un
        // intento anterior): se reenvia la lectura original en vez de dejar
        // que el backend vuelva a leer la factura con IA.
        ...(necesitaTraslado
          ? {
              tipo_conocido: necesitaTraslado.tipo,
              indicativo_numero_conocido: necesitaTraslado.indicativo_numero,
              items_conocidos: necesitaTraslado.items,
              confianza_conocida: necesitaTraslado.confianza,
            }
          : {}),
      });

      if (resultado.situacion === 'necesita_traslado') {
        const yaHabiaTraslado = !!trasladoUrl;
        setNecesitaTraslado({
          tipo: resultado.tipo,
          indicativo_numero: resultado.indicativo_numero,
          rechazado: yaHabiaTraslado,
          // El backend devuelve la misma lectura que recibio (propia o
          // _conocida) -- se vuelve a guardar aca para que un segundo
          // rechazo del traslado siga reenviando la lectura original, nunca
          // una nueva de la IA.
          items: resultado.items.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad_entregada })),
          confianza: resultado.confianza,
        });
        if (yaHabiaTraslado) {
          // La foto que se mando no correspondia a esta factura -- se
          // limpia para obligar a elegir una nueva, no reintentar la misma.
          setFotoTraslado(null);
        }
        setMensaje('');
        return;
      }

      setNecesitaTraslado(null);
      setFotoTraslado(null);

      if (empleado.rol === 'punto_venta') {
        // Punto de venta factura y listo -- sin Confirmando (no carga
        // cantidades, no consulta facturas existentes). El modal de abajo
        // muestra lo que quedo registrado; al cerrarlo queda lista la
        // pantalla para la proxima foto.
        setFoto(null);
        setDocumentoIdentificado(null);
        setMensaje('');
        setModalEsFaia(false);
        setResultadoPuntoVenta(resultado);
        return;
      }

      setEntregaId(resultado.id);
      setSituacion(resultado.situacion);
      // Aviso temprano de traslado PARA CONFIRMAR (necesitaTrasladoConfirmar
      // en EntregaContext) -- no confundir con el estado local
      // necesitaTraslado de esta misma pantalla, que es el de CREAR (otro
      // mecanismo, otra forma). Solo llega en true al re-escanear un
      // documento pendiente que le pertenece a otra sede (situacion
      // 'actualizable'); en 'nueva' el documento se acaba de crear con esta
      // misma sede, nunca hace falta.
      setNecesitaTrasladoConfirmar(
        resultado.requiere_traslado
          ? { tipo: resultado.tipo, indicativo_numero: resultado.indicativo_numero }
          : null
      );
      setEstadoFinal(resultado.estado);
      setDocumentoIdentificado({ tipo: resultado.tipo, indicativo_numero: resultado.indicativo_numero });
      // Precarga el switch FAIA con el valor real del documento (false en uno
      // recien creado, o el que ya tenia si es una re-confirmacion) -- nunca
      // asumir false a mano, se pisaria un FAIA ya marcado en otra visita.
      setEsFaia(resultado.es_faia);
      // Misma logica que esFaia: precarga la nota general real, nunca
      // asumir vacio a mano (se perderia una ya escrita en otra visita).
      // notaGeneralOriginal queda fija en este valor -- Confirmando la usa
      // para saber si el bodeguero de verdad cambio la nota.
      setNotaGeneral(resultado.nota_general ?? '');
      setNotaGeneralOriginal(resultado.nota_general ?? '');
      // Antes solo llegaba via buscarEntrega -- ahora procesarEntrega
      // tambien la trae (ver procesar_extraccion), asi "Ver Datos de
      // Entrega" puede mostrar la ultima firma aunque se haya llegado
      // re-fotografiando en vez de consultando la factura.
      setFirmaUrlConsultada(resultado.firma_url ?? null);
      setItems(
        resultado.items.map((item) => ({
          ...item,
          valor: '',
          nota: item.nota ?? '',
          descripcionOriginal: item.descripcion,
          cantidadEntregadaOriginal: item.cantidad_entregada,
        }))
      );
      setMensaje('');
      navigation.navigate('Confirmando');
    } catch (err: any) {
      // Foto ilegible: el backend no llego a crear nada (ver ExtraccionIlegible
      // en el backend) -- se queda en esta pantalla para repetir la foto ahi
      // mismo, a diferencia de cualquier otro error (que sigue a Resultado).
      if (err?.status === 422 && typeof err?.detail === 'string' && err.detail.startsWith('No se pudo leer el documento')) {
        setCargando(false);
        Alert.alert(
          'Foto no procesable',
          'No se pudo leer el documento. Tomá otra foto con mejor luz y encuadre.',
          [{ text: 'Entendido' }]
        );
        return; // se queda en Captura, foto sigue puesta, listo para repetir
      }

      // Pedido todavia no facturado por punto de venta: tampoco se creo nada
      // (ver entregas.py) -- misma logica que la foto ilegible, se queda aca
      // para reintentar mas tarde en vez de navegar a Resultado.
      if (esErrorFacturacionPendiente(err)) {
        setCargando(false);
        Alert.alert('Pedido no facturado', MENSAJE_FACTURACION_PENDIENTE, [{ text: 'Entendido' }]);
        return; // se queda en Captura, foto sigue puesta, listo para repetir
      }

      // punto_venta re-fotografio una factura que ya habia registrado (ver
      // FacturaYaRegistrada) -- a diferencia de los dos casos de arriba, no
      // hay nada que reintentar: se limpia la foto para la proxima, no el
      // modal de exito (no hay nada nuevo que mostrar).
      if (esErrorFacturaYaRegistrada(err)) {
        setCargando(false);
        setFoto(null);
        Alert.alert('Factura repetida', MENSAJE_FACTURA_YA_REGISTRADA, [{ text: 'Entendido' }]);
        return;
      }

      setEstadoFinal('error');
      const textoError: string =
        err?.status === 409
          ? (err?.detail ?? 'Este documento ya fue entregado por completo — acción bloqueada.')
          : mensajeError(err, 'entrega');

      if (err?.status === 409) {
        // Ya no queda nada pendiente: es la alerta mas importante del flujo
        // (evita doble despacho entre sedes) — un popup nativo no se puede
        // pasar por alto como el texto en pantalla.
        Alert.alert('Nada pendiente', textoError, [{ text: 'Entendido' }]);
      }
      navigation.navigate('Resultado', { mensaje: textoError });
    } finally {
      setCargando(false);
    }
  };

  // Si necesitaTraslado esta activo (el tipo leido pertenece a otra sede),
  // hace falta tambien la foto del traslado para poder reenviar.
  const puedeEnviar = !!foto && !!sedeSeleccionada && !cargando && (!necesitaTraslado || !!fotoTraslado);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HeaderEntrega />

        <View style={styles.tarjeta}>
          <View style={styles.filaConIcono}>
            <Text style={styles.etiquetaSeccion}>Foto de la factura</Text>
            {documentoIdentificado ? (
              <Text style={styles.badgeIdentificador}>
                {formatearIdentificador(documentoIdentificado.tipo, documentoIdentificado.indicativo_numero)}
              </Text>
            ) : null}
          </View>
          <VistaFoto
            uri={foto}
            deshabilitado={cargando}
            procesando={cargando && !necesitaTraslado}
            mensajeProcesando={mensaje}
            onTomar={tomarFoto}
            onRotar={rotarFoto}
            onAmpliar={() => foto && setFotoAmpliada(foto)}
            vacioTitulo="Toca para tomar la foto"
            vacioIcono="camera"
            consejos={CONSEJOS_FOTO}
          />
        </View>

        {necesitaTraslado ? (
          <View style={[styles.tarjeta, estilosFoto.tarjetaTraslado]}>
            <View style={styles.filaConIcono}>
              <Ionicons name="swap-horizontal" size={18} color="#fbbf24" />
              <Text style={[styles.etiquetaSeccion, { color: '#fbbf24' }]}>Traslado requerido</Text>
            </View>
            <Text style={styles.previewSubtexto}>
              {necesitaTraslado.rechazado
                ? 'La foto del traslado no menciona el número de esta factura -- prueba con la correcta.'
                : `El documento "${
                    formatearIdentificador(necesitaTraslado.tipo, necesitaTraslado.indicativo_numero) ??
                    necesitaTraslado.tipo
                  }" pertenece a otra sede -- para procesarlo desde acá, adjunta una foto del traslado.`}
            </Text>
            <VistaFoto
              uri={fotoTraslado}
              deshabilitado={cargando}
              procesando={cargando}
              mensajeProcesando={mensaje}
              onTomar={tomarFotoTraslado}
              onRotar={rotarFotoTraslado}
              onAmpliar={() => fotoTraslado && setFotoAmpliada(fotoTraslado)}
              vacioTitulo="Toca para tomar la foto del traslado"
              vacioIcono="document-attach"
            />
            <Pressable
              disabled={cargando}
              style={({ pressed }) => [estilosFoto.botonSecundario, pressed && styles.botonPresionado]}
              onPress={elegirTrasladoDeGaleria}
            >
              <Ionicons name="images-outline" size={18} color={NEUTRAL_400} />
              <Text style={estilosFoto.botonSecundarioTexto}>Elegir de galería</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Aviso de procesando fuera de la foto solo si no hay foto donde
            mostrarlo (no deberia pasar, pero que no quede sin feedback). */}
        {cargando && !foto ? (
          <View style={[styles.tarjeta, styles.estadoBox]}>
            <ActivityIndicator color={ACENTO} />
            <Text style={styles.mensajeSubiendo}>{mensaje}</Text>
          </View>
        ) : null}

        <View style={styles.acciones}>
          {/* Una sola accion principal grande: tomar la foto, o enviarla si
              ya esta. El resto queda como botones chicos lado a lado. */}
          {foto ? (
            <Pressable
              disabled={!puedeEnviar}
              style={({ pressed }) => [
                styles.boton,
                styles.botonPrimario,
                estilosFoto.botonPrincipal,
                !puedeEnviar && styles.botonDeshabilitado,
                pressed && puedeEnviar && styles.botonPresionado,
              ]}
              onPress={enviar}
            >
              <ContenidoBoton icono="checkmark-circle-outline" texto={cargando ? 'Procesando...' : 'Enviar y procesar'} />
            </Pressable>
          ) : (
            <Pressable
              disabled={cargando}
              style={({ pressed }) => [
                styles.boton,
                styles.botonPrimario,
                estilosFoto.botonPrincipal,
                pressed && styles.botonPresionado,
              ]}
              onPress={tomarFoto}
            >
              <ContenidoBoton icono="camera-outline" texto="Tomar foto" />
            </Pressable>
          )}

          <View style={estilosFoto.filaSecundaria}>
            <Pressable
              disabled={cargando}
              style={({ pressed }) => [estilosFoto.botonSecundario, pressed && styles.botonPresionado]}
              onPress={elegirDeGaleria}
            >
              <Ionicons name="images-outline" size={18} color={NEUTRAL_400} />
              <Text style={estilosFoto.botonSecundarioTexto}>{foto ? 'Cambiar de galería' : 'Galería'}</Text>
            </Pressable>

            {empleado?.rol !== 'punto_venta' ? (
              <Pressable
                disabled={cargando}
                style={({ pressed }) => [estilosFoto.botonSecundario, pressed && styles.botonPresionado]}
                onPress={() => {
                  setMensaje('');
                  navigation.navigate('Buscar');
                }}
              >
                <Ionicons name="search-outline" size={18} color={NEUTRAL_400} />
                <Text style={estilosFoto.botonSecundarioTexto}>Consultar factura</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {resultadoPuntoVenta ? (
        <Modal
          visible
          animationType="fade"
          transparent
          statusBarTranslucent
          onRequestClose={() => setResultadoPuntoVenta(null)}
        >
          <View style={estilosModalFactura.fondo}>
            <View style={[styles.tarjeta, estilosModalFactura.tarjeta]}>
              <View style={styles.filaConIcono}>
                <Ionicons
                  name={ESTADO_INFO[resultadoPuntoVenta.estado].icono}
                  size={20}
                  color={ESTADO_INFO[resultadoPuntoVenta.estado].color}
                />
                <Text style={[styles.etiquetaSeccion, { color: ESTADO_INFO[resultadoPuntoVenta.estado].color }]}>
                  {ESTADO_INFO[resultadoPuntoVenta.estado].texto}
                </Text>
              </View>
              <Text style={styles.badgeIdentificador}>
                {formatearIdentificador(resultadoPuntoVenta.tipo, resultadoPuntoVenta.indicativo_numero)}
              </Text>
              <View style={estilosModalFactura.listaItems}>
                {resultadoPuntoVenta.items.map((item) => (
                  <View key={item.id} style={estilosModalFactura.filaItem}>
                    <Text style={styles.previewSubtexto}>{item.descripcion}</Text>
                    <Text style={styles.previewSubtexto}>{item.cantidad_pendiente}</Text>
                  </View>
                ))}
              </View>
              {/* Punto de venta es quien marca FAIA (el bodeguero lo ve de
                  solo lectura en PantallaConfirmando) -- mismo patron visual
                  de checkbox que el resto de la app. FAIA es un concepto
                  exclusivo de Polo Sur (codigo "SEDE-02", ver _TIPO_SEDE_DUENA
                  en el backend para el mismo criterio de comparar por codigo
                  y no por nombre) -- Mostrador Centro ni ve el switch. */}
              {sedeSeleccionada?.codigo === 'SEDE-02' ? (
                <Pressable
                  onPress={() => setModalEsFaia((v) => !v)}
                  hitSlop={8}
                  style={[styles.checkboxFila, estilosModalFactura.checkboxFaia]}
                >
                  <View style={[styles.checkboxCaja, modalEsFaia && styles.checkboxCajaMarcada]}>
                    {modalEsFaia ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
                  <Text style={styles.checkboxTexto}>Es FAIA</Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={guardandoFaia}
                style={({ pressed }) => [
                  styles.boton,
                  styles.botonPrimario,
                  estilosModalFactura.botonListo,
                  guardandoFaia && styles.botonDeshabilitado,
                  pressed && !guardandoFaia && styles.botonPresionado,
                ]}
                onPress={cerrarModalPuntoVenta}
              >
                <ContenidoBoton icono="checkmark-circle-outline" texto={guardandoFaia ? 'Guardando...' : 'Listo'} />
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const estilosModalFactura = StyleSheet.create({
  fondo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  tarjeta: { gap: 4 },
  listaItems: { gap: 6, marginTop: 8, marginBottom: 4 },
  filaItem: { flexDirection: 'row', justifyContent: 'space-between' },
  checkboxFaia: { marginTop: 4 },
  botonListo: { marginTop: 10 },
});

const estilosFoto = StyleSheet.create({
  vacio: {
    height: 300,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(200,99,31,0.55)',
    backgroundColor: 'rgba(200,99,31,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
  },
  vacioPresionado: { backgroundColor: 'rgba(200,99,31,0.14)' },
  circuloCamara: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(200,99,31,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vacioTitulo: { color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_BODY_SEMI, textAlign: 'center' },
  consejos: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
  consejo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: NEUTRAL_800,
  },
  consejoTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY },
  controles: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  botonSobreFoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(15,21,32,0.78)',
  },
  botonSobreFotoTexto: { color: TEXTO_PRIMARIO, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  velo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    backgroundColor: 'rgba(15,21,32,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  veloTexto: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI, textAlign: 'center' },
  tarjetaTraslado: { borderColor: 'rgba(251,191,36,0.45)' },
  botonPrincipal: { paddingVertical: 18 },
  filaSecundaria: { flexDirection: 'row', gap: 10 },
  botonSecundario: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: 'transparent',
  },
  botonSecundarioTexto: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY_SEMI },
});
