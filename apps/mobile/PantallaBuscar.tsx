// Consulta directa por codigo de factura, sin pasar por una foto -- el
// documento ya existe por definicion, asi que reusa la misma pantalla de
// confirmacion de items que el flujo de re-escaneo.
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { buscarEntrega } from './api';
import { mensajeError } from './errorMessages';
import { HeaderEntrega, useEntrega } from './EntregaContext';
import { ContenidoBoton, NEUTRAL_400, styles } from './tema';
import type { RootStackParamList } from './Navegacion';

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// duplicates.py); TB/RM3/RM2 no tienen sede duena. Solo sugerencia rapida
// para el chip "Consultar factura" -- se puede escribir cualquier otro tipo
// con el chip "+ Otro".
const TIPOS_DOCUMENTO = ['FEI', 'FV1', 'EDP', 'EDV', 'TB', 'RM3', 'RM2'] as const;

type Props = NativeStackScreenProps<RootStackParamList, 'Buscar'>;

export default function PantallaBuscar({ navigation }: Props) {
  const {
    cargando,
    setCargando,
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
      const resultado = await buscarEntrega(tipoBusqueda, indicativo);
      setEntregaId(resultado.id);
      setDocumentoIdentificado({ tipo: resultado.tipo, indicativo_numero: resultado.indicativo_numero });
      // GET /entregas/buscar siempre fuerza situacion "actualizable" del
      // lado del backend -- nunca devuelve necesita_traslado (esa situacion
      // solo sale de procesarEntrega), pero el tipo es compartido entre los
      // dos endpoints.
      setSituacion(resultado.situacion === 'necesita_traslado' ? 'actualizable' : resultado.situacion);
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HeaderEntrega />

        <View style={styles.tarjeta}>
          <Text style={styles.etiquetaSeccion}>Tipo de documento</Text>
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
                  style={[styles.chipSede, activo && styles.chipSedeActiva]}
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
              style={[styles.chipSede, styles.chipSedeFila, tipoBusquedaCustom && styles.chipSedeActiva]}
            >
              <Ionicons name="add-outline" size={14} color={tipoBusquedaCustom ? '#fff' : NEUTRAL_400} />
              <Text style={[styles.chipSedeTexto, tipoBusquedaCustom && styles.chipSedeTextoActivo]}>Otro</Text>
            </Pressable>
          </ScrollView>

          {tipoBusquedaCustom ? (
            <TextInput
              value={tipoBusqueda}
              onChangeText={(texto) => setTipoBusqueda(texto.toUpperCase())}
              placeholder="Escribí el tipo (ej: OT, NC)"
              placeholderTextColor="#6b7688"
              autoCapitalize="characters"
              style={styles.inputCantidad}
            />
          ) : null}
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
            <ContenidoBoton icono="search-outline" texto={cargando ? 'Buscando...' : 'Buscar'} />
          </Pressable>
          <Pressable style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]} onPress={reiniciar}>
            <ContenidoBoton icono="chevron-back-outline" texto="Volver" color={NEUTRAL_400} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
