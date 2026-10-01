// "Factura no subida" -- el bodeguero avisa al mostrador (punto_venta) de su
// sede que una factura todavia no fue subida, y ve los avisos pendientes de la
// sede. Cuando el mostrador sube esa factura el backend cierra el aviso solo
// (ver app/services/facturas_faltantes.py). Solo aplica a Despachos: las
// remisiones nunca requieren factura.
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { fetchFacturasFaltantes, fetchFacturasYaSubidas, reportarFacturaFaltante, type FacturaFaltante } from './api';
import EvitarTeclado from './EvitarTeclado';
import {
  esErrorFacturaYaReportada,
  esErrorFacturaYaSubida,
  MENSAJE_FACTURA_YA_REPORTADA,
  MENSAJE_FACTURA_YA_SUBIDA,
  mensajeError,
} from './errorMessages';
import { HeaderEntrega, useEntrega } from './EntregaContext';
import FilaFacturaFaltante, { confirmarDescartarFactura } from './FilaFacturaFaltante';
import SelectorTipoNumero, { tiposPorFlujo } from './SelectorTipoNumero';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY_SEMI,
  NEUTRAL_500,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';

const VERDE = '#34d399';

export default function PantallaFacturasFaltantes() {
  const { empleado, sede } = useEntrega();

  // Solo tipos de despacho: las remisiones nunca requieren factura.
  const tipos = tiposPorFlujo(false);
  const [tipo, setTipo] = useState<string>('FEI');
  const [tipoCustom, setTipoCustom] = useState(false);
  const [numero, setNumero] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Resultado del ultimo intento de reportar: ok (verde) o error (rojo).
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const [lista, setLista] = useState<FacturaFaltante[]>([]);
  // Reportes de mi sede que el mostrador ya subio (ultimas 24 h).
  const [yaSubidas, setYaSubidas] = useState<FacturaFaltante[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const yaCargado = useRef(false);
  const cargar = useCallback(
    async (forzar = false) => {
      if (!sede) return;
      // Spinner solo la primera vez: despues la lista queda a la vista mientras
      // se actualiza (la cache de api.ts la devuelve al instante).
      if (!yaCargado.current) setCargando(true);
      setErrorLista(null);
      try {
        setLista(await fetchFacturasFaltantes(sede.id, { forzar, vista: 'sede' }));
        yaCargado.current = true;
        // Aparte: si falla, solo se oculta esa seccion, no la lista de pendientes.
        fetchFacturasYaSubidas(sede.id, { forzar })
          .then(setYaSubidas)
          .catch(() => setYaSubidas([]));
      } catch (err) {
        setErrorLista(mensajeError(err, 'factura_faltante'));
      } finally {
        setCargando(false);
      }
    },
    [sede]
  );

  // Recarga cada vez que se vuelve a esta pantalla -- el mostrador pudo haber
  // subido (y cerrado) alguna factura mientras tanto.
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  const refrescar = async () => {
    setRefrescando(true);
    await cargar(true);
    setRefrescando(false);
  };

  const puedeEnviar = !!tipo.trim() && !!numero.trim() && !enviando && !!empleado && !!sede;

  const reportar = async () => {
    if (!puedeEnviar || !empleado || !sede) return;
    setEnviando(true);
    setAviso(null);
    const tipoLimpio = tipo.trim();
    const numeroLimpio = numero.trim();
    try {
      const reporte = await reportarFacturaFaltante({
        tipo: tipoLimpio,
        indicativo_numero: numeroLimpio,
        empleado_id: empleado.id,
        sede_id: sede.id,
      });
      setAviso({ ok: true, texto: `Se avisó al punto de venta de ${reporte.sede_nombre ?? 'tu sede'}.` });
      setNumero('');
      await cargar(true);
    } catch (err) {
      setAviso({
        ok: false,
        texto: esErrorFacturaYaSubida(err)
          ? MENSAJE_FACTURA_YA_SUBIDA
          : esErrorFacturaYaReportada(err)
            ? MENSAJE_FACTURA_YA_REPORTADA
            : mensajeError(err, 'factura_faltante'),
      });
    } finally {
      setEnviando(false);
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
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={ACENTO} colors={[ACENTO]} />
          }
        >
          <HeaderEntrega />

          <View style={styles.tarjeta}>
            <View style={styles.filaConIcono}>
              <Ionicons name="alert-circle-outline" size={18} color={ACENTO} />
              <Text style={estilosFaltantes.titulo}>Reportar factura no subida</Text>
            </View>
            <Text style={styles.previewSubtexto}>
              Avisa al punto de venta de la sede que debe subir esta factura (según el tipo) que todavía no fue subida.
            </Text>

            <SelectorTipoNumero
              tipo={tipo}
              setTipo={setTipo}
              tipoCustom={tipoCustom}
              setTipoCustom={setTipoCustom}
              numero={numero}
              setNumero={setNumero}
              tipos={tipos}
              conTarjetas={false}
              editable={!enviando}
            />

            {aviso ? (
              <View style={[estilosFaltantes.aviso, aviso.ok ? estilosFaltantes.avisoOk : estilosFaltantes.avisoError]}>
                <Ionicons
                  name={aviso.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                  size={18}
                  color={aviso.ok ? VERDE : '#f87171'}
                />
                <Text style={[styles.textoErrorInline, { flex: 1 }, aviso.ok && { color: VERDE }]}>{aviso.texto}</Text>
              </View>
            ) : null}

            <Pressable
              disabled={!puedeEnviar}
              style={({ pressed }) => [
                styles.boton,
                styles.botonPrimario,
                estilosFaltantes.botonPrincipal,
                !puedeEnviar && styles.botonDeshabilitado,
                pressed && puedeEnviar && styles.botonPresionado,
              ]}
              onPress={reportar}
            >
              <ContenidoBoton
                color={TEXTO_SOBRE_ACENTO}
                icono="send-outline"
                texto={enviando ? 'Enviando...' : 'Avisar al punto de venta'}
              />
            </Pressable>
          </View>

          <View style={styles.tarjeta}>
            <Text style={styles.etiquetaSeccion}>Pendientes de tu sede ({lista.length})</Text>
            {cargando && lista.length === 0 ? (
              <ActivityIndicator color={ACENTO} />
            ) : errorLista ? (
              <Text style={styles.textoErrorInline}>{errorLista}</Text>
            ) : lista.length === 0 ? (
              <View style={estilosFaltantes.vacio}>
                <Ionicons name="checkmark-done-outline" size={30} color={NEUTRAL_500} />
                <Text style={estilosFaltantes.vacioTexto}>No hay facturas pendientes de subir en tu sede.</Text>
              </View>
            ) : (
              lista.map((f) => (
                <FilaFacturaFaltante
                  key={f.id}
                  factura={f}
                  sedeMiaId={sede?.id ?? ''}
                  // Solo quien reporto puede descartar desde aca; el mostrador
                  // lo hace desde su propia tarjeta (TarjetaFacturasPorSubir).
                  onDescartar={
                    empleado && f.reportado_por === empleado.id
                      ? () => confirmarDescartarFactura(f, empleado.id, () => cargar(true))
                      : undefined
                  }
                />
              ))
            )}
          </View>

          {yaSubidas.length > 0 ? (
            <View style={styles.tarjeta}>
              <Text style={styles.etiquetaSeccion}>Ya subidas (últimas 24 h)</Text>
              {yaSubidas.map((f) => (
                <FilaFacturaFaltante key={f.id} factura={f} sedeMiaId={sede?.id ?? ''} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </EvitarTeclado>
    </SafeAreaView>
  );
}

const estilosFaltantes = StyleSheet.create({
  titulo: { color: TEXTO_PRIMARIO, fontSize: 17, fontFamily: 'SpaceGrotesk_700Bold' },
  botonPrincipal: { paddingVertical: 16 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  avisoOk: { borderColor: 'rgba(52,211,153,0.35)', backgroundColor: 'rgba(52,211,153,0.08)' },
  avisoError: { borderColor: 'rgba(248,113,113,0.35)', backgroundColor: 'rgba(248,113,113,0.08)' },
  vacio: { alignItems: 'center', gap: 8, paddingVertical: 10 },
  vacioTexto: { color: NEUTRAL_500, fontSize: 13, fontFamily: FUENTE_BODY_SEMI, textAlign: 'center' },
});
