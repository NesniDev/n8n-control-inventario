// Pantalla de entrada de la tab Traslados, post-login: dos caminos posibles
// (crear un traslado nuevo, o ir a la bandeja de lo que llega a este punto)
// y el historial del punto en dos pestañas -- Enviados (salieron de aca) y
// Recibidos (llegaron aca y ya se confirmaron). Debajo, filtros en chips por
// empresa del talonario y por estado, cada uno con su conteo; la lista va
// ordenada con lo que pide atencion primero. Tocar una tarjeta abre
// DetalleTraslado.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  fetchTalonariosPunto,
  fetchTrasladosPunto,
  etiquetaSyscafe, referenciaTraslado,
  type EstadoTraslado,
  type TalonarioPunto,
  type Traslado,
} from './api';
import { mensajeError } from './errorMessages';
import { EMPRESAS_TALONARIO, letraTraslado } from './ModalTalonario';
import { ESTADO_TRASLADO } from './PantallaTrasladoDetalle';
import { HeaderTraslado, useTraslado } from './TrasladoContext';
import { formatearFechaLarga, haceCuanto } from './SelectorFecha';
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
  NEUTRAL_850,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';
import type { TabsParamList, TrasladosStackParamList } from './Navegacion';

type NavegacionInicio = NativeStackNavigationProp<TrasladosStackParamList, 'InicioTraslados'>;

type Pestana = 'enviados' | 'recibidos';

// Orden de la lista: primero lo que pide atencion (novedad, en camino),
// despues lo recibido completo; dentro de cada grupo, lo mas nuevo arriba.
const PRIORIDAD: Record<EstadoTraslado, number> = { recibido_con_novedad: 0, en_transito: 1, recibido: 2 };

function ordenar(lista: Traslado[]): Traslado[] {
  return [...lista].sort(
    (a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado] || b.created_at.localeCompare(a.created_at)
  );
}

// Chip de filtro: pastilla con un indicador (letra, punto o icono), texto y
// conteo. 36 px visibles + hitSlop para llegar a 44 px de area tactil.
function ChipFiltro({
  activo,
  onPress,
  color,
  indicador,
  texto,
  n,
  etiquetaAccesible,
}: {
  activo: boolean;
  onPress: () => void;
  color: string;
  indicador: ReactNode;
  texto: string;
  n: number;
  etiquetaAccesible: string;
}) {
  const vacio = n === 0 && !activo;
  return (
    <Pressable
      onPress={onPress}
      disabled={vacio}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [
        estilos.chip,
        activo && { borderColor: color, backgroundColor: `${color}22` },
        vacio && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected: activo, disabled: vacio }}
      accessibilityLabel={`${etiquetaAccesible}, ${n} traslados`}
    >
      {indicador}
      <Text style={[estilos.chipTexto, activo && estilos.chipTextoActivo]} numberOfLines={1}>
        {texto}
      </Text>
      <Text style={[estilos.chipConteo, activo && { color }]}>{n}</Text>
    </Pressable>
  );
}

function TarjetaTraslado({
  traslado,
  direccion,
  onPress,
}: {
  traslado: Traslado;
  direccion: Pestana;
  onPress: () => void;
}) {
  const info = ESTADO_TRASLADO[traslado.estado];
  const productos = traslado.cantidad_items ?? 0;
  const enviado = direccion === 'enviados';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tarjeta, estilos.tarjeta, pressed && { opacity: 0.85 }]}
    >
      {/* Franja de color del estado -- se lee de un vistazo en la lista. */}
      <View style={[estilos.franja, { backgroundColor: info.color }]} />
      <View style={estilos.contenido}>
        <View style={estilos.filaSuperior}>
          <Text style={estilos.numero}>
            {referenciaTraslado(traslado)}
            <Text style={{ color: traslado.numero_syscafe ? ACENTO : NEUTRAL_500, fontFamily: FUENTE_BODY }}>
              {'  ·  '}
              {etiquetaSyscafe(traslado)}
            </Text>
          </Text>
          <View style={[estilos.pildora, { backgroundColor: info.fondo }]}>
            <Ionicons name={info.icono} size={13} color={info.color} />
            <Text style={[estilos.pildoraTexto, { color: info.color }]}>{info.texto}</Text>
          </View>
        </View>

        <View style={estilos.lugar}>
          <Ionicons
            name={enviado ? 'arrow-forward-circle' : 'arrow-back-circle'}
            size={20}
            color={ACENTO}
          />
          <Text style={estilos.lugarEtiqueta}>{enviado ? 'Para' : 'De'}</Text>
          <Text style={estilos.lugarTexto} numberOfLines={1}>
            {(enviado ? traslado.punto_destino_nombre : traslado.punto_origen_nombre) ?? '—'}
          </Text>
        </View>

        <View style={estilos.metadatos}>
          <View style={estilos.metadato}>
            <Ionicons name="calendar-outline" size={13} color={NEUTRAL_500} />
            <Text style={estilos.metadatoTexto}>{formatearFechaLarga(traslado.fecha)}</Text>
          </View>
          <View style={estilos.metadato}>
            <Ionicons name="cube-outline" size={13} color={NEUTRAL_500} />
            <Text style={estilos.metadatoTexto}>
              {productos} {productos === 1 ? 'producto' : 'productos'}
            </Text>
          </View>
          {traslado.transportador_nombre ? (
            <View style={[estilos.metadato, { flexShrink: 1 }]}>
              <Ionicons name="person-outline" size={13} color={NEUTRAL_500} />
              <Text style={estilos.metadatoTexto} numberOfLines={1}>
                {traslado.transportador_nombre}
              </Text>
            </View>
          ) : null}
          {traslado.numero_talonario && !traslado.talonario_id ? (
            <View style={[estilos.metadato, { flexShrink: 1 }]}>
              <Ionicons name="document-text-outline" size={13} color={NEUTRAL_500} />
              <Text style={estilos.metadatoTexto} numberOfLines={1}>
                Talonario {traslado.numero_talonario}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={estilos.filaInferior}>
          <Text style={estilos.cuando}>
            {traslado.recibido_at
              ? `Recibido ${haceCuanto(traslado.recibido_at)}`
              : `Enviado ${haceCuanto(traslado.created_at)}`}
          </Text>
          <View style={estilos.verDetalle}>
            <Text style={estilos.verDetalleTexto}>Ver detalle</Text>
            <Ionicons name="chevron-forward" size={14} color={NEUTRAL_400} />
          </View>
        </View>

        {traslado.novedad ? (
          <View style={estilos.novedad}>
            <Ionicons name="alert-circle-outline" size={14} color="#f87171" />
            <Text style={estilos.novedadTexto} numberOfLines={2}>
              {traslado.novedad}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function PantallaTrasladoInicio() {
  const navigation = useNavigation<NavegacionInicio>();
  const { punto } = useTraslado();

  // Solo para bloquear "Nuevo traslado"; la tarjeta para configurarlo vive en
  // la tab Inicio (ver TarjetaTalonario.tsx).
  // undefined = todavia no se sabe (cargando o fallo la consulta, en cuyo caso
  // no se bloquea nada: el backend valida igual al crear); [] = sin talonarios.
  const [talonarios, setTalonarios] = useState<TalonarioPunto[] | undefined>(undefined);

  const [enviados, setEnviados] = useState<Traslado[]>([]);
  const [recibidos, setRecibidos] = useState<Traslado[]>([]);
  const [porRecibir, setPorRecibir] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('enviados');
  // Letra de la empresa del talonario ("A", "V") para ver solo sus traslados;
  // '' = todas. Aplica a Enviados y a Recibidos.
  const [empresa, setEmpresa] = useState('');
  // Estado del traslado a mostrar; '' = todos.
  const [estado, setEstado] = useState<EstadoTraslado | ''>('');

  const yaCargado = useRef(false);
  const cargar = useCallback(async (forzar = false) => {
    if (!punto) return;
    // El indicador de carga solo la primera vez: despues la lista queda a la
    // vista mientras se actualiza (la cache de api.ts la devuelve al instante).
    if (!yaCargado.current) setCargando(true);
    setError(null);
    try {
      const [listaEnviados, listaLlegadas, talonariosActuales] = await Promise.all([
        fetchTrasladosPunto({ origenId: punto.id }, { forzar }),
        fetchTrasladosPunto({ destinoId: punto.id }, { forzar }),
        // El talonario cambia con cada traslado creado: siempre fresco al volver aqui.
        fetchTalonariosPunto(punto.id, { forzar: true }).catch(() => undefined),
      ]);
      if (talonariosActuales !== undefined) setTalonarios(talonariosActuales);
      setEnviados(listaEnviados);
      // Lo que llega a este punto se parte en dos: lo que todavia esta en
      // camino va a "Por recibir"; lo ya confirmado, a la pestaña Recibidos.
      setRecibidos(listaLlegadas.filter((t) => t.estado !== 'en_transito'));
      setPorRecibir(listaLlegadas.filter((t) => t.estado === 'en_transito').length);
      yaCargado.current = true;
    } catch (err) {
      setError(mensajeError(err, 'traslado'));
    } finally {
      setCargando(false);
    }
  }, [punto]);

  // Refresca cada vez que se vuelve a esta pantalla -- tanto el contador de
  // "por recibir" como las listas pueden haber cambiado (otro punto recibio
  // algo, o se acaba de crear o recibir un traslado).
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  // Deslizar para refrescar: consulta nueva al servidor, sin usar lo guardado.
  const refrescar = async () => {
    setRefrescando(true);
    await cargar(true);
    setRefrescando(false);
  };

  // Sin talonario (o todos agotados) no se puede crear un traslado: se manda a
  // configurarlo en la tab Inicio. Basta con que uno tenga hojas disponibles.
  const sinConfigurar = talonarios !== undefined && talonarios.length === 0;
  const sinTalonario = sinConfigurar || (talonarios !== undefined && talonarios.every((t) => t.agotado));
  const nuevoTraslado = () => {
    if (sinTalonario) {
      Alert.alert(
        sinConfigurar ? 'Configura tu talonario' : 'Talonario agotado',
        sinConfigurar
          ? 'Antes de crear un traslado debes configurar tu talonario en la pestaña Inicio.'
          : 'Pide un talonario nuevo y configúralo en la pestaña Inicio para seguir creando traslados.',
        [
          { text: 'Ahora no', style: 'cancel' },
          {
            text: 'Ir a Inicio',
            onPress: () => navigation.getParent<BottomTabNavigationProp<TabsParamList>>()?.navigate('Inicio'),
          },
        ]
      );
      return;
    }
    navigation.navigate('NuevoTraslado');
  };

  const deEmpresa = (t: Traslado) => !empresa || letraTraslado(t) === empresa;
  const deEstado = (t: Traslado) => !estado || t.estado === estado;
  const visible = (t: Traslado) => deEmpresa(t) && deEstado(t);
  const enviadosVisibles = enviados.filter(visible);
  const recibidosVisibles = recibidos.filter(visible);
  const lista = ordenar(pestana === 'enviados' ? enviadosVisibles : recibidosVisibles);
  // Conteos cruzados: cada grupo de chips cuenta respetando el otro filtro.
  const base = pestana === 'enviados' ? enviados : recibidos;
  const porEstado = base.filter(deEmpresa);
  const porEmpresa = base.filter(deEstado);
  const hayFiltro = empresa !== '' || estado !== '';
  const limpiarFiltros = () => {
    setEmpresa('');
    setEstado('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={ACENTO} colors={[ACENTO]} />}
      >
        <HeaderTraslado />

        <View style={styles.acciones}>
          <Pressable
            style={({ pressed }) => [
              styles.boton,
              styles.botonPrimario,
              sinTalonario && styles.botonDeshabilitado,
              pressed && styles.botonPresionado,
            ]}
            onPress={nuevoTraslado}
          >
            <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="add-circle-outline" texto="Nuevo traslado" />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.boton,
              porRecibir > 0 && { borderColor: '#fbbf24' },
              pressed && styles.botonPresionado,
            ]}
            onPress={() => navigation.navigate('BandejaRecepcion')}
          >
            <ContenidoBoton
              icono="download-outline"
              texto={porRecibir > 0 ? `Por recibir (${porRecibir})` : 'Por recibir'}
              color={porRecibir > 0 ? '#fbbf24' : TEXTO_PRIMARIO}
            />
          </Pressable>
        </View>

        {/* Pestañas Enviados / Recibidos, con el total de cada una. */}
        <View style={estilos.pestanas}>
          {(['enviados', 'recibidos'] as Pestana[]).map((p) => {
            const activa = pestana === p;
            const total = p === 'enviados' ? enviadosVisibles.length : recibidosVisibles.length;
            return (
              <Pressable key={p} onPress={() => setPestana(p)} style={[estilos.pestana, activa && estilos.pestanaActiva]}>
                <Ionicons
                  name={p === 'enviados' ? 'paper-plane-outline' : 'archive-outline'}
                  size={16}
                  color={activa ? TEXTO_PRIMARIO : NEUTRAL_400}
                />
                <Text style={[estilos.pestanaTexto, activa && estilos.pestanaTextoActiva]}>
                  {p === 'enviados' ? 'Enviados' : 'Recibidos'}
                </Text>
                <View style={[estilos.pestanaConteo, activa && estilos.pestanaConteoActivo]}>
                  <Text style={[estilos.pestanaConteoTexto, activa && { color: TEXTO_SOBRE_ACENTO }]}>{total}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Filtros: empresa del talonario (los traslados antiguos, sin
            talonario por punto, solo salen en "Todas") y estado. */}
        <View style={estilos.filtros}>
          <View style={estilos.filtrosCabecera}>
            <Text style={estilos.filtrosTitulo}>
              {lista.length} {lista.length === 1 ? 'traslado' : 'traslados'}
            </Text>
            {hayFiltro ? (
              <Pressable
                onPress={limpiarFiltros}
                hitSlop={12}
                style={({ pressed }) => [estilos.limpiar, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Quitar los filtros"
              >
                <Ionicons name="close-circle" size={15} color={ACENTO} />
                <Text style={estilos.limpiarTexto}>Quitar filtros</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={estilos.chips}
            accessibilityRole="radiogroup"
          >
            <ChipFiltro
              activo={empresa === ''}
              onPress={() => setEmpresa('')}
              color={ACENTO}
              indicador={<Ionicons name="layers-outline" size={14} color={empresa === '' ? ACENTO : NEUTRAL_400} />}
              texto="Todas"
              n={porEmpresa.length}
              etiquetaAccesible="Todas las empresas"
            />
            {EMPRESAS_TALONARIO.map((e) => (
              <ChipFiltro
                key={e.letra}
                activo={empresa === e.letra}
                onPress={() => setEmpresa(empresa === e.letra ? '' : e.letra)}
                color={e.claro}
                indicador={
                  <View style={[estilos.chipLetra, { backgroundColor: e.color }]}>
                    <Text style={[estilos.chipLetraTexto, { color: e.sobreColor }]}>{e.letra}</Text>
                  </View>
                }
                texto={e.corto}
                n={porEmpresa.filter((t) => letraTraslado(t) === e.letra).length}
                etiquetaAccesible={e.nombre}
              />
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={estilos.chips}
            accessibilityRole="radiogroup"
          >
            <ChipFiltro
              activo={estado === ''}
              onPress={() => setEstado('')}
              color={ACENTO}
              indicador={<Ionicons name="list-outline" size={14} color={estado === '' ? ACENTO : NEUTRAL_400} />}
              texto="Todos"
              n={porEstado.length}
              etiquetaAccesible="Todos los estados"
            />
            {(Object.keys(PRIORIDAD) as EstadoTraslado[]).map((e) => (
              <ChipFiltro
                key={e}
                activo={estado === e}
                onPress={() => setEstado(estado === e ? '' : e)}
                color={ESTADO_TRASLADO[e].color}
                indicador={<View style={[estilos.punto, { backgroundColor: ESTADO_TRASLADO[e].color }]} />}
                texto={ESTADO_TRASLADO[e].texto}
                n={porEstado.filter((t) => t.estado === e).length}
                etiquetaAccesible={ESTADO_TRASLADO[e].texto}
              />
            ))}
          </ScrollView>
        </View>

        {cargando && lista.length === 0 ? (
          <ActivityIndicator color={ACENTO} />
        ) : error ? (
          <Text style={styles.textoErrorInline}>{error}</Text>
        ) : lista.length === 0 && hayFiltro && base.length > 0 ? (
          <View style={estilos.vacio}>
            <Ionicons name="funnel-outline" size={30} color={NEUTRAL_500} />
            <Text style={estilos.vacioTitulo}>Ningún traslado con estos filtros</Text>
            <Pressable
              onPress={limpiarFiltros}
              hitSlop={8}
              style={({ pressed }) => [estilos.limpiar, estilos.limpiarGrande, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <Ionicons name="close-circle" size={16} color={ACENTO} />
              <Text style={estilos.limpiarTexto}>Quitar filtros</Text>
            </Pressable>
          </View>
        ) : lista.length === 0 ? (
          <View style={estilos.vacio}>
            <Ionicons
              name={pestana === 'enviados' ? 'paper-plane-outline' : 'archive-outline'}
              size={34}
              color={NEUTRAL_500}
            />
            <Text style={estilos.vacioTitulo}>
              {pestana === 'enviados' ? 'Todavía no hay traslados enviados' : 'Todavía no hay traslados recibidos'}
            </Text>
            <Text style={estilos.vacioTexto}>
              {pestana === 'enviados'
                ? 'Los traslados que salgan de este punto van a aparecer aquí con su estado.'
                : 'Los traslados que este punto confirme al recibir van a aparecer aquí.'}
            </Text>
          </View>
        ) : (
          lista.map((t) => (
            <TarjetaTraslado
              key={t.id}
              traslado={t}
              direccion={pestana}
              onPress={() => navigation.navigate('DetalleTraslado', { trasladoId: t.id })}
            />
          ))
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  pestanas: {
    flexDirection: 'row',
    gap: 6,
    padding: 5,
    borderRadius: 16,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    marginTop: 4,
  },
  pestana: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  pestanaActiva: { backgroundColor: NEUTRAL_800 },
  pestanaTexto: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY_SEMI },
  pestanaTextoActiva: { color: TEXTO_PRIMARIO },
  pestanaConteo: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, backgroundColor: NEUTRAL_800 },
  pestanaConteoActivo: { backgroundColor: ACENTO },
  pestanaConteoTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY_SEMI, textAlign: 'center' },
  filtros: { gap: 8 },
  filtrosCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24, paddingHorizontal: 2 },
  filtrosTitulo: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.6 },
  limpiar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  limpiarGrande: {
    marginTop: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.45)',
  },
  limpiarTexto: { color: ACENTO, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  chips: { gap: 6, paddingRight: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_850,
  },
  chipTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  chipTextoActivo: { color: TEXTO_PRIMARIO },
  chipConteo: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY_SEMI, fontVariant: ['tabular-nums'] },
  chipLetra: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chipLetraTexto: { fontSize: 10.5, fontFamily: FUENTE_DISPLAY },
  punto: { width: 8, height: 8, borderRadius: 4 },
  tarjeta: { flexDirection: 'row', padding: 0, overflow: 'hidden' },
  franja: { width: 5 },
  contenido: { flex: 1, padding: 16, gap: 10 },
  filaSuperior: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  numero: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI, letterSpacing: 0.5 },
  pildora: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pildoraTexto: { fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  lugar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lugarEtiqueta: { color: NEUTRAL_500, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  lugarTexto: { flex: 1, color: TEXTO_PRIMARIO, fontSize: 17, fontFamily: FUENTE_DISPLAY },
  metadatos: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metadato: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metadatoTexto: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY },
  filaInferior: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cuando: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY },
  verDetalle: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  verDetalleTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  novedad: {
    flexDirection: 'row',
    gap: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(248,113,113,0.10)',
  },
  novedadTexto: { flex: 1, color: '#fca5a5', fontSize: 12.5, fontFamily: FUENTE_BODY },
  vacio: { alignItems: 'center', gap: 6, paddingVertical: 28 },
  vacioTitulo: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  vacioTexto: { color: NEUTRAL_500, fontSize: 13, fontFamily: FUENTE_BODY, textAlign: 'center' },
});
