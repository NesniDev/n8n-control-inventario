// Pantalla de entrada de la tab Traslados, post-login: dos caminos posibles
// (crear un traslado nuevo, o ir a la bandeja de lo que llega a este punto)
// y el historial del punto en dos pestañas -- Enviados (salieron de aca) y
// Recibidos (llegaron aca y ya se confirmaron). Sin filtros por estado: el
// estado ya se ve en cada tarjeta (franja + etiqueta de color), en su lugar
// hay una linea de resumen y la lista va ordenada con lo que pide atencion
// primero. Tocar una tarjeta abre DetalleTraslado.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { fetchTrasladosPunto, type EstadoTraslado, type Traslado } from './api';
import { mensajeError } from './errorMessages';
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
} from './tema';
import type { TrasladosStackParamList } from './Navegacion';

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
          <Text style={estilos.numero}>TP-{String(traslado.consecutivo).padStart(6, '0')}</Text>
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
          {traslado.numero_talonario ? (
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

  const [enviados, setEnviados] = useState<Traslado[]>([]);
  const [recibidos, setRecibidos] = useState<Traslado[]>([]);
  const [porRecibir, setPorRecibir] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('enviados');

  const cargar = useCallback(async () => {
    if (!punto) return;
    setCargando(true);
    setError(null);
    try {
      const [listaEnviados, listaLlegadas] = await Promise.all([
        fetchTrasladosPunto({ origenId: punto.id }),
        fetchTrasladosPunto({ destinoId: punto.id }),
      ]);
      setEnviados(listaEnviados);
      // Lo que llega a este punto se parte en dos: lo que todavia esta en
      // camino va a "Por recibir"; lo ya confirmado, a la pestaña Recibidos.
      setRecibidos(listaLlegadas.filter((t) => t.estado !== 'en_transito'));
      setPorRecibir(listaLlegadas.filter((t) => t.estado === 'en_transito').length);
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

  const refrescar = async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  };

  const lista = ordenar(pestana === 'enviados' ? enviados : recibidos);
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
            style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
            onPress={() => navigation.navigate('NuevoTraslado')}
          >
            <ContenidoBoton icono="add-circle-outline" texto="Nuevo traslado" />
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
            const total = p === 'enviados' ? enviados.length : recibidos.length;
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
                  <Text style={[estilos.pestanaConteoTexto, activa && { color: TEXTO_PRIMARIO }]}>{total}</Text>
                </View>
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
