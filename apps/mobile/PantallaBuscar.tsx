// Consulta directa por codigo de factura, sin pasar por una foto -- el
// documento ya existe por definicion, asi que reusa la misma pantalla de
// confirmacion de items que el flujo de re-escaneo.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { buscarEntrega } from './api';
import EvitarTeclado from './EvitarTeclado';
import { mensajeError } from './errorMessages';
import { HeaderEntrega, useEntrega } from './EntregaContext';
import { ACENTO, ContenidoBoton, NEUTRAL_400, NEUTRAL_500, styles, TEXTO_PRIMARIO } from './tema';
import type { DespachosStackParamList } from './Navegacion';

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// duplicates.py); TB9/RM3/RM2 no tienen sede duena. Solo sugerencia rapida
// para el chip "Consultar factura" -- se puede escribir cualquier otro tipo
// con el chip "+ Otro".
const TIPOS_DOCUMENTO = ['FEI', 'FV1', 'EDP', 'EDV', 'TB9', 'RM3', 'RM2'] as const;

type Props = NativeStackScreenProps<DespachosStackParamList, 'Buscar'>;

export default function PantallaBuscar({ navigation }: Props) {
  const {
    cargando,
    setCargando,
    sede,
    setEntregaId,
    setDocumentoIdentificado,
    setSituacion,
    setEstadoFinal,
    setItems,
    setEvidenciaActual,
    setFirmaUrlConsultada,
    setEsFaia,
    setNotaGeneral,
    setNotaGeneralOriginal,
    setNecesitaTrasladoConfirmar,
    reiniciar,
  } = useEntrega();

  // Consulta por codigo de factura, sin pasar por una foto. string y no la
  // union de TIPOS_DOCUMENTO: en la practica el tipo real no siempre es uno
  // de esos 7 -- son la sugerencia rapida, no el limite (ver chip "+ Otro").
  const [tipoBusqueda, setTipoBusqueda] = useState<string>('FEI');
  const [tipoBusquedaCustom, setTipoBusquedaCustom] = useState(false);
  const [indicativoBusqueda, setIndicativoBusqueda] = useState('');
  const [mensaje, setMensaje] = useState('');

  const buscarFactura = async () => {
    const indicativo = indicativoBusqueda.trim();
    if (!indicativo) return;
    setCargando(true);
    setMensaje('Buscando...');

    try {
      const resultado = await buscarEntrega(tipoBusqueda, indicativo, sede?.id ?? '');
      setEntregaId(resultado.id);
      setDocumentoIdentificado({ tipo: resultado.tipo, indicativo_numero: resultado.indicativo_numero });
      // GET /entregas/buscar siempre fuerza situacion "actualizable" del
      // lado del backend -- nunca devuelve necesita_traslado (esa situacion
      // solo sale de procesarEntrega), pero el tipo es compartido entre los
      // dos endpoints.
      setSituacion(resultado.situacion === 'necesita_traslado' ? 'actualizable' : resultado.situacion);
      // Aviso temprano (ver ResultadoEnvio.requiere_traslado) -- si el
      // documento pertenece a otra sede, Confirmando ya abre con la tarjeta
      // "Traslado requerido" puesta, en vez de que el bodeguero cargue
      // cantidades para nada.
      setNecesitaTrasladoConfirmar(
        resultado.requiere_traslado
          ? { tipo: resultado.tipo, indicativo_numero: resultado.indicativo_numero }
          : null
      );
      setEstadoFinal(resultado.estado);
      setItems(
        resultado.items.map((item) => ({
          ...item,
          valor: '',
          nota: item.nota ?? '',
          descripcionOriginal: item.descripcion,
          cantidadEntregadaOriginal: item.cantidad_entregada,
        }))
      );
      setEvidenciaActual(null);
      setFirmaUrlConsultada(resultado.firma_url ?? null);
      // Precarga el valor real del flag FAIA (viene de select e.* en el
      // backend) -- nunca asumir false, se pisaria un FAIA ya marcado.
      setEsFaia(resultado.es_faia);
      // Misma logica: precarga la nota general real, nunca asumir vacio.
      setNotaGeneral(resultado.nota_general ?? '');
      setNotaGeneralOriginal(resultado.nota_general ?? '');
      setMensaje('');
      navigation.navigate('Confirmando');
    } catch (err: any) {
      // No es un resultado terminal -- se queda en esta pantalla para
      // reintentar (codigo mal tipeado, documento que todavia no se
      // registro, etc.).
      setMensaje(mensajeError(err, 'entrega'));
    } finally {
      setCargando(false);
    }
  };

  const puedeBuscar = !!indicativoBusqueda.trim() && !!tipoBusqueda.trim() && !cargando;

  return (
    <SafeAreaView style={styles.container}>
      <EvitarTeclado>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <HeaderEntrega />

          {/* Hero -- explica de entrada que hace esta pantalla, antes de
              mostrar los campos. Puramente informativo, no toca estado. */}
          <View style={[styles.tarjeta, estilosBuscar.hero]}>
            <View style={estilosBuscar.heroIcono}>
              <Ionicons name="receipt-outline" size={28} color={ACENTO} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilosBuscar.heroTitulo}>Consultar factura</Text>
              <Text style={styles.previewSubtexto}>
                Busca un documento ya registrado por tipo y número para cargar o actualizar sus cantidades.
              </Text>
            </View>
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.filaConIcono}>
              <Ionicons name="pricetags-outline" size={15} color={NEUTRAL_400} />
              <Text style={styles.etiquetaSeccion}>Tipo de documento</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.selectorSedesContenido}
            >
              {TIPOS_DOCUMENTO.map((t) => {
                const activo = !tipoBusquedaCustom && tipoBusqueda === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setTipoBusquedaCustom(false);
                      setTipoBusqueda(t);
                    }}
                    style={[styles.chipSede, estilosBuscar.chipTipo, activo && styles.chipSedeActiva]}
                  >
                    <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>{t}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => {
                  setTipoBusquedaCustom(true);
                  setTipoBusqueda('');
                }}
                style={[styles.chipSede, estilosBuscar.chipTipo, styles.chipSedeFila, tipoBusquedaCustom && styles.chipSedeActiva]}
              >
                <Ionicons name="add-outline" size={14} color={tipoBusquedaCustom ? '#fff' : NEUTRAL_400} />
                <Text style={[styles.chipSedeTexto, tipoBusquedaCustom && styles.chipSedeTextoActivo]}>Otro</Text>
              </Pressable>
            </ScrollView>

            {tipoBusquedaCustom ? (
              <TextInput
                value={tipoBusqueda}
                onChangeText={(texto) => setTipoBusqueda(texto.toUpperCase())}
                placeholder="Escribe el tipo (ej: OT, NC)"
                placeholderTextColor={NEUTRAL_500}
                autoCapitalize="characters"
                style={styles.inputCantidad}
              />
            ) : null}
          </View>

          <View style={styles.tarjeta}>
            <View style={styles.filaConIcono}>
              <Ionicons name="barcode-outline" size={15} color={NEUTRAL_400} />
              <Text style={styles.etiquetaSeccion}>Indicativo / número</Text>
            </View>
            <View style={estilosBuscar.inputConIcono}>
              <Ionicons name="search" size={18} color={NEUTRAL_500} style={estilosBuscar.inputIcono} />
              <TextInput
                value={indicativoBusqueda}
                onChangeText={setIndicativoBusqueda}
                placeholder="Ej: 10254"
                placeholderTextColor={NEUTRAL_500}
                keyboardType="number-pad"
                style={[styles.inputCantidad, estilosBuscar.inputConIconoTexto]}
              />
            </View>
          </View>

          {cargando ? (
            <View style={[styles.tarjeta, styles.estadoBox]}>
              <ActivityIndicator color={ACENTO} />
              <Text style={styles.mensajeSubiendo}>{mensaje || 'Buscando...'}</Text>
            </View>
          ) : mensaje ? (
            <View style={estilosBuscar.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color="#f87171" />
              <Text style={[styles.textoErrorInline, { flex: 1 }]}>{mensaje}</Text>
            </View>
          ) : null}

          <View style={styles.acciones}>
            <Pressable
              disabled={!puedeBuscar}
              style={({ pressed }) => [
                styles.boton,
                styles.botonPrimario,
                estilosBuscar.botonPrincipal,
                !puedeBuscar && styles.botonDeshabilitado,
                pressed && puedeBuscar && styles.botonPresionado,
              ]}
              onPress={buscarFactura}
            >
              <ContenidoBoton icono="search-outline" texto={cargando ? 'Buscando...' : 'Buscar'} />
            </Pressable>
            <Pressable style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]} onPress={reiniciar}>
              <ContenidoBoton icono="chevron-back-outline" texto="Volver" color={NEUTRAL_400} />
            </Pressable>
          </View>
        </ScrollView>
      </EvitarTeclado>
    </SafeAreaView>
  );
}

const estilosBuscar = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroIcono: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(200,99,31,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitulo: { color: TEXTO_PRIMARIO, fontSize: 17, fontFamily: 'SpaceGrotesk_700Bold' },
  chipTipo: { minWidth: 54, alignItems: 'center' },
  inputConIcono: { position: 'relative', justifyContent: 'center' },
  inputIcono: { position: 'absolute', left: 14, zIndex: 1 },
  inputConIconoTexto: { paddingLeft: 40 },
  botonPrincipal: { paddingVertical: 18 },
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
