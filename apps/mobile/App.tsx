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
  buscarEntrega,
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
// buscar: consultar una factura ya registrada por su codigo, sin foto.
// confirmando: el bodeguero ve los productos y carga cantidades (paso 2) --
// llega aca tanto desde 'captura' (documento nuevo o re-escaneado) como
// desde 'buscar' (consulta directa, siempre situacion 'actualizable').
// resultado: pantalla final (procesada / pendiente de revision / error).
type Fase = 'captura' | 'buscar' | 'confirmando' | 'resultado';
type EstadoFinal = 'procesada' | 'pendiente_revision' | 'error';

const TIPOS_DOCUMENTO = ['FEI', 'TB', 'RM3', 'RM2'] as const;

const ESTADO_INFO: Record<EstadoFinal, { icono: string; texto: string; color: string; fondo: string }> = {
  procesada: { icono: '✅', texto: 'Procesada', color: '#34d399', fondo: 'rgba(52,211,153,0.12)' },
  pendiente_revision: { icono: '🕵️', texto: 'Pendiente de revisión', color: '#fbbf24', fondo: 'rgba(251,191,36,0.12)' },
  error: { icono: '⚠️', texto: 'Error', color: '#f87171', fondo: 'rgba(248,113,113,0.12)' },
};

interface ItemFormulario extends ItemEntrega {
  valor: string;
}

// Para 'nueva' bloquea segun lo que se esta tipeando (el bodeguero declara
// cuanto quedo pendiente, y se bloquea en vivo si pone 0). Para
// 'actualizable' -- venga de re-escanear una foto o de buscar por codigo --
// bloquea segun el dato real de la DB: si ya no queda nada pendiente de ese
// item, no hay nada para editar, sin importar que se haya tipeado.
function esBloqueado(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): boolean {
  return situacion === 'nueva' ? item.valor.trim() === '0' : item.cantidad_pendiente === 0;
}

// Tope de lo que se puede tipear en cada item: para 'actualizable' no se
// puede entregar mas de lo que queda pendiente (el backend tambien lo
// valida -- ver aplicar_actualizacion_items -- esto es para avisar en el
// momento, sin esperar el error del servidor). Para 'nueva' no puede quedar
// pendiente mas de lo que la IA leyo en total.
function topeValor(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): number {
  return situacion === 'actualizable' ? item.cantidad_pendiente : item.cantidad_entregada;
}

// Valor que corresponde al check "ya se entrego todo esto" -- para 'nueva'
// es 0 (no queda nada pendiente de este producto); para 'actualizable' es el
// pendiente actual completo (se entrego todo lo que faltaba).
function valorTodoEntregado(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): number {
  return situacion === 'actualizable' ? item.cantidad_pendiente : 0;
}

function valorValido(item: ItemFormulario, situacion: 'nueva' | 'actualizable'): boolean {
  const valor = item.valor.trim();
  if (!/^\d+$/.test(valor)) return false;
  return Number(valor) <= topeValor(item, situacion);
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

  // Consulta por codigo de factura (fase 'buscar'), sin pasar por una foto.
  const [tipoBusqueda, setTipoBusqueda] = useState<(typeof TIPOS_DOCUMENTO)[number]>('FEI');
  const [indicativoBusqueda, setIndicativoBusqueda] = useState('');

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

  // Consulta directa por codigo de factura, sin foto -- el documento ya
  // existe por definicion, asi que reusa la misma pantalla de confirmacion
  // de items que el flujo de re-escaneo (fase 'confirmando').
  const buscarFactura = async () => {
    const indicativo = indicativoBusqueda.trim();
    if (!indicativo) return;
    setCargando(true);
    setMensaje('Buscando...');

    try {
      const resultado = await buscarEntrega(tipoBusqueda, indicativo);
      setEntregaId(resultado.id);
      setSituacion(resultado.situacion);
      setEstadoFinal(resultado.estado);
      setItems(resultado.items.map((item) => ({ ...item, valor: '' })));
      setEvidenciaActual(null);
      setFase('confirmando');
      setMensaje('');
    } catch (err: any) {
      // No es un resultado terminal -- se queda en 'buscar' para reintentar
      // (codigo mal tipeado, documento que todavia no se registro, etc.).
      setMensaje(err?.detail ?? err?.message ?? 'No se encontro ese documento.');
    } finally {
      setCargando(false);
    }
  };

  // Paso 2: confirma lo que cargo el bodeguero por producto. Los items
  // bloqueados (ver esBloqueado) no se mandan -- no traen ningun cambio.
  const confirmar = async () => {
    if (!entregaId || !situacion) return;
    setCargando(true);
    setMensaje('Guardando...');

    try {
      const payload = items
        .filter((item) => !esBloqueado(item, situacion))
        .map((item) =>
          situacion === 'nueva'
            ? { id: item.id, cantidad_pendiente: Number(item.valor.trim()) }
            : { id: item.id, entregado_hoy: Number(item.valor.trim()) }
        );
      await confirmarItems(
        entregaId,
        payload,
        empleado.id,
        sedeSeleccionada?.id ?? '',
        // Si se llego por 'buscar' no hay foto nueva -- el backend trata un
        // string vacio como "no actualizar evidencia" (ver aplicar_actualizacion_items).
        evidenciaActual?.url ?? '',
        evidenciaActual?.hash ?? ''
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

  // Check "todo entregado" -- evita tener que tipear el numero a mano.
  // Tocarlo de nuevo lo destilda y deja el campo vacio para tipear otra cosa.
  const alternarTodoEntregado = (item: ItemFormulario) => {
    if (!situacion) return;
    const completo = String(valorTodoEntregado(item, situacion));
    const marcado = item.valor.trim() === completo;
    actualizarValorItem(item.id, marcado ? '' : completo);
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
    setIndicativoBusqueda('');
  };

  // Items editables = los que no estan bloqueados (ver esBloqueado). Un
  // documento consultado por codigo puede venir 100% entregado (todos
  // bloqueados) -- ahi no hay nada para confirmar.
  const itemsEditables = situacion ? items.filter((item) => !esBloqueado(item, situacion)) : items;
  const itemsValidos =
    itemsEditables.length > 0 &&
    situacion !== null &&
    itemsEditables.every((item) => valorValido(item, situacion));
  const puedeEnviar = !!foto && !!sedeSeleccionada && !cargando;
  const puedeBuscar = !!indicativoBusqueda.trim() && !cargando;
  const puedeConfirmar = itemsValidos && !cargando;
  const documentoCompleto = fase === 'confirmando' && items.length > 0 && itemsEditables.length === 0;
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

              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={() => {
                  setMensaje('');
                  setFase('buscar');
                }}
              >
                <Text style={styles.botonTexto}>🔍 Consultar factura</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {fase === 'buscar' ? (
          <>
            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>Tipo de documento</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectorSedesContenido}
              >
                {TIPOS_DOCUMENTO.map((t) => {
                  const activo = tipoBusqueda === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTipoBusqueda(t)}
                      style={[styles.chipSede, activo && styles.chipSedeActiva]}
                    >
                      <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>{t}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>Indicativo / número</Text>
              <TextInput
                value={indicativoBusqueda}
                onChangeText={setIndicativoBusqueda}
                placeholder="Ej: 10254"
                placeholderTextColor="#6b7688"
                keyboardType="number-pad"
                style={styles.inputCantidad}
              />
            </View>

            {mensaje ? <Text style={styles.textoErrorInline}>{mensaje}</Text> : null}

            <View style={styles.acciones}>
              <Pressable
                disabled={!puedeBuscar}
                style={({ pressed }) => [
                  styles.boton,
                  styles.botonPrimario,
                  !puedeBuscar && styles.botonDeshabilitado,
                  pressed && puedeBuscar && styles.botonPresionado,
                ]}
                onPress={buscarFactura}
              >
                <Text style={styles.botonTexto}>{cargando ? 'Buscando...' : '🔍 Buscar'}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={reiniciar}
              >
                <Text style={styles.botonTexto}>⬅ Volver</Text>
              </Pressable>
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
                  : documentoCompleto
                    ? 'Ya se entregó todo lo de este documento.'
                    : 'Todavía le queda algo pendiente. Cargá cuánto entregaste hoy de cada producto.'}
              </Text>
            </View>

            {items.map((item) => {
              const bloqueado = situacion ? esBloqueado(item, situacion) : false;
              const tope = situacion ? topeValor(item, situacion) : 0;
              const valorTexto = item.valor.trim();
              const marcadoTodoEntregado =
                !bloqueado && situacion !== null && valorTexto === String(valorTodoEntregado(item, situacion));
              // Se avisa en el momento, sin esperar el error del servidor --
              // el backend igual lo vuelve a validar (ver PATCH /items).
              const excedeTope =
                !bloqueado && situacion !== null && /^\d+$/.test(valorTexto) && Number(valorTexto) > tope;
              return (
                <View key={item.id} style={styles.tarjeta}>
                  <Text style={styles.itemDescripcion}>{item.descripcion || 'Producto sin descripción'}</Text>
                  <Text style={styles.previewSubtexto}>
                    {situacion === 'nueva'
                      ? `Cantidad leída: ${item.cantidad_entregada}`
                      : `Pendiente actual: ${item.cantidad_pendiente}`}
                  </Text>

                  {bloqueado ? null : (
                    <Pressable
                      onPress={() => alternarTodoEntregado(item)}
                      hitSlop={8}
                      style={styles.checkboxFila}
                    >
                      <View style={[styles.checkboxCaja, marcadoTodoEntregado && styles.checkboxCajaMarcada]}>
                        {marcadoTodoEntregado ? <Text style={styles.checkboxCheck}>✓</Text> : null}
                      </View>
                      <Text style={styles.checkboxTexto}>
                        {situacion === 'nueva'
                          ? 'Todo entregado (nada pendiente)'
                          : 'Entregué todo lo que quedaba pendiente'}
                      </Text>
                    </Pressable>
                  )}

                  <Text style={styles.etiquetaSeccion}>
                    {situacion === 'nueva' ? 'Cantidad pendiente' : 'Entregado hoy'}
                  </Text>
                  <TextInput
                    value={item.valor}
                    onChangeText={(valor) => actualizarValorItem(item.id, valor)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#6b7688"
                    editable={!bloqueado && !marcadoTodoEntregado}
                    style={[
                      styles.inputCantidad,
                      (bloqueado || marcadoTodoEntregado) && styles.inputCantidadBloqueado,
                      excedeTope && styles.inputCantidadError,
                    ]}
                  />
                  {bloqueado ? (
                    <Text style={styles.previewSubtexto}>Ya entregado — sin nada pendiente de este producto.</Text>
                  ) : marcadoTodoEntregado ? (
                    // El input debajo sigue mostrando "cuanto entregaste hoy" (lo
                    // que realmente se manda al backend), no el pendiente final --
                    // sin esto no queda claro que tildar el check deja el
                    // pendiente en 0 al guardar (se ve el numero de hoy, que
                    // encima suele coincidir con el total si nunca se entrego
                    // nada de este producto).
                    <Text style={styles.previewSubtexto}>✅ Vas a entregar los {tope} pendientes — quedará en 0.</Text>
                  ) : excedeTope ? (
                    <Text style={styles.textoErrorInline}>
                      {situacion === 'nueva'
                        ? `No puede quedar pendiente más de ${tope} (lo que leyó la IA).`
                        : `No podés entregar más de ${tope} — es lo único que queda pendiente.`}
                    </Text>
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

            {documentoCompleto ? (
              <View style={[styles.badgeEstado, { backgroundColor: 'rgba(52,211,153,0.12)' }]}>
                <Text style={styles.badgeEstadoIcono}>✅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.badgeEstadoTitulo, { color: '#34d399' }]}>Documento completo</Text>
                  <Text style={styles.badgeEstadoMensaje}>
                    No queda nada pendiente de entregar en este documento.
                  </Text>
                </View>
              </View>
            ) : null}

            {mensaje ? <Text style={styles.textoErrorInline}>{mensaje}</Text> : null}

            <View style={styles.acciones}>
              {documentoCompleto ? null : (
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
              )}
              <Pressable
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={reiniciar}
              >
                <Text style={styles.botonTexto}>{documentoCompleto ? 'Volver' : 'Cancelar'}</Text>
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
  inputCantidadError: { borderColor: '#f87171' },
  checkboxFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxCaja: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCajaMarcada: { backgroundColor: ACENTO, borderColor: ACENTO },
  checkboxCheck: { color: '#fff', fontSize: 14, fontWeight: '800' },
  checkboxTexto: { color: '#d3d9e6', fontSize: 13, fontWeight: '600', flexShrink: 1 },
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
