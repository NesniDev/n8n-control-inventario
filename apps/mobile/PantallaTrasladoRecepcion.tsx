// Confirma la recepcion en el punto destino: por linea, "Llego completo" o
// (si se destilda) la cantidad real recibida + una novedad de esa linea,
// mas una novedad general y la firma de quien recibe. Firmar dispara la
// confirmacion (mismo criterio que FirmaTransportador/PantallaConfirmando:
// firmar ES confirmar, no hay un boton "Confirmar" aparte). Un 409 significa
// que otro punto/dispositivo ya la confirmo primero.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import { fetchTrasladoPunto, registrarRecepcion, subirFirmaTraslado, type ItemTraslado, type Traslado } from './api';
import EvitarTeclado from './EvitarTeclado';
import { esErrorTrasladoYaRecibido, mensajeError, MENSAJE_TRASLADO_YA_RECIBIDO } from './errorMessages';
import CampoFirma from './CampoFirma';
import HojaModal from './HojaModal';
import ResumenTraslado, { AvisoRol } from './ResumenTraslado';
import { HeaderTraslado, useTraslado } from './TrasladoContext';
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
  styles,
  TEXTO_PRIMARIO,
} from './tema';
import type { TrasladosStackParamList } from './Navegacion';

type Props = NativeStackScreenProps<TrasladosStackParamList, 'RecepcionTraslado'>;
type NavegacionRecepcion = NativeStackNavigationProp<TrasladosStackParamList>;

interface LineaRecepcion {
  completo: boolean;
  cantidadRecibida: string;
  novedad: string;
}

const VERDE = '#34d399';
const ROJO = '#f87171';

// Novedades mas comunes -- un toque las agrega al texto de la linea, sin
// tener que escribirlas en el celular.
const NOVEDADES_RAPIDAS = ['Faltante', 'Llegó dañado', 'Producto equivocado', 'Empaque abierto'];

function TarjetaProductoRecepcion({
  item,
  linea,
  onElegirCompleto,
  onCambiar,
}: {
  item: ItemTraslado;
  linea: LineaRecepcion;
  onElegirCompleto: (completo: boolean) => void;
  onCambiar: (cambios: Partial<LineaRecepcion>) => void;
}) {
  const recibida = Number(linea.cantidadRecibida.trim());
  const cantidadValida = /^\d+$/.test(linea.cantidadRecibida.trim()) && recibida <= item.cantidad;
  const faltan = cantidadValida ? item.cantidad - recibida : null;
  const detalle = [item.marca, item.presentacion].filter(Boolean).join(' · ');

  const ajustar = (delta: number) => {
    const actual = /^\d+$/.test(linea.cantidadRecibida.trim()) ? recibida : item.cantidad;
    onCambiar({ cantidadRecibida: String(Math.min(item.cantidad, Math.max(0, actual + delta))) });
  };

  const agregarNovedad = (texto: string) => {
    const actual = linea.novedad.trim();
    if (actual.toLowerCase().includes(texto.toLowerCase())) return;
    onCambiar({ novedad: actual ? `${actual}, ${texto.toLowerCase()}` : texto });
  };

  return (
    <View style={[styles.tarjeta, estilos.tarjeta, { borderColor: linea.completo ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.5)' }]}>
      <View style={estilos.filaProducto}>
        <View style={estilos.cantidadCaja}>
          <Text style={estilos.cantidadTexto}>{item.cantidad}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={estilos.producto}>{item.producto}</Text>
          {detalle ? <Text style={estilos.detalle}>{detalle}</Text> : null}
        </View>
      </View>

      {/* Dos opciones grandes en vez de un checkbox chico -- se toca con el
          pulgar y se lee de lejos cual quedo elegida. */}
      <View style={estilos.segmentado}>
        <Pressable
          onPress={() => onElegirCompleto(true)}
          style={[estilos.opcion, linea.completo && { backgroundColor: 'rgba(52,211,153,0.16)', borderColor: VERDE }]}
        >
          <Ionicons name="checkmark-circle" size={18} color={linea.completo ? VERDE : NEUTRAL_500} />
          <Text style={[estilos.opcionTexto, linea.completo && { color: VERDE }]}>Llegó completo</Text>
        </Pressable>
        <Pressable
          onPress={() => onElegirCompleto(false)}
          style={[estilos.opcion, !linea.completo && { backgroundColor: 'rgba(248,113,113,0.14)', borderColor: ROJO }]}
        >
          <Ionicons name="alert-circle" size={18} color={!linea.completo ? ROJO : NEUTRAL_500} />
          <Text style={[estilos.opcionTexto, !linea.completo && { color: ROJO }]}>Con diferencia</Text>
        </Pressable>
      </View>

      {!linea.completo ? (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Text style={estilos.etiqueta}>Cantidad que llegó</Text>
            <View style={estilos.stepper}>
              <Pressable onPress={() => ajustar(-1)} style={estilos.stepperBoton} hitSlop={6}>
                <Ionicons name="remove" size={22} color={TEXTO_PRIMARIO} />
              </Pressable>
              <TextInput
                value={linea.cantidadRecibida}
                onChangeText={(v) => onCambiar({ cantidadRecibida: v.replace(/[^0-9]/g, '') })}
                keyboardType="number-pad"
                style={[estilos.stepperInput, !cantidadValida && { borderColor: ROJO }]}
                selectTextOnFocus
              />
              <Pressable onPress={() => ajustar(1)} style={estilos.stepperBoton} hitSlop={6}>
                <Ionicons name="add" size={22} color={TEXTO_PRIMARIO} />
              </Pressable>
              <Text style={estilos.deEnviados}>de {item.cantidad}</Text>
            </View>
            {!cantidadValida ? (
              <Text style={styles.textoErrorInline}>Debe ser un número entre 0 y {item.cantidad}.</Text>
            ) : faltan && faltan > 0 ? (
              <Text style={estilos.faltan}>
                Faltan {faltan} {faltan === 1 ? 'unidad' : 'unidades'}
              </Text>
            ) : null}
          </View>

          <View style={{ gap: 6 }}>
            <Text style={estilos.etiqueta}>Novedad</Text>
            <View style={estilos.chips}>
              {NOVEDADES_RAPIDAS.map((texto) => (
                <Pressable key={texto} onPress={() => agregarNovedad(texto)} style={estilos.chip}>
                  <Text style={estilos.chipTexto}>+ {texto}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={linea.novedad}
              onChangeText={(v) => onCambiar({ novedad: v })}
              placeholder="Describe qué pasó con este producto (opcional)"
              placeholderTextColor={NEUTRAL_500}
              style={[styles.inputNota, { minHeight: 60, textAlignVertical: 'top' }]}
              multiline
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function PantallaTrasladoRecepcion({ route }: Props) {
  const { trasladoId } = route.params;
  const navigation = useNavigation<NavegacionRecepcion>();
  const { usuario, punto, cargando, setCargando } = useTraslado();

  const [traslado, setTraslado] = useState<Traslado | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(true);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [lineas, setLineas] = useState<Record<string, LineaRecepcion>>({});
  const [novedadGeneral, setNovedadGeneral] = useState('');
  const [firmaRecibeBase64, setFirmaRecibeBase64] = useState<string | null>(null);
  const [novedadAbierta, setNovedadAbierta] = useState(false);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    fetchTrasladoPunto(trasladoId)
      .then((t) => {
        setTraslado(t);
        const iniciales: Record<string, LineaRecepcion> = {};
        for (const item of t.items ?? []) {
          // Por default "llego completo" -- el bodeguero destilda solo las
          // lineas que de verdad tienen una diferencia.
          iniciales[item.id] = { completo: true, cantidadRecibida: String(item.cantidad), novedad: '' };
        }
        setLineas(iniciales);
      })
      .catch((err) => setErrorDetalle(mensajeError(err, 'traslado')))
      .finally(() => setCargandoDetalle(false));
  }, [trasladoId]);

  const elegirCompleto = (item: ItemTraslado, completo: boolean) => {
    setLineas((prev) => ({
      ...prev,
      [item.id]: {
        ...prev[item.id],
        completo,
        // Al volver a "completo" se repone la cantidad enviada -- no se deja
        // un numero recortado colgando si despues se vuelve a "diferencia".
        cantidadRecibida: completo ? String(item.cantidad) : prev[item.id].cantidadRecibida,
      },
    }));
  };

  const actualizarLinea = (itemId: string, cambios: Partial<LineaRecepcion>) => {
    setLineas((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...cambios } }));
  };

  const lineasValidas =
    !!traslado &&
    (traslado.items ?? []).length > 0 &&
    (traslado.items ?? []).every((item) => {
      const linea = lineas[item.id];
      if (!linea) return false;
      if (linea.completo) return true;
      return /^\d+$/.test(linea.cantidadRecibida.trim()) && Number(linea.cantidadRecibida.trim()) <= item.cantidad;
    });

  const items = traslado?.items ?? [];
  const conDiferencia = items.filter((item) => lineas[item.id] && !lineas[item.id].completo).length;
  const hayNovedadGeneral = novedadGeneral.trim() !== '';

  const confirmar = async (firma: string) => {
    if (!traslado || !usuario) return;
    setCargando(true);
    setMensaje('Subiendo firma...');
    try {
      const subida = await subirFirmaTraslado(traslado.id, 'recibe', firma);
      setMensaje('Confirmando recepción...');
      await registrarRecepcion(traslado.id, {
        items: (traslado.items ?? []).map((item) => {
          const linea = lineas[item.id];
          return {
            id: item.id,
            cantidad_recibida: linea.completo ? item.cantidad : Number(linea.cantidadRecibida.trim()),
            novedad: linea.novedad.trim() || undefined,
          };
        }),
        novedad: novedadGeneral.trim() || undefined,
        firma_recibe_url: subida.url,
        recibido_por: usuario.id,
      });
      navigation.reset({ index: 0, routes: [{ name: 'InicioTraslados' }] });
    } catch (err) {
      setMensaje(esErrorTrasladoYaRecibido(err) ? MENSAJE_TRASLADO_YA_RECIBIDO : mensajeError(err, 'traslado'));
    } finally {
      setCargando(false);
    }
  };

  if (cargandoDetalle) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={ACENTO} />
        </View>
      </SafeAreaView>
    );
  }

  if (errorDetalle || !traslado) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <HeaderTraslado />
          <Text style={styles.textoErrorInline}>{errorDetalle ?? 'Traslado no encontrado.'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <EvitarTeclado>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <HeaderTraslado />

          <AvisoRol
            icono="download-outline"
            rol="Bodega destino · Recepción"
            texto="Revisa lo que llegó. Si algo no llegó completo, toca «Con diferencia» en ese producto y anota la cantidad y la novedad. Al final firma como quien recibe."
          />

          <ResumenTraslado
            numero={`TP-${String(traslado.consecutivo).padStart(6, '0')}`}
            origen={traslado.punto_origen_nombre ?? '—'}
            destino={traslado.punto_destino_nombre ?? punto?.nombre ?? '—'}
            transportador={traslado.transportador_nombre}
            talonario={traslado.numero_talonario}
            fecha={traslado.fecha}
            items={(traslado.items ?? []).map((item) => ({
              key: item.id,
              cantidad: item.cantidad,
              producto: item.producto,
              marca: item.marca ?? '',
              presentacion: item.presentacion ?? '',
            }))}
            observaciones={traslado.observaciones ?? ''}
            mostrarProductos={false}
          />

          <View style={estilos.encabezado}>
            <Text style={styles.etiquetaSeccion}>Confirmar lo recibido</Text>
            {/* Contador en vivo: cuantos productos estan ok y cuantos no. */}
            <View style={[estilos.contador, conDiferencia > 0 && { backgroundColor: 'rgba(248,113,113,0.14)' }]}>
              <Ionicons
                name={conDiferencia > 0 ? 'alert-circle' : 'checkmark-circle'}
                size={14}
                color={conDiferencia > 0 ? ROJO : VERDE}
              />
              <Text style={[estilos.contadorTexto, { color: conDiferencia > 0 ? ROJO : VERDE }]}>
                {conDiferencia > 0
                  ? `${conDiferencia} con diferencia`
                  : `${items.length} de ${items.length} completos`}
              </Text>
            </View>
          </View>

          {items.map((item) => {
            const linea = lineas[item.id];
            if (!linea) return null;
            return (
              <TarjetaProductoRecepcion
                key={item.id}
                item={item}
                linea={linea}
                onElegirCompleto={(completo) => elegirCompleto(item, completo)}
                onCambiar={(cambios) => actualizarLinea(item.id, cambios)}
              />
            );
          })}

          {/* Novedad general y firma juntas, como Observaciones + Firma en el
              despacho: es lo ultimo antes de confirmar. */}
          <View style={styles.tarjeta}>
            <CampoFirma
              titulo="Firma de quien recibe"
              valor={firmaRecibeBase64}
              onCambio={(firma) => {
                setFirmaRecibeBase64(firma);
                confirmar(firma);
              }}
              disabled={cargando || !lineasValidas}
              accesorio={
                <Pressable
                  style={({ pressed }) => [
                    styles.boton,
                    { flex: 1 },
                    hayNovedadGeneral && { borderColor: ROJO },
                    pressed && styles.botonPresionado,
                  ]}
                  onPress={() => setNovedadAbierta(true)}
                >
                  <ContenidoBoton
                    icono={hayNovedadGeneral ? 'alert-circle' : 'alert-circle-outline'}
                    texto="Novedad"
                    color={hayNovedadGeneral ? TEXTO_PRIMARIO : NEUTRAL_400}
                  />
                </Pressable>
              }
            />
            {hayNovedadGeneral ? (
              <Pressable onPress={() => setNovedadAbierta(true)} style={styles.notaPreviewFila}>
                <Ionicons name="alert-circle-outline" size={14} color={ROJO} />
                <Text style={styles.notaPreview} numberOfLines={2}>
                  {novedadGeneral.trim()}
                </Text>
              </Pressable>
            ) : null}
            {!lineasValidas ? (
              <Text style={styles.textoErrorInline}>
                Revisa las cantidades marcadas en rojo antes de firmar.
              </Text>
            ) : (
              <Text style={styles.previewSubtexto}>
                {conDiferencia > 0
                  ? 'Al firmar, el traslado queda registrado como recibido con novedad.'
                  : 'Al firmar, el traslado queda registrado como recibido completo.'}
              </Text>
            )}
          </View>

          {mensaje && !cargando ? <Text style={styles.textoErrorInline}>{mensaje}</Text> : null}
          {cargando ? (
            <View style={[styles.tarjeta, styles.estadoBox]}>
              <ActivityIndicator color={ACENTO} />
              <Text style={styles.mensajeSubiendo}>{mensaje}</Text>
            </View>
          ) : null}
        </ScrollView>
      </EvitarTeclado>

      <HojaModal visible={novedadAbierta} titulo="Novedad general" onCerrar={() => setNovedadAbierta(false)}>
        <TextInput
          value={novedadGeneral}
          onChangeText={setNovedadGeneral}
          placeholder="Algo que no sea de un producto puntual (ej. llegó tarde, vehículo distinto)"
          placeholderTextColor={NEUTRAL_500}
          style={[styles.inputNota, { minHeight: 120, textAlignVertical: 'top' }]}
          multiline
          autoFocus
        />
        <Pressable
          style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
          onPress={() => setNovedadAbierta(false)}
        >
          <ContenidoBoton icono="checkmark-outline" texto="Listo" />
        </Pressable>
      </HojaModal>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  encabezado: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  contador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(52,211,153,0.14)',
  },
  contadorTexto: { fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  tarjeta: { gap: 14, borderWidth: 1.5 },
  filaProducto: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cantidadCaja: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(200,99,31,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cantidadTexto: { color: ACENTO, fontSize: 18, fontFamily: FUENTE_DISPLAY },
  producto: { color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_BODY_SEMI },
  detalle: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY },
  segmentado: { flexDirection: 'row', gap: 8 },
  opcion: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  opcionTexto: { color: NEUTRAL_400, fontSize: 13.5, fontFamily: FUENTE_BODY_SEMI },
  etiqueta: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBoton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperInput: {
    minWidth: 70,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    color: TEXTO_PRIMARIO,
    fontSize: 18,
    fontFamily: FUENTE_DISPLAY,
    textAlign: 'center',
  },
  deEnviados: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY },
  faltan: { color: ROJO, fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  chipTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
});
