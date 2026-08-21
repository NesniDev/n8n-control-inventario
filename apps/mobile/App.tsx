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
  cancelarEntrega,
  confirmarItems,
  fetchHistorialEntrega,
  fetchSedes,
  procesarEntrega,
  registrarDevolucion,
  subirEvidencia,
  type Empleado,
  type ItemEntrega,
  type LogEntry,
  type MotivoDevolucion,
  type ResolucionDevolucion,
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

// Lista fija de motivos de devolucion (mismos valores que el backend).
const MOTIVOS_DEVOLUCION: { valor: MotivoDevolucion; texto: string }[] = [
  { valor: 'danado', texto: 'Dañado' },
  { valor: 'equivocado', texto: 'Equivocado' },
  { valor: 'vencido', texto: 'Vencido' },
  { valor: 'no_era_lo_pedido', texto: 'No era lo pedido' },
  { valor: 'otro', texto: 'Otro' },
];

interface DevolucionDraft {
  cantidad: string;
  motivo: MotivoDevolucion | null;
  resolucion: ResolucionDevolucion | null;
}

const DEVOLUCION_DRAFT_VACIO: DevolucionDraft = { cantidad: '', motivo: null, resolucion: null };

const ESTADO_INFO: Record<EstadoFinal, { icono: string; texto: string; color: string; fondo: string }> = {
  procesada: { icono: '✅', texto: 'Procesada', color: '#34d399', fondo: 'rgba(52,211,153,0.12)' },
  pendiente_revision: { icono: '🕵️', texto: 'Pendiente de revisión', color: '#fbbf24', fondo: 'rgba(251,191,36,0.12)' },
  error: { icono: '⚠️', texto: 'Error', color: '#f87171', fondo: 'rgba(248,113,113,0.12)' },
};

interface ItemFormulario extends ItemEntrega {
  valor: string;
  // Texto editable de la nota -- siempre string (nunca null), se inicializa
  // desde item.nota ?? '' al cargar (ver enviar()/buscarFactura()).
  nota: string;
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

interface EventoHistorial {
  fecha: string;
  texto: string;
}

// Arma el historial de fechas de UN producto puntual a partir del historial
// completo de la entrega (logs con detalle.items trae la foto de TODOS los
// productos en cada evento -- aca se filtra solo el que corresponde). Asi se
// ve cada vez que cambio ese pendiente, aunque haya sido 5 veces.
function historialDeItem(historial: LogEntry[], itemId: string): EventoHistorial[] {
  const ordenado = [...historial].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const eventos: EventoHistorial[] = [];
  for (const log of ordenado) {
    if (log.evento === 'entrega_actualizada') {
      const encontrado = (log.detalle?.items as any[] | undefined)?.find((i) => i.id === itemId);
      if (encontrado) {
        eventos.push({
          fecha: log.timestamp,
          texto: `Entregado ${encontrado.cantidad_entregada} · Pendiente ${encontrado.cantidad_pendiente}`,
        });
      }
    } else if (log.evento === 'devolucion_registrada' && log.detalle?.item_id === itemId) {
      const resolucion = log.detalle.resolucion === 'reposicion' ? 'repuesto' : 'reembolsado';
      eventos.push({
        fecha: log.timestamp,
        texto: `↩️ Devolución de ${log.detalle.cantidad} (${log.detalle.motivo}) -- ${resolucion}`,
      });
    }
  }
  return eventos;
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
  // Ids de items con el editor de nota abierto (ver alternarNota).
  const [notasAbiertas, setNotasAbiertas] = useState<Set<string>>(new Set());
  // Ids de items con el formulario de devolucion abierto, y su borrador
  // (cantidad/motivo/resolucion) mientras se completa -- se descarta al
  // cerrar o al registrar con exito (ver alternarDevolucion).
  const [devolucionesAbiertas, setDevolucionesAbiertas] = useState<Set<string>>(new Set());
  const [devolucionDrafts, setDevolucionDrafts] = useState<Record<string, DevolucionDraft>>({});
  // Historial de logs de la entrega actual -- se pide una sola vez (todos
  // los productos comparten el mismo fetch) al abrir el primer historial.
  const [historial, setHistorial] = useState<LogEntry[] | null>(null);
  const [historialesAbiertos, setHistorialesAbiertos] = useState<Set<string>>(new Set());
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

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
      setItems(resultado.items.map((item) => ({ ...item, valor: '', nota: item.nota ?? '' })));
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
      setItems(resultado.items.map((item) => ({ ...item, valor: '', nota: item.nota ?? '' })));
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

  // Paso 2: confirma lo que cargo el bodeguero por producto (ver
  // itemsAEnviar: para 'nueva' van todos, para 'actualizable' solo los que
  // de verdad traen un cambio).
  const confirmar = async () => {
    if (!entregaId || !situacion) return;
    setCargando(true);
    setMensaje('Guardando...');

    try {
      const payload = itemsAEnviar.map((item) => {
        const nota = item.nota.trim() || undefined;
        // Un item bloqueado (ver esBloqueado) solo puede estar en
        // itemsAEnviar por tener una nota nueva (ver mas abajo) -- no hay
        // cantidad que mandar, y mandar entregado_hoy/cantidad_pendiente
        // igual no rompe nada, pero es mas claro mandar solo la nota.
        if (situacion === 'actualizable' && esBloqueado(item, situacion)) {
          return { id: item.id, nota };
        }
        return situacion === 'nueva'
          ? { id: item.id, cantidad_pendiente: Number(item.valor.trim()), nota }
          : { id: item.id, entregado_hoy: Number(item.valor.trim()), nota };
      });
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

  const actualizarNotaItem = (id: string, nota: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, nota } : item)));
  };

  // Que items tienen el editor de nota abierto -- separado del texto en si,
  // asi se puede abrir el editor sin que eso cuente como "tiene nota".
  const alternarNota = (id: string) => {
    setNotasAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  const alternarDevolucion = (id: string) => {
    setDevolucionesAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  // Se pide el historial una sola vez por entrega (todos los productos
  // comparten el mismo fetch a /logs); si ya esta cargado, solo alterna la
  // visibilidad de este item puntual.
  const alternarHistorial = async (id: string) => {
    setHistorialesAbiertos((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });

    if (historial !== null || !entregaId || historialesAbiertos.has(id)) return;
    setCargandoHistorial(true);
    try {
      setHistorial(await fetchHistorialEntrega(entregaId));
    } catch {
      // Sin historial no se rompe nada mas -- se ve la lista vacia y listo.
      setHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  };

  const actualizarDraftDevolucion = (id: string, cambios: Partial<DevolucionDraft>) => {
    setDevolucionDrafts((prev) => ({
      ...prev,
      [id]: { ...DEVOLUCION_DRAFT_VACIO, ...prev[id], ...cambios },
    }));
  };

  // Devolucion de un producto ya entregado -- accion propia e inmediata,
  // no forma parte del guardado general de confirmar(). Actualiza el item
  // local con lo que devuelve el backend (cantidades ya corregidas).
  const registrarDevolucionItem = async (item: ItemFormulario) => {
    if (!entregaId) return;
    const draft = devolucionDrafts[item.id];
    const cantidad = Number((draft?.cantidad ?? '').trim());
    if (!draft?.motivo || !draft?.resolucion || !/^\d+$/.test(draft.cantidad.trim())) return;
    if (cantidad <= 0 || cantidad > item.cantidad_entregada) return;

    setCargando(true);
    setMensaje('Registrando devolución...');
    try {
      const { item: itemActualizado } = await registrarDevolucion(entregaId, {
        item_id: item.id,
        cantidad,
        motivo: draft.motivo,
        resolucion: draft.resolucion,
        operador_id: empleado.id,
        sede_id: sedeSeleccionada?.id ?? '',
      });
      // El valor tipeado (entregado hoy) puede haber quedado invalido contra
      // el nuevo pendiente -- se limpia para que lo carguen de nuevo.
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, ...itemActualizado, valor: '', nota: itemActualizado.nota ?? '' } : it
        )
      );
      setDevolucionDrafts((prev) => {
        const { [item.id]: _descartado, ...resto } = prev;
        return resto;
      });
      alternarDevolucion(item.id);
      setHistorial(null); // se acaba de sumar un evento nuevo -- refresca al reabrir
      setMensaje('Devolución registrada.');
    } catch (err: any) {
      setMensaje(err?.detail ?? err?.message ?? 'Error al registrar la devolución.');
    } finally {
      setCargando(false);
    }
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
    setNotasAbiertas(new Set());
    setDevolucionesAbiertas(new Set());
    setDevolucionDrafts({});
    setHistorial(null);
    setHistorialesAbiertos(new Set());
  };

  // Cancelar en la pantalla de confirmacion: procesarEntrega (paso 1) ya
  // insertó la entrega si situacion es 'nueva' -- sin esto, cancelar dejaba
  // esa fila en la base como si se hubiera enviado igual. Solo hace falta
  // avisarle al backend para 'nueva': para 'actualizable' (re-escaneo o
  // consulta) el paso 1 no escribe nada, no hay nada que deshacer.
  const cancelarConfirmacion = async () => {
    if (situacion === 'nueva' && entregaId) {
      setCargando(true);
      try {
        await cancelarEntrega(entregaId, empleado.id, sedeSeleccionada?.id ?? '');
      } catch {
        // Best-effort: si falla la red no bloqueamos al bodeguero por esto --
        // en el peor caso queda una entrega "nueva" sin confirmar, que no
        // rompe nada (un proximo escaneo/consulta la trata como actualizable).
      } finally {
        setCargando(false);
      }
    }
    reiniciar();
  };

  // Items que requieren una cantidad valida para poder confirmar. Para
  // 'nueva' son TODOS -- el pendiente inicial de cada item (incluido el que
  // quedo en 0 via el check "todo entregado") todavia no se guardo en
  // ningun lado, asi que aunque esBloqueado() lo marque como "bloqueado"
  // para no dejarlo seguir editando, igual hay que mandarlo. Para
  // 'actualizable' un item ya bloqueado significa que la DB ya dice
  // pendiente=0 -- no hay cantidad que confirmarle.
  const itemsConCambioCantidad =
    situacion === 'actualizable' ? items.filter((item) => !esBloqueado(item, situacion)) : items;
  // Items que de verdad hay que mandar al guardar: los de arriba, mas
  // cualquier item bloqueado al que se le haya agregado una nota (eso
  // tambien es un cambio real, aunque no toque cantidades).
  const itemsAEnviar =
    situacion === 'actualizable'
      ? items.filter((item) => !esBloqueado(item, situacion) || item.nota.trim() !== '')
      : items;
  const cantidadesValidas =
    situacion !== null && itemsConCambioCantidad.every((item) => valorValido(item, situacion));
  const puedeEnviar = !!foto && !!sedeSeleccionada && !cargando;
  const puedeBuscar = !!indicativoBusqueda.trim() && !cargando;
  const puedeConfirmar = itemsAEnviar.length > 0 && cantidadesValidas && !cargando;
  // Puramente sobre cantidades -- no se ve afectado por si se esta cargando
  // una nota, asi el aviso de "nada pendiente" sigue siendo cierto aunque
  // itemsAEnviar (lo que hay que mandar) ya no este vacio por una nota nueva.
  const documentoCompleto =
    fase === 'confirmando' &&
    situacion === 'actualizable' &&
    items.length > 0 &&
    itemsConCambioCantidad.length === 0;
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
              const notaAbierta = notasAbiertas.has(item.id);
              // Una devolucion es sobre algo ya entregado antes -- no tiene
              // sentido en un documento recien escaneado sin confirmar
              // (situacion 'nueva'), ni si todavia no se entrego nada.
              const puedeDevolver = situacion === 'actualizable' && item.cantidad_entregada > 0;
              const devolucionAbierta = devolucionesAbiertas.has(item.id);
              const draft = devolucionDrafts[item.id] ?? DEVOLUCION_DRAFT_VACIO;
              const cantidadDevolucionValida =
                /^\d+$/.test(draft.cantidad.trim()) &&
                Number(draft.cantidad.trim()) > 0 &&
                Number(draft.cantidad.trim()) <= item.cantidad_entregada;
              const puedeRegistrarDevolucion =
                cantidadDevolucionValida && !!draft.motivo && !!draft.resolucion && !cargando;
              // El historial de fechas solo tiene sentido para algo que ya
              // existia antes -- un documento recien escaneado sin confirmar
              // todavia no tiene nada que mostrar.
              const puedeVerHistorial = situacion === 'actualizable';
              const historialAbierto = historialesAbiertos.has(item.id);
              const eventosHistorial = historial ? historialDeItem(historial, item.id) : [];
              return (
                <View key={item.id} style={styles.tarjeta}>
                  <View style={styles.filaTitulo}>
                    <Text style={[styles.itemDescripcion, { flex: 1 }]}>
                      {item.descripcion || 'Producto sin descripción'}
                    </Text>
                    {puedeVerHistorial ? (
                      <Pressable onPress={() => alternarHistorial(item.id)} hitSlop={8}>
                        <Text style={styles.notaIcono}>🕒</Text>
                      </Pressable>
                    ) : null}
                    {puedeDevolver ? (
                      <Pressable onPress={() => alternarDevolucion(item.id)} hitSlop={8}>
                        <Text style={styles.notaIcono}>↩️</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => alternarNota(item.id)} hitSlop={8}>
                      <Text style={styles.notaIcono}>{item.nota.trim() ? '📝' : '➕📝'}</Text>
                    </Pressable>
                  </View>

                  {historialAbierto ? (
                    <View style={styles.historialCaja}>
                      {cargandoHistorial ? (
                        <ActivityIndicator color="#c8631f" />
                      ) : eventosHistorial.length === 0 ? (
                        <Text style={styles.previewSubtexto}>Sin cambios registrados todavía.</Text>
                      ) : (
                        eventosHistorial.map((evento, i) => (
                          <View key={i} style={styles.historialFila}>
                            <Text style={styles.historialFecha}>
                              {new Date(evento.fecha).toLocaleString('es-CO', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                            <Text style={styles.historialTexto}>{evento.texto}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}

                  {notaAbierta ? (
                    <TextInput
                      value={item.nota}
                      onChangeText={(texto) => actualizarNotaItem(item.id, texto)}
                      placeholder="Información adicional de este producto (opcional)"
                      placeholderTextColor="#6b7688"
                      style={styles.inputNota}
                      multiline
                    />
                  ) : item.nota.trim() ? (
                    <Pressable onPress={() => alternarNota(item.id)}>
                      <Text style={styles.notaPreview}>📝 {item.nota}</Text>
                    </Pressable>
                  ) : null}

                  {devolucionAbierta ? (
                    <View style={styles.devolucionCaja}>
                      <Text style={styles.etiquetaSeccion}>Devolución -- cantidad</Text>
                      <TextInput
                        value={draft.cantidad}
                        onChangeText={(texto) => actualizarDraftDevolucion(item.id, { cantidad: texto })}
                        keyboardType="number-pad"
                        placeholder={`Máx. ${item.cantidad_entregada}`}
                        placeholderTextColor="#6b7688"
                        style={styles.inputCantidad}
                      />

                      <Text style={styles.etiquetaSeccion}>Motivo</Text>
                      <View style={styles.chipsEnvoltorio}>
                        {MOTIVOS_DEVOLUCION.map((m) => {
                          const activo = draft.motivo === m.valor;
                          return (
                            <Pressable
                              key={m.valor}
                              onPress={() => actualizarDraftDevolucion(item.id, { motivo: m.valor })}
                              style={[styles.chipSede, activo && styles.chipSedeActiva]}
                            >
                              <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>
                                {m.texto}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={styles.etiquetaSeccion}>Resolución</Text>
                      <View style={styles.chipsEnvoltorio}>
                        {(
                          [
                            { valor: 'reposicion', texto: '🔁 Repongo' },
                            { valor: 'reembolso', texto: '💵 Reembolso' },
                          ] as const
                        ).map((r) => {
                          const activo = draft.resolucion === r.valor;
                          return (
                            <Pressable
                              key={r.valor}
                              onPress={() => actualizarDraftDevolucion(item.id, { resolucion: r.valor })}
                              style={[styles.chipSede, activo && styles.chipSedeActiva]}
                            >
                              <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>
                                {r.texto}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {draft.resolucion === 'reposicion' ? (
                        <Text style={styles.previewSubtexto}>Vuelve a quedar pendiente -- se debe re-entregar.</Text>
                      ) : draft.resolucion === 'reembolso' ? (
                        <Text style={styles.previewSubtexto}>
                          Se devuelve el dinero -- esa cantidad queda cerrada, no vuelve a pendiente.
                        </Text>
                      ) : null}

                      <Pressable
                        disabled={!puedeRegistrarDevolucion}
                        style={({ pressed }) => [
                          styles.boton,
                          styles.botonPrimario,
                          !puedeRegistrarDevolucion && styles.botonDeshabilitado,
                          pressed && puedeRegistrarDevolucion && styles.botonPresionado,
                        ]}
                        onPress={() => registrarDevolucionItem(item)}
                      >
                        <Text style={styles.botonTexto}>↩️ Registrar devolución</Text>
                      </Pressable>
                    </View>
                  ) : null}

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
              {itemsAEnviar.length === 0 ? null : (
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
                  <Text style={styles.botonTexto}>
                    {cargando
                      ? 'Guardando...'
                      : itemsConCambioCantidad.length === 0
                        ? '📝 Guardar nota'
                        : '✅ Confirmar cantidades'}
                  </Text>
                </Pressable>
              )}
              <Pressable
                disabled={cargando}
                style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
                onPress={cancelarConfirmacion}
              >
                <Text style={styles.botonTexto}>{itemsAEnviar.length === 0 ? 'Volver' : 'Cancelar'}</Text>
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
  filaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notaIcono: { fontSize: 18 },
  inputNota: {
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  notaPreview: { color: NEUTRAL_400, fontSize: 13, fontStyle: 'italic' },
  devolucionCaja: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  chipsEnvoltorio: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  historialCaja: {
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  historialFila: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  historialFecha: { color: NEUTRAL_500, fontSize: 11, fontVariant: ['tabular-nums'] },
  historialTexto: { color: '#d3d9e6', fontSize: 12, flexShrink: 1 },
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
