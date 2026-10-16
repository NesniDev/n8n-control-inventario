// Pantalla de entrada de la tab Traslados, post-login: dos caminos posibles
// (crear un traslado nuevo, o ir a la bandeja de lo que llega a este punto)
// y el historial del punto en dos pestañas -- Enviados (salieron de aca) y
// Recibidos (llegaron aca y ya se confirmaron). Sin filtros por estado: el
// estado ya se ve en cada tarjeta (franja + etiqueta de color), en su lugar
// hay una linea de resumen y la lista va ordenada con lo que pide atencion
// primero. Tocar una tarjeta abre DetalleTraslado.
import { useCallback, useRef, useState } from 'react';
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

// Texto de cada estado en la linea de resumen (plural segun cantidad).
const RESUMEN_ESTADO: Record<EstadoTraslado, [string, string]> = {
  recibido_con_novedad: ['con novedad', 'con novedad'],
  en_transito: ['en tránsito', 'en tránsito'],
  recibido: ['recibido completo', 'recibidos completos'],
};

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
  const enviadosVisibles = enviados.filter(deEmpresa);
  const recibidosVisibles = recibidos.filter(deEmpresa);
  const lista = ordenar(pestana === 'enviados' ? enviadosVisibles : recibidosVisibles);
  const resumen = (Object.keys(PRIORIDAD) as EstadoTraslado[])
    .map((estado) => ({ estado, n: lista.filter((t) => t.estado === estado).length }))
    .filter(({ n }) => n > 0);

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

        {/* Filtro por empresa del talonario (los traslados antiguos, sin
            talonario por punto, solo salen en "Todas"). */}
        {/* Control secundario: mas discreto que las pestañas de arriba, con la
            letra del talonario y cuantos traslados tiene cada opcion en la
            pestaña actual. */}
        <View style={estilos.empresas} accessibilityRole="radiogroup">
          {[{ letra: '', corto: 'Todas' }, ...EMPRESAS_TALONARIO].map((e) => {
            const activa = empresa === e.letra;
            const base = pestana === 'enviados' ? enviados : recibidos;
            const n = e.letra ? base.filter((t) => letraTraslado(t) === e.letra).length : base.length;
            return (
              <Pressable
                key={e.letra || 'todas'}
                onPress={() => setEmpresa(e.letra)}
                style={({ pressed }) => [estilos.empresa, activa && estilos.empresaActiva, pressed && { opacity: 0.8 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: activa }}
                accessibilityLabel={`${e.letra ? e.corto : 'Todas las empresas'}, ${n} traslados`}
              >
                <View style={[estilos.empresaLetra, activa && estilos.empresaLetraActiva]}>
                  {e.letra ? (
                    <Text style={[estilos.empresaLetraTexto, activa && { color: TEXTO_SOBRE_ACENTO }]}>{e.letra}</Text>
                  ) : (
                    <Ionicons name="layers-outline" size={12} color={activa ? TEXTO_SOBRE_ACENTO : NEUTRAL_400} />
                  )}
                </View>
                <Text style={[estilos.empresaTexto, activa && estilos.empresaTextoActiva]} numberOfLines={1}>
                  {e.corto}
                </Text>
                <Text style={[estilos.empresaConteo, activa && { color: ACENTO }]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Resumen solo informativo -- mismos colores que las tarjetas. */}
        {resumen.length > 0 ? (
          <View style={estilos.resumen}>
            {resumen.map(({ estado, n }) => (
              <View key={estado} style={estilos.resumenItem}>
                <View style={[estilos.punto, { backgroundColor: ESTADO_TRASLADO[estado].color }]} />
                <Text style={estilos.resumenTexto}>
                  {n} {RESUMEN_ESTADO[estado][n === 1 ? 0 : 1]}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {cargando && lista.length === 0 ? (
          <ActivityIndicator color={ACENTO} />
        ) : error ? (
          <Text style={styles.textoErrorInline}>{error}</Text>
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
  empresas: { flexDirection: 'row', gap: 6 },
  empresa: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  empresaActiva: { borderColor: ACENTO, backgroundColor: 'rgba(245,197,66,0.10)' },
  empresaLetra: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEUTRAL_800,
  },
  empresaLetraActiva: { backgroundColor: ACENTO },
  empresaLetraTexto: { color: NEUTRAL_400, fontSize: 11, fontFamily: FUENTE_DISPLAY },
  empresaTexto: { flexShrink: 1, color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  empresaTextoActiva: { color: TEXTO_PRIMARIO },
  empresaConteo: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY_SEMI, fontVariant: ['tabular-nums'] },
  resumen: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 4 },
  resumenItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  resumenTexto: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI },
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
