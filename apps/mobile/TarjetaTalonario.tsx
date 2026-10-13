// Tarjeta del talonario activo del punto: rango, siguiente hoja y cuantas
// quedan, con avisos cuando quedan pocas o ya se agoto. Sin talonario invita a
// configurarlo. Se muestra en la tab Inicio (solo sesiones de punto); la tab
// Traslados solo consulta el talonario para bloquear "Nuevo traslado".
// Carga su propio dato (siempre fresco al volver a la pantalla) y trae los
// modales de configurar y anular hoja.
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { fetchTalonarioPunto, type TalonarioPunto } from './api';
import { ModalAnularHoja, ModalConfigurarTalonario, rangoCorto } from './ModalTalonario';
import { FUENTE_BODY, FUENTE_BODY_SEMI, FUENTE_DISPLAY, NEUTRAL_400, TEXTO_PRIMARIO } from './tema';
import { MARCA } from './vidrio';

// Mismas superficies que las tarjetas de Inicio (PantallaInicio.tsx).
const SUPERFICIE = '#0f2350';
const BORDE_SUPERFICIE = 'rgba(255,255,255,0.08)';
const ROJO = '#f87171';

export default function TarjetaTalonario({
  puntoId,
  usuarioId,
  onCambio,
}: {
  puntoId: string;
  usuarioId: string;
  /** Se llama despues de configurar o anular, con el talonario resultante. */
  onCambio?: (talonario: TalonarioPunto | null) => void;
}) {
  // undefined = todavia no se sabe (cargando o fallo la consulta: no se muestra
  // nada); null = sin talonario.
  const [talonario, setTalonario] = useState<TalonarioPunto | null | undefined>(undefined);
  const [configurando, setConfigurando] = useState(false);
  const [anulando, setAnulando] = useState(false);

  // El talonario cambia con cada traslado creado: siempre fresco al volver aqui.
  useFocusEffect(
    useCallback(() => {
      let vigente = true;
      fetchTalonarioPunto(puntoId, { forzar: true })
        .then((t) => vigente && setTalonario(t))
        .catch(() => {});
      return () => {
        vigente = false;
      };
    }, [puntoId])
  );

  const cambio = (nuevo: TalonarioPunto | null) => {
    setTalonario(nuevo);
    onCambio?.(nuevo);
  };

  const modales = (
    <>
      <ModalConfigurarTalonario
        visible={configurando}
        puntoId={puntoId}
        usuarioId={usuarioId}
        actual={talonario ?? null}
        onCerrar={() => setConfigurando(false)}
        onListo={(nuevo) => {
          cambio(nuevo);
          setConfigurando(false);
        }}
      />
      <ModalAnularHoja
        visible={anulando}
        puntoId={puntoId}
        usuarioId={usuarioId}
        talonario={talonario ?? null}
        onCerrar={() => setAnulando(false)}
        onListo={(actualizado) => {
          cambio(actualizado);
          setAnulando(false);
        }}
      />
    </>
  );

  if (talonario === undefined) return null;

  if (talonario === null) {
    // Sin talonario: fila compacta tocable, como las de Pendientes/soporte.
    return (
      <>
        <Pressable
          onPress={() => setConfigurando(true)}
          accessibilityRole="button"
          accessibilityLabel="Configura tu talonario. Necesario para crear traslados."
          style={({ pressed }) => [estilos.tarjeta, estilos.filaVacia, pressed && estilos.presionado]}
        >
          <View style={[estilos.icono, { backgroundColor: MARCA.oro }]}>
            <Ionicons name="receipt-outline" size={20} color={MARCA.tinta} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={estilos.titulo}>Configura tu talonario</Text>
            <Text style={estilos.subtitulo}>Necesario para crear traslados</Text>
          </View>
          <View style={estilos.pastillaAccion}>
            <Text style={estilos.pastillaAccionTexto}>Configurar</Text>
            <Ionicons name="chevron-forward" size={14} color={MARCA.tinta} />
          </View>
        </Pressable>
        {modales}
      </>
    );
  }

  const total = talonario.numero_final - talonario.numero_inicial + 1;
  const usadas = total - talonario.quedan;
  const pocas = !talonario.agotado && talonario.quedan <= talonario.umbral_aviso;
  const colorEstado = talonario.agotado ? ROJO : pocas ? MARCA.oro : MARCA.verde;

  return (
    <>
      <View style={[estilos.tarjeta, estilos.tarjetaActiva, (talonario.agotado || pocas) && { borderColor: `${colorEstado}73` }]}>
        <View style={estilos.encabezado}>
          <View style={[estilos.icono, { backgroundColor: 'rgba(245,197,66,0.14)' }]}>
            <Ionicons name="receipt-outline" size={20} color={MARCA.oro} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={estilos.etiqueta}>Talonario</Text>
            <Text style={estilos.titulo}>{rangoCorto(talonario)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={estilos.etiqueta}>Siguiente hoja</Text>
            <Text style={[estilos.hoja, talonario.agotado && { color: ROJO }]}>
              {talonario.agotado ? 'Agotado' : talonario.siguiente_hoja}
            </Text>
          </View>
        </View>

        {/* Hojas usadas del talonario. */}
        <View style={estilos.barraFondo}>
          <View style={[estilos.barraRelleno, { width: `${(usadas / total) * 100}%`, backgroundColor: colorEstado }]} />
        </View>

        <View style={estilos.pie}>
          <Text style={[estilos.subtitulo, { flex: 1 }, (talonario.agotado || pocas) && { color: colorEstado, fontFamily: FUENTE_BODY_SEMI }]}>
            {talonario.agotado
              ? 'Pide un talonario y configúralo'
              : pocas
                ? `Pide un talonario · quedan ${talonario.quedan}`
                : `Quedan ${talonario.quedan} ${talonario.quedan === 1 ? 'hoja' : 'hojas'}`}
          </Text>
          {talonario.agotado ? null : (
            <Pressable
              onPress={() => setAnulando(true)}
              accessibilityRole="button"
              accessibilityLabel="Anular hoja"
              style={({ pressed }) => [estilos.chip, pressed && estilos.presionado]}
            >
              <Ionicons name="close-circle-outline" size={15} color={TEXTO_PRIMARIO} />
              <Text style={estilos.chipTexto}>Anular</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setConfigurando(true)}
            accessibilityRole="button"
            accessibilityLabel="Cambiar talonario"
            style={({ pressed }) => [estilos.chip, talonario.agotado && estilos.chipPrimario, pressed && estilos.presionado]}
          >
            <Ionicons name="swap-horizontal-outline" size={15} color={talonario.agotado ? MARCA.tinta : TEXTO_PRIMARIO} />
            <Text style={[estilos.chipTexto, talonario.agotado && { color: MARCA.tinta }]}>Cambiar</Text>
          </Pressable>
        </View>
      </View>
      {modales}
    </>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    borderRadius: 18,
    backgroundColor: SUPERFICIE,
    borderWidth: 1,
    borderColor: BORDE_SUPERFICIE,
  },
  filaVacia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderColor: 'rgba(245,197,66,0.45)',
  },
  tarjetaActiva: { gap: 12, padding: 14 },
  presionado: { opacity: 0.75 },
  icono: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  etiqueta: { color: NEUTRAL_400, fontSize: 11.5, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.6 },
  titulo: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  subtitulo: { color: NEUTRAL_400, fontSize: 13.5, fontFamily: FUENTE_BODY },
  hoja: { color: MARCA.oro, fontSize: 22, fontFamily: FUENTE_DISPLAY, lineHeight: 26 },
  pastillaAccion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: MARCA.oro,
  },
  pastillaAccionTexto: { color: MARCA.tinta, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  barraFondo: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  barraRelleno: { height: 6, borderRadius: 3 },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipPrimario: { backgroundColor: MARCA.oro },
  chipTexto: { color: TEXTO_PRIMARIO, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
});
