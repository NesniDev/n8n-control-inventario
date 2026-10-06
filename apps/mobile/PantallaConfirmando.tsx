// Paso 2 del flujo: el bodeguero ve los productos y carga cantidades. Llega
// aca tanto desde Captura (documento nuevo o re-escaneado) como desde
// Buscar (consulta directa, siempre situacion 'actualizable'). La firma es
// inline dentro de esta misma fase (modal VisorFirma), solo cuando de
// verdad hay un cambio de cantidades -- no aplica al camino "Guardar nota".
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Signature, { type SignatureViewRef } from 'react-native-signature-canvas';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import {
  confirmarItems,
  fetchHistorialEntrega,
  registrarDevolucion,
  registrarNoEntregado,
  subirEvidencia,
  subirFirma,
  type LogEntry,
  type MotivoDevolucion,
  type MotivoNoEntregado,
  type ResolucionDevolucion,
} from './api';
import EvitarTeclado from './EvitarTeclado';
import { extraerNecesitaTrasladoConfirmar, mensajeError } from './errorMessages';
import {
  comprimirParaEnvio,
  esBloqueado,
  formatearIdentificador,
  HeaderEntrega,
  topeValor,
  useEntrega,
  valorTodoEntregado,
  valorValido,
  type ItemFormulario,
} from './EntregaContext';
import {
  ACENTO,
  ContenidoBoton,
  ESTADO_INFO,
  ESTILO_WEB_FIRMA,
  estilosFirma,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  NEUTRAL_900,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';
import type { DespachosStackParamList } from './Navegacion';

// Lista fija de motivos de devolucion (mismos valores que el backend).
const MOTIVOS_DEVOLUCION: { valor: MotivoDevolucion; texto: string }[] = [
  { valor: 'danado', texto: 'Dañado' },
  { valor: 'equivocado', texto: 'Equivocado' },
  { valor: 'vencido', texto: 'Vencido' },
  { valor: 'no_era_lo_pedido', texto: 'No era lo pedido' },
  { valor: 'otro', texto: 'Otro' },
];

const TEXTO_MOTIVO_DEVOLUCION: Record<string, string> = Object.fromEntries(
  MOTIVOS_DEVOLUCION.map((m) => [m.valor, m.texto])
);

interface DevolucionDraft {
  cantidad: string;
  motivo: MotivoDevolucion | null;
  // Texto libre, solo cuando motivo === 'otro'.
  motivoDetalle: string;
  resolucion: ResolucionDevolucion | null;
}

const DEVOLUCION_DRAFT_VACIO: DevolucionDraft = { cantidad: '', motivo: null, motivoDetalle: '', resolucion: null };

// Lista fija de motivos de "No se entrega" (mismos valores que el backend).
const MOTIVOS_NO_ENTREGADO: { valor: MotivoNoEntregado; texto: string }[] = [
  { valor: 'facturado_de_mas', texto: 'Facturado de más' },
  { valor: 'producto_equivocado', texto: 'Producto equivocado' },
  { valor: 'otro', texto: 'Otro' },
];

// 'sin_existencia' ya no se ofrece, pero se conserva el texto para mostrar
// registros viejos que lo traen guardado.
const TEXTO_MOTIVO_NO_ENTREGADO: Record<string, string> = {
  ...Object.fromEntries(MOTIVOS_NO_ENTREGADO.map((m) => [m.valor, m.texto])),
  sin_existencia: 'Sin existencia',
};

interface NoEntregadoDraft {
  cantidad: string;
  motivo: MotivoNoEntregado | null;
  // Texto libre, solo cuando motivo === 'otro'.
  motivoDetalle: string;
}

const NO_ENTREGADO_DRAFT_VACIO: NoEntregadoDraft = { cantidad: '', motivo: null, motivoDetalle: '' };

// Si el motivo es 'otro' y el operador escribio por que, se muestra ese texto
// en vez de "Otro".
function textoMotivo(mapa: Record<string, string>, motivo: string, detalle?: string | null): string {
  if (motivo === 'otro' && detalle) return detalle;
  return mapa[motivo] ?? motivo;
}

const TEXTO_RESOLUCION_DEVOLUCION: Record<string, string> = {
  reposicion: 'repuesto',
  reembolso: 'reembolsado',
  no_lo_lleva: 'no lo lleva',
};

interface EventoHistorial {
  fecha: string;
  texto: string;
  // Distingue una devolucion de una entrega comun -- se usa para mostrar un
  // icono distinto en la fila, sin meter el icono adentro del texto.
  esDevolucion: boolean;
  // Idem para un "No se entrega".
  esNoEntregado: boolean;
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
          esDevolucion: false,
          esNoEntregado: false,
        });
      }
    } else if (log.evento === 'devolucion_registrada' && log.detalle?.item_id === itemId) {
      const resolucion = TEXTO_RESOLUCION_DEVOLUCION[log.detalle.resolucion] ?? log.detalle.resolucion;
      const motivo = textoMotivo(TEXTO_MOTIVO_DEVOLUCION, log.detalle.motivo, log.detalle.motivo_detalle);
      eventos.push({
        fecha: log.timestamp,
        texto: `Devolución de ${log.detalle.cantidad} (${motivo}) -- ${resolucion}`,
        esDevolucion: true,
        esNoEntregado: false,
      });
    } else if (log.evento === 'item_no_entregado' && log.detalle?.item_id === itemId) {
      const motivo = textoMotivo(TEXTO_MOTIVO_NO_ENTREGADO, log.detalle.motivo, log.detalle.motivo_detalle);
      eventos.push({
        fecha: log.timestamp,
        texto: `No se entrega ${log.detalle.cantidad} (${motivo})`,
        esDevolucion: false,
        esNoEntregado: true,
      });
    }
  }
  return eventos;
}

// Modal a pantalla completa para la firma del cliente -- reemplaza la
// tarjeta inline de altura fija que tenia antes (el WebView interno de
// react-native-signature-canvas no crece solo con el contenido, y un alto
// adivinado terminaba recortando su footer con Borrar/Guardar). El footer
// HTML de ese WebView se oculta por CSS (ver ESTILO_WEB_FIRMA) y se maneja
// todo con botones propios de React Native via el ref
// (readSignature/clearSignature) -- esos SI son confiables sin importar
// tamaño/densidad de pantalla. Unica pantalla que la usa -- movida completa
// aca (antes vivia junto a PantallaCaptura en App.tsx).
function VisorFirma({
  onGuardar,
  onCancelar,
}: {
  onGuardar: (firma: string) => void;
  onCancelar: () => void;
}) {
  const firmaRef = useRef<SignatureViewRef | null>(null);
  const [vacia, setVacia] = useState(false);

  return (
    <Modal visible animationType="slide" onRequestClose={onCancelar} statusBarTranslucent>
      <SafeAreaView style={estilosFirma.fondo}>
        <View style={estilosFirma.header}>
          <Text style={estilosFirma.titulo}>Firma del cliente</Text>
          <Pressable onPress={onCancelar} hitSlop={14}>
            <Ionicons name="close" size={26} color={TEXTO_PRIMARIO} />
          </Pressable>
        </View>
        <Text style={estilosFirma.subtitulo}>
          Pedile al cliente que firme con el dedo para confirmar que recibió los productos.
        </Text>
        <View style={estilosFirma.canvas}>
          <Signature
            ref={firmaRef}
            onOK={onGuardar}
            onEmpty={() => setVacia(true)}
            backgroundColor="#ffffff"
            penColor={NEUTRAL_900}
            // Footer propio del WebView oculto -- Borrar/Guardar los
            // manejan los botones de RN de abajo via el ref, no depende
            // de que el footer HTML calce en el alto disponible (eso es
            // justo lo que fallaba antes).
            webStyle={ESTILO_WEB_FIRMA}
          />
        </View>
        {vacia ? <Text style={estilosFirma.error}>Pedile al cliente que firme antes de continuar</Text> : null}
        <View style={estilosFirma.acciones}>
          <Pressable
            style={({ pressed }) => [estilosFirma.boton, pressed && styles.botonPresionado]}
            onPress={() => {
              setVacia(false);
              firmaRef.current?.clearSignature();
            }}
          >
            <ContenidoBoton icono="refresh-outline" texto="Borrar" color={NEUTRAL_400} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [estilosFirma.boton, estilosFirma.botonPrimario, pressed && styles.botonPresionado]}
            onPress={() => {
              setVacia(false);
              firmaRef.current?.readSignature();
            }}
          >
            <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="checkmark-circle-outline" texto="Guardar firma" />
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// Boton-chip para las acciones secundarias de cada item (historial,
// devolucion, nota) -- mismo onPress/condicion que antes, solo un area de
// toque mas grande y clara que un Ionicons suelto.
function BotonAccionItem({
  icono,
  activo,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  activo: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        estilosItem.botonAccion,
        activo && estilosItem.botonAccionActivo,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icono} size={18} color={activo ? ACENTO : NEUTRAL_400} />
    </Pressable>
  );
}

type Props = NativeStackScreenProps<DespachosStackParamList, 'Confirmando'>;

export default function PantallaConfirmando({ navigation }: Props) {
  const {
    empleado,
    sede,
    entregaId,
    situacion,
    estadoFinal,
    documentoIdentificado,
    items,
    setItems,
    esFaia,
    notaGeneral,
    setNotaGeneral,
    notaGeneralOriginal,
    evidenciaActual,
    firmaUrlConsultada,
    cargando,
    setCargando,
    setFotoAmpliada,
    necesitaTrasladoConfirmar,
    setNecesitaTrasladoConfirmar,
    cancelarConfirmacion,
    flujo,
  } = useEntrega();
  // Solo Remisiones: boton "Se entregó todo" y check "Entregado en otra bodega"
  // (en lugar del de punto de venta). Despachos queda como siempre.
  const esRemision = flujo === 'remision';

  const [firmaBase64, setFirmaBase64] = useState<string | null>(null);
  const [mostrandoFirma, setMostrandoFirma] = useState(false);
  // Paso previo a la firma -- pide nombre/telefono de quien retira esta
  // visita puntual (ver RetiradoPor en el backend). Se abre en vez de
  // VisorFirma directamente; al continuar, recien ahi se abre la firma.
  const [mostrandoDatosRetira, setMostrandoDatosRetira] = useState(false);
  const [retiradoNombre, setRetiradoNombre] = useState('');
  const [retiradoTelefono, setRetiradoTelefono] = useState('');
  // Ids de items con el editor de nota abierto (ver alternarNota).
  const [notasAbiertas, setNotasAbiertas] = useState<Set<string>>(new Set());
  // Modal del editor de la nota GENERAL (a nivel documento, no por item) --
  // separado de notasAbiertas a proposito, es un campo distinto. Antes era
  // un TextInput inline que solo el icono abria; ahora toda la tarjeta abre
  // este modal.
  const [notaGeneralAbierta, setNotaGeneralAbierta] = useState(false);
  // Ids de items con el editor del nombre del producto abierto -- la IA a
  // veces no lee bien el nombre (letra chica, foto poco clara), asi que se
  // puede corregir a mano antes de confirmar (ver alternarDescripcion).
  const [descripcionesAbiertas, setDescripcionesAbiertas] = useState<Set<string>>(new Set());
  // Ids de items con el editor de "Cantidad leida" abierto -- solo aplica a
  // 'nueva' (ver alternarCantidadLeida): la IA tambien se puede equivocar
  // leyendo el total del documento, no solo el nombre.
  const [cantidadesLeidasAbiertas, setCantidadesLeidasAbiertas] = useState<Set<string>>(new Set());
  // Ids de items con el formulario de devolucion abierto, y su borrador
  // (cantidad/motivo/resolucion) mientras se completa -- se descarta al
  // cerrar o al registrar con exito (ver alternarDevolucion).
  const [devolucionesAbiertas, setDevolucionesAbiertas] = useState<Set<string>>(new Set());
  const [devolucionDrafts, setDevolucionDrafts] = useState<Record<string, DevolucionDraft>>({});
  // Idem para el formulario "No se entrega".
  const [noEntregadosAbiertos, setNoEntregadosAbiertos] = useState<Set<string>>(new Set());
  const [noEntregadoDrafts, setNoEntregadoDrafts] = useState<Record<string, NoEntregadoDraft>>({});
  // Historial de logs de la entrega actual -- se pide una sola vez (todos
  // los productos comparten el mismo fetch) al abrir el primer historial.
  const [historial, setHistorial] = useState<LogEntry[] | null>(null);
  const [historialesAbiertos, setHistorialesAbiertos] = useState<Set<string>>(new Set());
  // Modal "Ver Datos de Entrega" -- nombre/telefono de quien retiro esta
  // factura en cada visita firmada (ver RetiradoPor). Reusa el mismo
  // `historial` de logs que ya comparten los "Ver historial" por producto,
  // no dispara un fetch aparte.
  const [mostrandoDatosEntrega, setMostrandoDatosEntrega] = useState(false);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [mensaje, setMensaje] = useState('');
  // "Entregado en el punto de venta" (por producto): ids de los items marcados.
  // Quedan como "todo entregado" y se mandan como desde_punto_venta, para que
  // el backend no los acredite como entrega de bodega. valoresPrevios guarda
  // lo que habia tipeado para restaurarlo al desmarcar.
  const [puntoVentaIds, setPuntoVentaIds] = useState<Set<string>>(new Set());
  const [valoresPrevios, setValoresPrevios] = useState<Record<string, string>>({});
  // "Entregado en otra bodega" (solo Remisiones): misma mecanica que el punto
  // de venta (comparte valoresPrevios), pero se manda como desde_otra_bodega.
  const [otraBodegaIds, setOtraBodegaIds] = useState<Set<string>>(new Set());
  // necesitaTrasladoConfirmar vive en EntregaContext (no local) -- Buscar y
  // CapturaFoto tambien lo setean, ANTES de llegar aca, cuando el backend ya
  // avisa "requiere_traslado" al buscar/reescanear (ver
  // ResultadoEnvio.requiere_traslado en api.ts). El catch de confirmar() de
  // mas abajo lo sigue seteando tambien, para el caso en que el aviso
  // temprano no llegara a tiempo (ver extraerNecesitaTrasladoConfirmar en
  // errorMessages.ts) -- el gate real es el mismo en los dos casos.
  const [fotoTraslado, setFotoTraslado] = useState<string | null>(null);

  // Un stack navigator real activa, sin que se lo pida, el boton fisico
  // atras de Android y el swipe de iOS -- si no se intercepta, el usuario
  // podria saltarse la limpieza de cancelarConfirmacion() (best-effort
  // cancelarEntrega + reset) usando el gesto nativo en vez del chevron
  // propio del header. usePreventRemove cubre los dos casos (Android/iOS)
  // con un solo mecanismo -- es la API recomendada actual, en vez de la
  // combinacion manual gestureEnabled:false + BackHandler.
  //
  // Se ignora data.action a proposito: un pop simple dejaria a
  // cancelarConfirmacion() sin correr (el best-effort cancelarEntrega + el
  // reset() completo de reiniciar()) -- queremos exactamente el mismo
  // camino que el chevron del header, no un pop nativo por separado.
  // cancelarConfirmacion() termina en navigation.reset(...), que ya
  // reemplaza el stack completo -- redisparar el pop original despues de
  // eso operaria sobre un stack que ya no es el mismo.
  //
  // Ojo con esto (encontrado probando en el celular en serio, dos vueltas):
  // el reset() de reiniciar() TAMBIEN "remueve" esta pantalla -- con la
  // condicion fija en true, usePreventRemove intercepta su PROPIO reset.
  // Un guard con ref evita el loop infinito ("Maximum call stack size
  // exceeded"), pero no alcanza: el reset queda bloqueado en silencio (sin
  // error, pero sin navegar) porque la condicion nunca bajo a false antes
  // de que reset() se ejecutara.
  //
  // Fix real: separar "detectar el intento de salir" (el callback de
  // usePreventRemove, que solo cambia estado) de "hacer la limpieza y
  // salir" (un efecto que reacciona a ese estado). Cuando el callback pone
  // saliendo=true, React re-renderiza con la condicion ya en false (baja el
  // guard) ANTES de que el efecto -- que corre despues del commit -- recien
  // ahi llame a cancelarConfirmacion()/reset(). Sin esta separacion no hay
  // garantia de que la condicion baje a tiempo (mas todavia si
  // cancelarConfirmacion no tiene ningun await antes del reset, como pasa
  // cuando situacion !== 'nueva' -- ese es justo el caso que fallaba).
  const [saliendo, setSaliendo] = useState(false);
  // cancelarConfirmacion (de useEntrega()) no esta memoizada -- cambia de
  // referencia en cada render del Provider, asi que el efecto de abajo
  // puede volver a correr sin que "saliendo" haya cambiado. Este ref
  // asegura que la llamada real (la que importa, no solo el efecto) se
  // dispare una sola vez.
  const cancelacionDisparadaRef = useRef(false);
  usePreventRemove(!saliendo, () => {
    if (saliendo) return;
    setSaliendo(true);
  });
  useEffect(() => {
    if (saliendo && !cancelacionDisparadaRef.current) {
      cancelacionDisparadaRef.current = true;
      cancelarConfirmacion();
    }
  }, [saliendo, cancelarConfirmacion]);

  const actualizarValorItem = (id: string, valor: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, valor } : item)));
  };

  const actualizarNotaItem = (id: string, nota: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, nota } : item)));
  };

  const actualizarDescripcionItem = (id: string, descripcion: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, descripcion } : item)));
  };

  const actualizarCantidadLeidaItem = (id: string, textoCrudo: string) => {
    const limpio = textoCrudo.replace(/[^0-9]/g, '');
    const cantidad_entregada = limpio === '' ? 0 : Number(limpio);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, cantidad_entregada } : item)));
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

  // Mismo patron que alternarNota -- separado del texto en si.
  const alternarDescripcion = (id: string) => {
    setDescripcionesAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  };

  const alternarCantidadLeida = (id: string) => {
    setCantidadesLeidasAbiertas((prev) => {
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

  const alternarNoEntregado = (id: string) => {
    setNoEntregadosAbiertos((prev) => {
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

  // Mismo fetch lazy que alternarHistorial (comparten `historial`) -- si ya
  // esta pedido para el detalle por producto, "Ver Datos de Entrega" no
  // vuelve a pedirlo.
  const abrirDatosEntrega = async () => {
    setMostrandoDatosEntrega(true);
    if (historial !== null || !entregaId) return;
    setCargandoHistorial(true);
    try {
      setHistorial(await fetchHistorialEntrega(entregaId));
    } catch {
      setHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  };

  // A nivel documento (no por item) -- todas las visitas que se firmaron,
  // sin importar que producto confirmaron (ver RetiradoPor en el backend).
  const retirosEntrega =
    historial
      ?.filter((log) => log.evento === 'entrega_actualizada' && log.detalle?.retirado_por)
      .map((log) => ({
        nombre: log.detalle.retirado_por.nombre as string,
        telefono: log.detalle.retirado_por.telefono as string | undefined,
        fecha: log.timestamp as string,
        // Quien de bodega hizo ESA visita puntual (no confundir con
        // nombre/telefono de arriba, que es el cliente que retiro) -- cae al
        // id crudo si actor_nombre vino null (ver LogEntry en api.ts).
        empleado: log.actor_nombre ?? log.actor_id,
      })) ?? [];

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
    if (!entregaId || !empleado) return;
    const draft = devolucionDrafts[item.id];
    const cantidad = Number((draft?.cantidad ?? '').trim());
    if (!draft?.motivo || !draft?.resolucion || !/^\d+$/.test(draft.cantidad.trim())) return;
    if (draft.motivo === 'otro' && draft.motivoDetalle.trim() === '') return;
    if (cantidad <= 0 || cantidad > item.cantidad_entregada) return;

    setCargando(true);
    setMensaje('Registrando devolución...');
    try {
      const { item: itemActualizado } = await registrarDevolucion(entregaId, {
        item_id: item.id,
        cantidad,
        motivo: draft.motivo,
        ...(draft.motivo === 'otro' ? { motivo_detalle: draft.motivoDetalle.trim() } : {}),
        resolucion: draft.resolucion,
        operador_id: empleado.id,
        sede_id: sede?.id ?? '',
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
      setMensaje(mensajeError(err, 'devolucion'));
    } finally {
      setCargando(false);
    }
  };

  const actualizarDraftNoEntregado = (id: string, cambios: Partial<NoEntregadoDraft>) => {
    setNoEntregadoDrafts((prev) => ({
      ...prev,
      [id]: { ...NO_ENTREGADO_DRAFT_VACIO, ...prev[id], ...cambios },
    }));
  };

  // "No se entrega": unidades facturadas de mas o equivocadas que se cierran
  // sin entregarse -- accion propia e inmediata, igual que la devolucion.
  const registrarNoEntregadoItem = async (item: ItemFormulario) => {
    if (!entregaId || !empleado) return;
    const draft = noEntregadoDrafts[item.id];
    const cantidad = Number((draft?.cantidad ?? '').trim());
    if (!draft?.motivo || !/^\d+$/.test(draft.cantidad.trim())) return;
    if (draft.motivo === 'otro' && draft.motivoDetalle.trim() === '') return;
    if (cantidad <= 0 || cantidad > item.cantidad_pendiente) return;

    setCargando(true);
    setMensaje('Registrando producto no entregado...');
    try {
      const { item: itemActualizado } = await registrarNoEntregado(entregaId, {
        item_id: item.id,
        cantidad,
        motivo: draft.motivo,
        ...(draft.motivo === 'otro' ? { motivo_detalle: draft.motivoDetalle.trim() } : {}),
        operador_id: empleado.id,
        sede_id: sede?.id ?? '',
      });
      // El valor tipeado (entregado hoy) puede haber quedado invalido contra
      // el nuevo pendiente -- se limpia para que lo carguen de nuevo.
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, ...itemActualizado, valor: '', nota: itemActualizado.nota ?? '' } : it
        )
      );
      setNoEntregadoDrafts((prev) => {
        const { [item.id]: _descartado, ...resto } = prev;
        return resto;
      });
      alternarNoEntregado(item.id);
      setHistorial(null); // se acaba de sumar un evento nuevo -- refresca al reabrir
      setMensaje('Producto marcado como no entregado.');
    } catch (err: any) {
      setMensaje(mensajeError(err, 'no_entregado'));
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

  // Check "Entregado en el punto de venta" de un item: al marcarlo se guarda
  // lo tipeado y el item queda en su valor de "todo entregado"; al desmarcarlo
  // se restaura (o queda vacio, como alternarTodoEntregado).
  const alternarPuntoVenta = (item: ItemFormulario) => {
    if (!situacion) return;
    if (!puntoVentaIds.has(item.id)) {
      setValoresPrevios((prev) => ({ ...prev, [item.id]: item.valor }));
      setPuntoVentaIds((prev) => new Set(prev).add(item.id));
      actualizarValorItem(item.id, String(valorTodoEntregado(item, situacion)));
    } else {
      setPuntoVentaIds((prev) => {
        const siguiente = new Set(prev);
        siguiente.delete(item.id);
        return siguiente;
      });
      actualizarValorItem(item.id, valoresPrevios[item.id] ?? '');
    }
  };

  // Check "Entregado en otra bodega" (solo Remisiones): igual que
  // alternarPuntoVenta pero con su propio set.
  const alternarOtraBodega = (item: ItemFormulario) => {
    if (!situacion) return;
    if (!otraBodegaIds.has(item.id)) {
      setValoresPrevios((prev) => ({ ...prev, [item.id]: item.valor }));
      setOtraBodegaIds((prev) => new Set(prev).add(item.id));
      actualizarValorItem(item.id, String(valorTodoEntregado(item, situacion)));
    } else {
      setOtraBodegaIds((prev) => {
        const siguiente = new Set(prev);
        siguiente.delete(item.id);
        return siguiente;
      });
      actualizarValorItem(item.id, valoresPrevios[item.id] ?? '');
    }
  };

  // Boton "Se entregó todo" (solo Remisiones): deja todos los items no
  // bloqueados en su valor de "todo entregado" y limpia las marcas de punto de
  // venta / otra bodega (cuentan como entregados por esta bodega). No guarda:
  // el bodeguero revisa y confirma con el boton de siempre.
  const marcarTodoEntregado = () => {
    if (!situacion) return;
    const sit = situacion;
    const ids = new Set(items.filter((item) => !esBloqueado(item, sit)).map((item) => item.id));
    setItems((prev) =>
      prev.map((item) => (ids.has(item.id) ? { ...item, valor: String(valorTodoEntregado(item, sit)) } : item)),
    );
    setPuntoVentaIds((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    setOtraBodegaIds((prev) => new Set([...prev].filter((id) => !ids.has(id))));
  };

  const confirmarSeEntregoTodo = () => {
    Alert.alert('¿Se entregó todo?', 'Revisa los nombres de los productos y las cantidades antes de confirmar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, marcar todo', onPress: marcarTodoEntregado },
    ]);
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
  // cualquier item bloqueado al que se le haya agregado una nota o
  // corregido el nombre (eso tambien es un cambio real, aunque no toque
  // cantidades).
  const itemsAEnviar =
    situacion === 'actualizable'
      ? items.filter(
          (item) =>
            !esBloqueado(item, situacion) ||
            item.nota.trim() !== '' ||
            item.descripcion.trim() !== item.descripcionOriginal.trim()
        )
      : items;
  const cantidadesValidas =
    situacion !== null && itemsConCambioCantidad.every((item) => valorValido(item, situacion));
  // Si el backend ya pidio traslado (ver el catch de confirmar()), no se
  // puede reintentar hasta adjuntar la foto -- si no, el segundo intento
  // volveria a fallar con el mismo error.
  const puedeConfirmar =
    itemsAEnviar.length > 0 && cantidadesValidas && !cargando && (!necesitaTrasladoConfirmar || !!fotoTraslado);
  // Cubre tambien BORRAR una nota ya escrita (notaGeneral.trim() !== '' solo
  // no lo detectaria) -- ver notaGeneralOriginal en EntregaContext.
  const notaGeneralCambio = notaGeneral.trim() !== notaGeneralOriginal.trim();
  // Puramente sobre cantidades -- no se ve afectado por si se esta cargando
  // una nota, asi el aviso de "nada pendiente" sigue siendo cierto aunque
  // itemsAEnviar (lo que hay que mandar) ya no este vacio por una nota nueva.
  const documentoCompleto = situacion === 'actualizable' && items.length > 0 && itemsConCambioCantidad.length === 0;

  // Foto de traslado -- solo aparece cuando confirmar() ya intento una vez y
  // el backend respondio "necesita_traslado" (ver el catch mas abajo). Mismo
  // patron que tomarFotoTraslado/elegirTrasladoDeGaleria en
  // PantallaCapturaFoto.tsx, reusando comprimirParaEnvio (EntregaContext.tsx).
  const usarFotoTraslado = async (resultado: ImagePicker.ImagePickerResult) => {
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
    const resultado = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false, exif: false });
    await usarFotoTraslado(resultado);
  };

  const elegirTrasladoDeGaleria = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a las fotos para elegir el traslado.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({ quality: 1, allowsEditing: false, exif: false });
    await usarFotoTraslado(resultado);
  };

  const rotarFotoTraslado = async () => {
    if (!fotoTraslado) return;
    const resultado = await manipulateAsync(fotoTraslado, [{ rotate: 90 }], {
      compress: 0.9,
      format: SaveFormat.WEBP,
    });
    setFotoTraslado(resultado.uri);
  };

  // Paso 2: confirma lo que cargo el bodeguero por producto (ver
  // itemsAEnviar: para 'nueva' van todos, para 'actualizable' solo los que
  // de verdad traen un cambio). firmaFirmada llega directo desde el onOK de
  // <Signature> -- no alcanza con leer el estado firmaBase64 aca:
  // setFirmaBase64 y la llamada a confirmar() pasan en el mismo evento, y
  // confirmar todavia ve el closure viejo (null) hasta el proximo render.
  // Si no viene (camino "Guardar nota"), sigue sin firma.
  const confirmar = async (firmaFirmada?: string) => {
    if (!entregaId || !situacion || !empleado) return;
    setCargando(true);
    setMensaje('Guardando...');

    try {
      const payload = itemsAEnviar.map((item) => {
        const nota = item.nota.trim() || undefined;
        // Solo se manda si de verdad se corrigio el nombre -- la IA a veces
        // no lo lee bien y se puede editar a mano (ver actualizarDescripcionItem).
        const descripcion =
          item.descripcion.trim() !== item.descripcionOriginal.trim() ? item.descripcion.trim() : undefined;
        // Mismo criterio para la cantidad leida -- solo tiene sentido en
        // 'nueva' (ver actualizarCantidadLeidaItem); en 'actualizable' la
        // cantidad se maneja aparte, con el delta de entregado_hoy.
        // Si se corrigio la cantidad leida, el backend no puede derivar lo
        // entregado (partiria del total mal leido), asi que se manda explicito:
        // total corregido menos lo que queda pendiente.
        const cantidadEntregadaCorregida =
          situacion === 'nueva' && item.cantidad_entregada !== item.cantidadEntregadaOriginal
            ? Math.max(0, item.cantidad_entregada - Number(item.valor.trim()))
            : undefined;
        // Un item bloqueado (ver esBloqueado) solo puede estar en
        // itemsAEnviar por tener una nota o descripcion nueva -- no hay
        // cantidad que mandar, y mandar entregado_hoy/cantidad_pendiente
        // igual no rompe nada, pero es mas claro mandar solo lo que de
        // verdad cambio.
        if (situacion === 'actualizable' && esBloqueado(item, situacion)) {
          return { id: item.id, nota, descripcion };
        }
        const desdePuntoVenta = puntoVentaIds.has(item.id) ? true : undefined;
        const desdeOtraBodega = otraBodegaIds.has(item.id) ? true : undefined;
        return situacion === 'nueva'
          ? {
              id: item.id,
              cantidad_pendiente: Number(item.valor.trim()),
              nota,
              descripcion,
              cantidad_entregada: cantidadEntregadaCorregida,
              desde_punto_venta: desdePuntoVenta,
              desde_otra_bodega: desdeOtraBodega,
            }
          : {
              id: item.id,
              entregado_hoy: Number(item.valor.trim()),
              nota,
              descripcion,
              desde_punto_venta: desdePuntoVenta,
              desde_otra_bodega: desdeOtraBodega,
            };
      });

      const firma = firmaFirmada ?? firmaBase64;
      let firmaUrl: string | undefined;
      // Solo tiene sentido si hubo firma -- alguien presente para firmar es
      // justo lo que representa retiradoNombre/retiradoTelefono (ver el
      // formulario previo a VisorFirma).
      let retiradoPor: { nombre: string; telefono: string } | undefined;
      if (firma) {
        setMensaje('Subiendo firma...');
        const subida = await subirFirma(entregaId, firma);
        firmaUrl = subida.url;
        if (retiradoNombre.trim() && retiradoTelefono.trim()) {
          retiradoPor = { nombre: retiradoNombre.trim(), telefono: retiradoTelefono.trim() };
        }
        setMensaje('Guardando...');
      }

      // Solo se sube si el bodeguero ya adjunto una (reintento tras
      // "necesita_traslado") -- en el primer intento fotoTraslado es null,
      // no se manda nada.
      let trasladoUrl: string | undefined;
      if (fotoTraslado) {
        setMensaje('Subiendo traslado...');
        const subida = await subirEvidencia(fotoTraslado);
        trasladoUrl = subida.url;
        setMensaje('Guardando...');
      }

      await confirmarItems(
        entregaId,
        payload,
        empleado.id,
        sede?.id ?? '',
        // Si se llego por 'buscar' no hay foto nueva -- el backend trata un
        // string vacio como "no actualizar evidencia" (ver aplicar_actualizacion_items).
        evidenciaActual?.url ?? '',
        evidenciaActual?.hash ?? '',
        firmaUrl,
        esFaia,
        notaGeneral,
        retiradoPor,
        trasladoUrl
      );
      const mensajeFinal =
        estadoFinal === 'procesada'
          ? 'Entrega registrada correctamente.'
          : 'Registrada, pero necesita revisión manual (baja confianza de la IA).';
      navigation.navigate('Resultado', { mensaje: mensajeFinal });
    } catch (err: any) {
      // El documento pertenece a otra sede y todavia no se adjunto un
      // traslado valido -- en vez del mensaje de error generico, se abre la
      // tarjeta "Traslado requerido" (mismo patron que PantallaCapturaFoto.tsx)
      // para que el bodeguero adjunte la foto y reintente sin perder lo que
      // ya cargo.
      const traslado = extraerNecesitaTrasladoConfirmar(err);
      if (traslado) {
        setNecesitaTrasladoConfirmar(traslado);
        setMensaje('');
      } else {
        setMensaje(mensajeError(err, 'entrega'));
      }
    } finally {
      setCargando(false);
    }
  };

  // Sin borde inferior: la barra de tabs ya suma ese inset (si no, queda
  // doble con los 3 botones de Android).
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <EvitarTeclado>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <HeaderEntrega />

          <View style={[styles.tarjeta, estilosDoc.tarjeta]}>
            <View style={estilosDoc.encabezado}>
              <View style={estilosDoc.iconoDocumento}>
                <Ionicons
                  name={situacion === 'nueva' ? 'document-outline' : 'refresh-outline'}
                  size={22}
                  color={ACENTO}
                />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={estilosDoc.badges}>
                  {documentoIdentificado ? (
                    <Text style={styles.badgeIdentificador}>
                      {formatearIdentificador(documentoIdentificado.tipo, documentoIdentificado.indicativo_numero)}
                    </Text>
                  ) : null}
                  {estadoFinal ? (
                    <View style={[estilosDoc.pill, { backgroundColor: ESTADO_INFO[estadoFinal].fondo }]}>
                      <Ionicons name={ESTADO_INFO[estadoFinal].icono} size={11} color={ESTADO_INFO[estadoFinal].color} />
                      <Text style={[estilosDoc.pillTexto, { color: ESTADO_INFO[estadoFinal].color }]}>
                        {ESTADO_INFO[estadoFinal].texto}
                      </Text>
                    </View>
                  ) : null}
                  {esFaia ? (
                    <View style={[estilosDoc.pill, { backgroundColor: 'rgba(245,197,66,0.14)' }]}>
                      <Text style={[estilosDoc.pillTexto, { color: ACENTO }]}>FAIA</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={estilosDoc.titulo}>
                  {situacion === 'nueva' ? 'Documento nuevo' : 'Ya estaba registrado'}
                </Text>
              </View>
            </View>
            <Text style={styles.previewSubtexto}>
              {situacion === 'nueva'
                ? 'Es la primera vez que se procesa -- carga cuánto quedó pendiente de cada producto.'
                : documentoCompleto
                  ? 'Ya se entregó todo lo de este documento.'
                  : 'Este documento ya existía y todavía le queda algo pendiente. Carga cuánto entregaste hoy de cada producto.'}
            </Text>
            {/* Nota a nivel documento completo -- distinta de la nota por
                producto (ver mas abajo, dentro de cada item). Toda la fila
                abre el modal del editor; el icono a la izquierda y el texto de
                vista previa a la derecha son la misma accion. */}
            <Pressable
              style={({ pressed }) => [estilosDoc.notaGeneralFila, pressed && { opacity: 0.85 }]}
              onPress={() => setNotaGeneralAbierta(true)}
            >
              <Ionicons
                name={notaGeneral.trim() ? 'document-text' : 'document-text-outline'}
                size={18}
                color={notaGeneral.trim() ? ACENTO : NEUTRAL_400}
              />
              <Text style={[styles.notaPreview, estilosDoc.notaGeneralTexto]} numberOfLines={2}>
                {notaGeneral.trim() ? notaGeneral : 'Sin nota general todavía -- toca para agregar una.'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={NEUTRAL_500} />
            </Pressable>
          </View>

          {esRemision && situacion !== null && !cargando && items.some((item) => !esBloqueado(item, situacion)) ? (
            <Pressable
              onPress={confirmarSeEntregoTodo}
              style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
            >
              <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="checkmark-done-outline" texto="Se entregó todo" />
            </Pressable>
          ) : null}

          {items.map((item) => {
            const bloqueado = situacion ? esBloqueado(item, situacion) : false;
            const tope = situacion ? topeValor(item, situacion) : 0;
            const valorTexto = item.valor.trim();
            const enPuntoVenta = !bloqueado && puntoVentaIds.has(item.id);
            const enOtraBodega = !bloqueado && otraBodegaIds.has(item.id);
            // Cualquiera de las dos marcas "no acreditadas" bloquea el input.
            const enNoAcreditado = enPuntoVenta || enOtraBodega;
            const marcadoTodoEntregado =
              !bloqueado && !enNoAcreditado && situacion !== null && valorTexto === String(valorTodoEntregado(item, situacion));
            // Se avisa en el momento, sin esperar el error del servidor --
            // el backend igual lo vuelve a validar (ver PATCH /items).
            const excedeTope =
              !bloqueado && situacion !== null && /^\d+$/.test(valorTexto) && Number(valorTexto) > tope;
            const notaAbierta = notasAbiertas.has(item.id);
            // Editable siempre -- tambien en 'actualizable' (documento ya
            // existente, re-escaneo o "Buscar"): el nombre leido por la IA
            // la primera vez puede haber quedado mal y recien notarse en
            // una entrega posterior. El backend ya soporta esta correccion
            // sin importar la situacion (PATCH /entregas/{id}/items).
            const puedeEditarDescripcion = true;
            const descripcionAbierta = puedeEditarDescripcion && descripcionesAbiertas.has(item.id);
            const descripcionEditada = item.descripcion.trim() !== item.descripcionOriginal.trim();
            const cantidadLeidaAbierta = cantidadesLeidasAbiertas.has(item.id);
            const cantidadLeidaEditada = item.cantidad_entregada !== item.cantidadEntregadaOriginal;
            // Una devolucion es sobre algo ya entregado antes -- no tiene
            // sentido en un documento recien escaneado sin confirmar
            // (situacion 'nueva'), ni si todavia no se entrego nada.
            // item.confirmado cubre el caso donde "Consultar factura"
            // trae un documento que la IA leyo pero que nadie confirmo
            // todavia: ahi situacion siempre llega como 'actualizable'
            // (ver GET /entregas/buscar) y cantidad_entregada ya es el
            // valor que leyo la IA, no lo que se entrego de verdad.
            const puedeDevolver = situacion === 'actualizable' && item.cantidad_entregada > 0 && item.confirmado;
            const devolucionAbierta = devolucionesAbiertas.has(item.id);
            const draft = devolucionDrafts[item.id] ?? DEVOLUCION_DRAFT_VACIO;
            const cantidadDevolucionValida =
              /^\d+$/.test(draft.cantidad.trim()) &&
              Number(draft.cantidad.trim()) > 0 &&
              Number(draft.cantidad.trim()) <= item.cantidad_entregada;
            const puedeRegistrarDevolucion =
              cantidadDevolucionValida &&
              !!draft.motivo &&
              (draft.motivo !== 'otro' || draft.motivoDetalle.trim() !== '') &&
              !!draft.resolucion &&
              !cargando;
            // "No se entrega" cierra pendiente sin entregar: solo aplica sobre
            // un documento que ya existia y todavia tiene pendiente.
            const puedeNoEntregar = situacion === 'actualizable' && item.cantidad_pendiente > 0;
            const noEntregadoAbierto = noEntregadosAbiertos.has(item.id);
            const draftNoEntregado = noEntregadoDrafts[item.id] ?? NO_ENTREGADO_DRAFT_VACIO;
            const cantidadNoEntregada = item.cantidad_no_entregada ?? 0;
            const itemTachado =
              item.cantidad_pendiente === 0 && item.cantidad_entregada === 0 && cantidadNoEntregada > 0;
            const todoNoEntregado = draftNoEntregado.cantidad.trim() === String(item.cantidad_pendiente);
            const cantidadNoEntregadoValida =
              /^\d+$/.test(draftNoEntregado.cantidad.trim()) &&
              Number(draftNoEntregado.cantidad.trim()) > 0 &&
              Number(draftNoEntregado.cantidad.trim()) <= item.cantidad_pendiente;
            const puedeRegistrarNoEntregado =
              cantidadNoEntregadoValida &&
              !!draftNoEntregado.motivo &&
              (draftNoEntregado.motivo !== 'otro' || draftNoEntregado.motivoDetalle.trim() !== '') &&
              !cargando;
            // El historial de fechas solo tiene sentido para algo que ya
            // existia antes -- un documento recien escaneado sin confirmar
            // todavia no tiene nada que mostrar.
            const puedeVerHistorial = situacion === 'actualizable';
            const historialAbierto = historialesAbiertos.has(item.id);
            const eventosHistorial = historial ? historialDeItem(historial, item.id) : [];
            return (
              <View
                key={item.id}
                style={[
                  styles.tarjeta,
                  estilosItem.tarjeta,
                  marcadoTodoEntregado && estilosItem.tarjetaCompleta,
                  excedeTope && estilosItem.tarjetaError,
                ]}
              >
                <View style={styles.filaTitulo}>
                  {descripcionAbierta ? (
                    <TextInput
                      value={item.descripcion}
                      onChangeText={(texto) => actualizarDescripcionItem(item.id, texto)}
                      placeholder="Nombre del producto"
                      placeholderTextColor={NEUTRAL_500}
                      autoFocus
                      style={[styles.itemDescripcion, styles.inputDescripcion, { flex: 1 }]}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.itemDescripcion,
                        { flex: 1 },
                        itemTachado && { textDecorationLine: 'line-through' },
                      ]}
                    >
                      {item.descripcion || 'Producto sin descripción'}
                    </Text>
                  )}
                  {puedeEditarDescripcion ? (
                    <Pressable onPress={() => alternarDescripcion(item.id)} hitSlop={8}>
                      <Ionicons
                        name={descripcionEditada || descripcionAbierta ? 'pencil' : 'pencil-outline'}
                        size={20}
                        color={descripcionEditada || descripcionAbierta ? ACENTO : NEUTRAL_400}
                      />
                    </Pressable>
                  ) : null}
                </View>

                {/* Acciones secundarias del item, separadas del lapiz de
                    arriba (edita el nombre, esta fila no toca el nombre). */}
                <View style={styles.filaAccionesItem}>
                  {puedeVerHistorial ? (
                    <BotonAccionItem
                      icono={historialAbierto ? 'time' : 'time-outline'}
                      activo={historialAbierto}
                      onPress={() => alternarHistorial(item.id)}
                    />
                  ) : null}
                  {puedeDevolver ? (
                    <BotonAccionItem
                      icono="arrow-undo-outline"
                      activo={devolucionAbierta}
                      onPress={() => alternarDevolucion(item.id)}
                    />
                  ) : null}
                  {puedeNoEntregar ? (
                    <BotonAccionItem
                      icono="remove-circle-outline"
                      activo={noEntregadoAbierto}
                      onPress={() => alternarNoEntregado(item.id)}
                    />
                  ) : null}
                  <BotonAccionItem
                    icono={item.nota.trim() ? 'document-text' : 'document-text-outline'}
                    activo={!!item.nota.trim() || notaAbierta}
                    onPress={() => alternarNota(item.id)}
                  />
                </View>

                {historialAbierto ? (
                  <View style={styles.historialCaja}>
                    {cargandoHistorial ? (
                      <ActivityIndicator color="#f5c542" />
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
                          {evento.esDevolucion ? (
                            <Ionicons name="arrow-undo-outline" size={12} color={NEUTRAL_500} />
                          ) : null}
                          {evento.esNoEntregado ? (
                            <Ionicons name="remove-circle-outline" size={12} color={NEUTRAL_500} />
                          ) : null}
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
                    placeholderTextColor="#8193bb"
                    style={styles.inputNota}
                    multiline
                  />
                ) : item.nota.trim() ? (
                  <Pressable onPress={() => alternarNota(item.id)} style={styles.notaPreviewFila}>
                    <Ionicons name="document-text-outline" size={13} color={NEUTRAL_400} />
                    <Text style={styles.notaPreview}>{item.nota}</Text>
                  </Pressable>
                ) : null}

                {cantidadNoEntregada > 0 ? (
                  <Text style={styles.previewSubtexto}>No se entrega: {cantidadNoEntregada}</Text>
                ) : null}

                {noEntregadoAbierto ? (
                  <View style={styles.devolucionCaja}>
                    <Text style={styles.etiquetaSeccion}>No se entrega -- cantidad</Text>
                    <TextInput
                      value={draftNoEntregado.cantidad}
                      onChangeText={(texto) => actualizarDraftNoEntregado(item.id, { cantidad: texto })}
                      keyboardType="number-pad"
                      placeholder={`Máx. ${item.cantidad_pendiente}`}
                      placeholderTextColor="#8193bb"
                      style={styles.inputCantidad}
                    />
                    <View style={styles.chipsEnvoltorio}>
                      <Pressable
                        onPress={() =>
                          actualizarDraftNoEntregado(item.id, { cantidad: String(item.cantidad_pendiente) })
                        }
                        style={[styles.chipSede, styles.chipSedeFila, todoNoEntregado && styles.chipSedeActiva]}
                      >
                        <Ionicons
                          name="remove-circle-outline"
                          size={14}
                          color={todoNoEntregado ? '#fff' : NEUTRAL_400}
                        />
                        <Text style={[styles.chipSedeTexto, todoNoEntregado && styles.chipSedeTextoActivo]}>
                          Todo (tachar)
                        </Text>
                      </Pressable>
                    </View>

                    <Text style={styles.etiquetaSeccion}>Motivo</Text>
                    <View style={styles.chipsEnvoltorio}>
                      {MOTIVOS_NO_ENTREGADO.map((m) => {
                        const activo = draftNoEntregado.motivo === m.valor;
                        return (
                          <Pressable
                            key={m.valor}
                            onPress={() => actualizarDraftNoEntregado(item.id, { motivo: m.valor })}
                            style={[styles.chipSede, activo && styles.chipSedeActiva]}
                          >
                            <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>
                              {m.texto}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {draftNoEntregado.motivo === 'otro' ? (
                      <TextInput
                        value={draftNoEntregado.motivoDetalle}
                        onChangeText={(texto) => actualizarDraftNoEntregado(item.id, { motivoDetalle: texto })}
                        placeholder="Escribe el motivo"
                        placeholderTextColor="#8193bb"
                        style={styles.inputCantidad}
                      />
                    ) : null}
                    <Text style={styles.previewSubtexto}>
                      Esa cantidad queda cerrada sin entregarse -- deja de estar pendiente.
                    </Text>

                    <Pressable
                      disabled={!puedeRegistrarNoEntregado}
                      style={({ pressed }) => [
                        styles.boton,
                        styles.botonPrimario,
                        !puedeRegistrarNoEntregado && styles.botonDeshabilitado,
                        pressed && puedeRegistrarNoEntregado && styles.botonPresionado,
                      ]}
                      onPress={() => registrarNoEntregadoItem(item)}
                    >
                      <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="remove-circle-outline" texto="Registrar" />
                    </Pressable>
                  </View>
                ) : null}

                {devolucionAbierta ? (
                  <View style={styles.devolucionCaja}>
                    <Text style={styles.etiquetaSeccion}>Devolución -- cantidad</Text>
                    <TextInput
                      value={draft.cantidad}
                      onChangeText={(texto) => actualizarDraftDevolucion(item.id, { cantidad: texto })}
                      keyboardType="number-pad"
                      placeholder={`Máx. ${item.cantidad_entregada}`}
                      placeholderTextColor="#8193bb"
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

                    {draft.motivo === 'otro' ? (
                      <TextInput
                        value={draft.motivoDetalle}
                        onChangeText={(texto) => actualizarDraftDevolucion(item.id, { motivoDetalle: texto })}
                        placeholder="Escribe el motivo"
                        placeholderTextColor="#8193bb"
                        style={styles.inputCantidad}
                      />
                    ) : null}

                    <Text style={styles.etiquetaSeccion}>Resolución</Text>
                    <View style={styles.chipsEnvoltorio}>
                      {(
                        [
                          { valor: 'reposicion', texto: 'Repongo', icono: 'repeat-outline' },
                          { valor: 'reembolso', texto: 'Reembolso', icono: 'cash-outline' },
                          { valor: 'no_lo_lleva', texto: 'No lo lleva', icono: 'close-circle-outline' },
                        ] as const
                      ).map((r) => {
                        const activo = draft.resolucion === r.valor;
                        return (
                          <Pressable
                            key={r.valor}
                            onPress={() => actualizarDraftDevolucion(item.id, { resolucion: r.valor })}
                            style={[styles.chipSede, styles.chipSedeFila, activo && styles.chipSedeActiva]}
                          >
                            <Ionicons name={r.icono} size={14} color={activo ? '#fff' : NEUTRAL_400} />
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
                    ) : draft.resolucion === 'no_lo_lleva' ? (
                      <Text style={styles.previewSubtexto}>
                        El cliente no se lo lleva -- esa cantidad queda cerrada, no vuelve a pendiente.
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
                      <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="arrow-undo-outline" texto="Registrar devolución" />
                    </Pressable>
                  </View>
                ) : null}

                {situacion === 'nueva' ? (
                  <View style={styles.filaConIcono}>
                    {cantidadLeidaAbierta ? (
                      <>
                        <Text style={styles.previewSubtexto}>Cantidad leída:</Text>
                        <TextInput
                          value={String(item.cantidad_entregada)}
                          onChangeText={(texto) => actualizarCantidadLeidaItem(item.id, texto)}
                          keyboardType="number-pad"
                          autoFocus
                          style={[styles.inputCantidad, styles.inputCantidadLeida]}
                        />
                      </>
                    ) : (
                      <Text style={styles.previewSubtexto}>Cantidad leída: {item.cantidad_entregada}</Text>
                    )}
                    <Pressable onPress={() => alternarCantidadLeida(item.id)} hitSlop={8}>
                      <Ionicons
                        name={cantidadLeidaEditada || cantidadLeidaAbierta ? 'pencil' : 'pencil-outline'}
                        size={16}
                        color={cantidadLeidaEditada || cantidadLeidaAbierta ? ACENTO : NEUTRAL_400}
                      />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.previewSubtexto}>Pendiente actual: {item.cantidad_pendiente}</Text>
                )}

                {bloqueado || enNoAcreditado ? null : (
                  <Pressable
                    onPress={() => alternarTodoEntregado(item)}
                    hitSlop={8}
                    style={[styles.checkboxFila, estilosItem.checkboxFila, marcadoTodoEntregado && estilosItem.checkboxFilaMarcada]}
                  >
                    <View style={[styles.checkboxCaja, marcadoTodoEntregado && styles.checkboxCajaMarcada]}>
                      {marcadoTodoEntregado ? <Ionicons name="checkmark" size={16} color={TEXTO_SOBRE_ACENTO} /> : null}
                    </View>
                    <Text style={[styles.checkboxTexto, marcadoTodoEntregado && estilosItem.checkboxTextoMarcado]}>
                      {situacion === 'nueva'
                        ? 'Todo entregado (nada pendiente)'
                        : 'Entregué todo lo que quedaba pendiente'}
                    </Text>
                  </Pressable>
                )}

                {bloqueado ? null : esRemision ? (
                  <Pressable
                    onPress={() => alternarOtraBodega(item)}
                    hitSlop={8}
                    style={[styles.checkboxFila, estilosItem.checkboxFila, enOtraBodega && estilosItem.checkboxFilaMarcada]}
                  >
                    <View style={[styles.checkboxCaja, enOtraBodega && styles.checkboxCajaMarcada]}>
                      {enOtraBodega ? <Ionicons name="checkmark" size={16} color={TEXTO_SOBRE_ACENTO} /> : null}
                    </View>
                    <Text style={[styles.checkboxTexto, enOtraBodega && estilosItem.checkboxTextoMarcado]}>
                      Entregado en otra bodega
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => alternarPuntoVenta(item)}
                    hitSlop={8}
                    style={[styles.checkboxFila, estilosItem.checkboxFila, enPuntoVenta && estilosItem.checkboxFilaMarcada]}
                  >
                    <View style={[styles.checkboxCaja, enPuntoVenta && styles.checkboxCajaMarcada]}>
                      {enPuntoVenta ? <Ionicons name="checkmark" size={16} color={TEXTO_SOBRE_ACENTO} /> : null}
                    </View>
                    <Text style={[styles.checkboxTexto, enPuntoVenta && estilosItem.checkboxTextoMarcado]}>
                      Entregado en el punto de venta
                    </Text>
                  </Pressable>
                )}
                {enPuntoVenta ? (
                  <View style={styles.filaConIcono}>
                    <Ionicons name="information-circle-outline" size={13} color={NEUTRAL_500} />
                    <Text style={styles.previewSubtexto}>No se registra como entrega de bodega.</Text>
                  </View>
                ) : null}
                {enOtraBodega ? (
                  <View style={styles.filaConIcono}>
                    <Ionicons name="information-circle-outline" size={13} color={NEUTRAL_500} />
                    <Text style={styles.previewSubtexto}>No se registra como entrega de esta bodega.</Text>
                  </View>
                ) : null}

                <Text style={styles.etiquetaSeccion}>
                  {situacion === 'nueva' ? 'Cantidad pendiente' : 'Entregado hoy'}
                </Text>
                <TextInput
                  value={item.valor}
                  onChangeText={(valor) => actualizarValorItem(item.id, valor)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={NEUTRAL_500}
                  editable={!bloqueado && !marcadoTodoEntregado && !enNoAcreditado}
                  style={[
                    styles.inputCantidad,
                    estilosItem.inputCantidad,
                    (bloqueado || marcadoTodoEntregado || enNoAcreditado) && styles.inputCantidadBloqueado,
                    excedeTope && styles.inputCantidadError,
                  ]}
                />
                {bloqueado && situacion === 'actualizable' && (item.entregado_en_punto_venta || item.entregado_en_otra_bodega || item.entregado_por_nombre) ? (
                  <View style={styles.filaConIcono}>
                    <Ionicons
                      name={
                        item.entregado_en_otra_bodega
                          ? 'business-outline'
                          : item.entregado_en_punto_venta
                            ? 'storefront-outline'
                            : 'person-outline'
                      }
                      size={13}
                      color={NEUTRAL_500}
                    />
                    <Text style={styles.previewSubtexto}>
                      {item.entregado_en_otra_bodega
                        ? 'Entregado en otra bodega'
                        : item.entregado_en_punto_venta
                          ? 'Entregado en: Punto de venta'
                          : `Entregado por: ${item.entregado_por_nombre}`}
                    </Text>
                  </View>
                ) : null}
                {bloqueado ? (
                  <View style={styles.filaConIcono}>
                    <Ionicons name="lock-closed-outline" size={13} color={NEUTRAL_500} />
                    <Text style={styles.previewSubtexto}>Ya entregado — sin nada pendiente de este producto.</Text>
                  </View>
                ) : marcadoTodoEntregado ? (
                  // El input debajo sigue mostrando "cuanto entregaste hoy" (lo
                  // que realmente se manda al backend), no el pendiente final --
                  // sin esto no queda claro que tildar el check deja el
                  // pendiente en 0 al guardar (se ve el numero de hoy, que
                  // encima suele coincidir con el total si nunca se entrego
                  // nada de este producto).
                  <View style={styles.filaConIcono}>
                    <Ionicons name="checkmark-circle-outline" size={14} color="#34d399" />
                    <Text style={styles.previewSubtexto}>Vas a entregar los {tope} pendientes — quedará en 0.</Text>
                  </View>
                ) : excedeTope ? (
                  <View style={styles.filaConIcono}>
                    <Ionicons name="alert-circle-outline" size={14} color="#f87171" />
                    <Text style={styles.textoErrorInline}>
                      {situacion === 'nueva'
                        ? `No puede quedar pendiente más de ${tope} (lo que leyó la IA).`
                        : `No puedes entregar más de ${tope} — es lo único que queda pendiente.`}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}

          {items.length === 0 ? (
            <View style={[styles.tarjeta, styles.filaConIcono]}>
              <Ionicons name="alert-circle-outline" size={18} color={NEUTRAL_400} />
              <Text style={[styles.previewSubtexto, { flex: 1 }]}>
                La IA no encontró productos en la foto — repite la captura con mejor luz/encuadre.
              </Text>
            </View>
          ) : null}

          {documentoCompleto ? (
            <View style={[styles.badgeEstado, { backgroundColor: 'rgba(52,211,153,0.12)' }]}>
              <Ionicons name="checkmark-circle" size={22} color="#34d399" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.badgeEstadoTitulo, { color: '#34d399' }]}>Documento completo</Text>
                <Text style={styles.badgeEstadoMensaje}>
                  No queda nada pendiente de entregar en este documento.
                </Text>
              </View>
            </View>
          ) : null}

          {necesitaTrasladoConfirmar ? (
            <View style={[styles.tarjeta, estilosDoc.tarjetaTraslado]}>
              <View style={styles.filaConIcono}>
                <Ionicons name="swap-horizontal" size={18} color="#fbbf24" />
                <Text style={[styles.etiquetaSeccion, { color: '#fbbf24' }]}>Traslado requerido</Text>
              </View>
              <Text style={styles.previewSubtexto}>
                {`El documento "${
                  formatearIdentificador(
                    necesitaTrasladoConfirmar.tipo,
                    necesitaTrasladoConfirmar.indicativo_numero
                  ) ?? necesitaTrasladoConfirmar.tipo
                }" pertenece a otra sede -- para confirmarlo desde acá, adjunta una foto del traslado.`}
              </Text>
              {fotoTraslado ? (
                <>
                  <Pressable onPress={() => setFotoAmpliada(fotoTraslado)}>
                    <Image source={{ uri: fotoTraslado }} style={styles.preview} resizeMode="cover" />
                    <View style={styles.iconoAmpliar}>
                      <Ionicons name="expand-outline" size={16} color={TEXTO_PRIMARIO} />
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.boton, { marginTop: 10 }, pressed && styles.botonPresionado]}
                    onPress={rotarFotoTraslado}
                  >
                    <ContenidoBoton icono="reload-outline" texto="Rotar 90°" color={NEUTRAL_400} />
                  </Pressable>
                </>
              ) : (
                <View style={[styles.preview, styles.previewVacio]}>
                  <Ionicons name="document-attach-outline" size={36} color={NEUTRAL_400} />
                  <Text style={styles.previewTexto}>Sin foto de traslado</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
                  onPress={tomarFotoTraslado}
                >
                  <ContenidoBoton
                    icono={fotoTraslado ? 'camera-reverse-outline' : 'camera-outline'}
                    texto={fotoTraslado ? 'Repetir foto' : 'Tomar foto'}
                  />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
                  onPress={elegirTrasladoDeGaleria}
                >
                  <ContenidoBoton icono="images-outline" texto="Galería" />
                </Pressable>
              </View>
            </View>
          ) : null}

          {mensaje ? (
            <View style={estilosDoc.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color="#f87171" />
              <Text style={[styles.textoErrorInline, { flex: 1 }]}>{mensaje}</Text>
            </View>
          ) : null}

          {cargando && itemsConCambioCantidad.length > 0 ? (
            <View style={[styles.tarjeta, styles.estadoBox]}>
              <ActivityIndicator color={ACENTO} />
              <Text style={styles.mensajeSubiendo}>{mensaje}</Text>
            </View>
          ) : null}

          <View style={styles.acciones}>
            {itemsAEnviar.length === 0 && !notaGeneralCambio ? null : itemsConCambioCantidad.length === 0 ? (
              <Pressable
                disabled={cargando}
                style={({ pressed }) => [
                  styles.boton,
                  styles.botonPrimario,
                  estilosDoc.botonPrincipal,
                  pressed && styles.botonPresionado,
                ]}
                onPress={() => confirmar()}
              >
                <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="document-text-outline" texto={cargando ? 'Guardando...' : 'Guardar nota'} />
              </Pressable>
            ) : (
              // Firma obligatoria siempre que se toquen cantidades -- parcial o
              // completa, sin una opcion aparte de confirmar sin firmar (antes
              // la entrega parcial ofrecia "Confirmar cantidades" sin firma mas
              // un boton "Firmar" separado).
              <Pressable
                disabled={!puedeConfirmar}
                style={({ pressed }) => [
                  styles.boton,
                  styles.botonPrimario,
                  estilosDoc.botonPrincipal,
                  !puedeConfirmar && styles.botonDeshabilitado,
                  pressed && puedeConfirmar && styles.botonPresionado,
                ]}
                onPress={() => setMostrandoDatosRetira(true)}
              >
                <ContenidoBoton
                  color={TEXTO_SOBRE_ACENTO}
                  icono="create-outline"
                  texto={cargando ? 'Guardando...' : 'Firmar y confirmar entrega'}
                />
              </Pressable>
            )}
            <Pressable
              disabled={cargando}
              style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
              onPress={cancelarConfirmacion}
            >
              <ContenidoBoton
                icono="close-outline"
                texto={itemsAEnviar.length === 0 ? 'Volver' : 'Cancelar'}
                color={NEUTRAL_400}
              />
            </Pressable>
          </View>

          {/* Nombre/telefono de quien retiro esta factura, por cada visita
              firmada -- al final de la pantalla, a pedido explicito (antes
              iba pegado a la nota general, arriba del todo). Es una accion
              terciaria (de consulta, no de guardado) -- se ve mas chica y
              discreta que las de acciones arriba, sin dejar de ser un
              Pressable con el mismo hitSlop implicito de styles.boton. */}
          <Pressable
            style={({ pressed }) => [estilosDoc.botonTerciario, pressed && { opacity: 0.7 }]}
            onPress={abrirDatosEntrega}
          >
            <Ionicons name="people-outline" size={16} color={NEUTRAL_400} />
            <Text style={estilosDoc.botonTerciarioTexto}>Ver datos de entrega</Text>
          </Pressable>
        </ScrollView>
      </EvitarTeclado>
      {mostrandoDatosEntrega ? (
        <Modal
          visible
          animationType="fade"
          transparent
          statusBarTranslucent
          onRequestClose={() => setMostrandoDatosEntrega(false)}
        >
          <View style={estilosRetira.fondo}>
            {/* ScrollView y no View -- con la firma (300px fijos, ver
                styles.preview) mas varios retiros esto puede no entrar
                entero en pantallas chicas. */}
            <ScrollView
              style={estilosRetira.scrollDatosEntrega}
              contentContainerStyle={[styles.tarjeta, estilosRetira.tarjeta]}
            >
              <View style={styles.filaConIcono}>
                <Ionicons name="people-outline" size={15} color={NEUTRAL_400} />
                <Text style={styles.etiquetaSeccion}>Datos de entrega</Text>
              </View>
              {cargandoHistorial ? (
                <ActivityIndicator color={ACENTO} />
              ) : retirosEntrega.length === 0 ? (
                <Text style={styles.previewSubtexto}>Todavía no hay ningún retiro firmado en esta factura.</Text>
              ) : (
                retirosEntrega.map((retiro, i) => (
                  <View key={i} style={estilosRetira.filaRetiro}>
                    <Text style={styles.previewSubtexto}>
                      Entrega {i + 1}: {retiro.nombre}
                      {retiro.telefono ? ` y ${retiro.telefono}` : ''}
                    </Text>
                    <Text style={{ color: NEUTRAL_500, fontSize: 12 }}>
                      Bodeguero: {retiro.empleado}
                    </Text>
                    <Text style={{ color: NEUTRAL_500, fontSize: 12 }}>
                      {new Date(retiro.fecha).toLocaleDateString('es-CO', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                      })}
                    </Text>
                  </View>
                ))
              )}
              {/* Ultima firma del documento -- un solo archivo por entrega
                  (se pisa en cada firma nueva, ver subirFirma en api.ts).
                  Solo se ve aca, adentro del modal, debajo de nombre/
                  telefono -- ya no hay una vista suelta en la pantalla
                  principal. */}
              {firmaUrlConsultada ? (
                <Pressable
                  style={estilosRetira.bloqueFirma}
                  onPress={() => setFotoAmpliada(firmaUrlConsultada)}
                >
                  <Text style={styles.etiquetaSeccion}>Última firma</Text>
                  <Image
                    source={{ uri: firmaUrlConsultada }}
                    style={[styles.preview, { backgroundColor: '#ffffff' }]}
                    resizeMode="contain"
                  />
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
                onPress={() => setMostrandoDatosEntrega(false)}
              >
                <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="close-outline" texto="Cerrar" />
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      ) : null}
      {notaGeneralAbierta ? (
        <Modal
          visible
          animationType="fade"
          transparent
          statusBarTranslucent
          onRequestClose={() => setNotaGeneralAbierta(false)}
        >
          <View style={estilosRetira.fondo}>
            <View style={[styles.tarjeta, estilosRetira.tarjeta]}>
              <View style={styles.filaConIcono}>
                <Ionicons name="document-text-outline" size={15} color={NEUTRAL_400} />
                <Text style={styles.etiquetaSeccion}>Nota general de la factura</Text>
              </View>
              <TextInput
                value={notaGeneral}
                onChangeText={setNotaGeneral}
                placeholder="Información adicional de toda la factura (opcional)"
                placeholderTextColor={NEUTRAL_500}
                style={styles.inputNota}
                multiline
                autoFocus
              />
              <Pressable
                style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
                onPress={() => setNotaGeneralAbierta(false)}
              >
                <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="checkmark-circle-outline" texto="Listo" />
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
      {mostrandoDatosRetira ? (
        <Modal
          visible
          animationType="fade"
          transparent
          statusBarTranslucent
          onRequestClose={() => setMostrandoDatosRetira(false)}
        >
          <View style={estilosRetira.fondo}>
            <View style={[styles.tarjeta, estilosRetira.tarjeta]}>
              <Text style={styles.etiquetaSeccion}>¿Quién retira?</Text>
              <Text style={styles.previewSubtexto}>
                Opcional -- déjalo en blanco si no lo sabes, igual puedes firmar.
              </Text>
              <TextInput
                value={retiradoNombre}
                onChangeText={setRetiradoNombre}
                placeholder="Nombre"
                placeholderTextColor="#8193bb"
                style={styles.inputCantidad}
              />
              <TextInput
                value={retiradoTelefono}
                onChangeText={setRetiradoTelefono}
                placeholder="Teléfono"
                placeholderTextColor="#8193bb"
                keyboardType="phone-pad"
                style={styles.inputCantidad}
              />
              <View style={estilosRetira.acciones}>
                <Pressable
                  style={({ pressed }) => [
                    styles.boton,
                    estilosRetira.botonContinuar,
                    pressed && styles.botonPresionado,
                  ]}
                  onPress={() => setMostrandoDatosRetira(false)}
                >
                  <ContenidoBoton icono="close-outline" texto="Cancelar" color={NEUTRAL_400} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.boton,
                    styles.botonPrimario,
                    estilosRetira.botonContinuar,
                    pressed && styles.botonPresionado,
                  ]}
                  onPress={() => {
                    setMostrandoDatosRetira(false);
                    setMostrandoFirma(true);
                  }}
                >
                  <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="arrow-forward-outline" texto="Continuar" />
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {mostrandoFirma ? (
        <VisorFirma
          onCancelar={() => setMostrandoFirma(false)}
          onGuardar={(firma) => {
            setMostrandoFirma(false);
            setFirmaBase64(firma);
            // Se llama con la firma en si (no el estado, todavia no se
            // actualizo -- ver comentario en confirmar()).
            confirmar(firma);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const estilosRetira = StyleSheet.create({
  scrollDatosEntrega: { maxHeight: '85%', width: '100%', maxWidth: 420, alignSelf: 'center' },
  fondo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  tarjeta: { gap: 10, width: '100%', maxWidth: 420, alignSelf: 'center' },
  acciones: { flexDirection: 'row', gap: 10, marginTop: 4 },
  botonContinuar: { flex: 1 },
  filaRetiro: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2f3a',
  },
  bloqueFirma: { marginTop: 16, gap: 8 },
});

// Estilos de la tarjeta de encabezado del documento (identificador, estado,
// FAIA, nota general) y de los elementos sueltos del pie de pantalla.
const estilosDoc = StyleSheet.create({
  tarjeta: { gap: 10 },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconoDocumento: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(245,197,66,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pillTexto: { fontSize: 11, fontFamily: FUENTE_BODY_SEMI },
  titulo: { color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_DISPLAY },
  notaGeneralFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  notaGeneralTexto: { flex: 1 },
  tarjetaTraslado: { borderColor: 'rgba(251,191,36,0.45)' },
  botonPrincipal: { paddingVertical: 18 },
  botonTerciario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  botonTerciarioTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
});

// Estilos de cada tarjeta de producto -- caja de cantidad, botones de accion
// secundarios y el resaltado del check "todo entregado" / error de tope.
const estilosItem = StyleSheet.create({
  tarjeta: { borderWidth: 1.5 },
  tarjetaCompleta: { borderColor: 'rgba(52,211,153,0.35)' },
  tarjetaError: { borderColor: 'rgba(248,113,113,0.45)' },
  botonAccion: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEUTRAL_800,
  },
  botonAccionActivo: { backgroundColor: 'rgba(245,197,66,0.14)' },
  checkboxFila: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: NEUTRAL_800,
  },
  checkboxFilaMarcada: { backgroundColor: 'rgba(52,211,153,0.12)' },
  checkboxTextoMarcado: { color: '#34d399' },
  inputCantidad: { paddingVertical: 14 },
});
