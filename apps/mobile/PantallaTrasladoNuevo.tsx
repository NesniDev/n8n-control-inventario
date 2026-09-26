// Paso 1 de crear un traslado (bodega origen): elegir destino, transportador,
// fecha, cargar los productos (uno o mas), observaciones y firmar como quien
// despacha. El origen es fijo -- el punto del usuario logueado. El envio
// real (crear el traslado en el backend) pasa en FirmaTransportador, no aca
// -- esta pantalla solo arma el borrador (ver TrasladoContext.tsx).
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { fetchPuntos, type Punto } from './api';
import EvitarTeclado from './EvitarTeclado';
import { mensajeError } from './errorMessages';
import CampoFirma from './CampoFirma';
import HojaModal from './HojaModal';
import ModalProducto, { productoValido } from './ModalProducto';
import ModalSelectorPunto from './ModalSelectorPunto';
import SelectorFecha, { formatearFechaLarga } from './SelectorFecha';
import { AvisoRol } from './ResumenTraslado';
import { HeaderTraslado, useTraslado, type ItemTrasladoDraft } from './TrasladoContext';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  NEUTRAL_500,
  styles,
  TEXTO_PRIMARIO,
} from './tema';
import type { TrasladosStackParamList } from './Navegacion';

type NavegacionNuevo = NativeStackNavigationProp<TrasladosStackParamList, 'NuevoTraslado'>;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
// Mismos caracteres permitidos que valida numero_talonario en el backend
// (app/models/traslado_punto.py) -- letras, digitos, espacio, guion, barra.
const TALONARIO_CARACTERES_INVALIDOS = /[^A-Za-z0-9 /-]/g;

function fechaValida(valor: string): boolean {
  if (!FECHA_REGEX.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00`);
  return !Number.isNaN(fecha.getTime());
}

// Campo que se ve como un input pero abre un selector (destino, fecha).
function CampoSelector({
  icono,
  texto,
  placeholder,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  texto: string | null;
  placeholder: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.inputCantidad, estilos.campoSelector, pressed && { borderColor: ACENTO }]}
    >
      <Ionicons name={icono} size={18} color={ACENTO} />
      <Text style={[estilos.campoSelectorTexto, !texto && { color: NEUTRAL_500 }]} numberOfLines={1}>
        {texto ?? placeholder}
      </Text>
      <Ionicons name="chevron-down" size={18} color={NEUTRAL_500} />
    </Pressable>
  );
}

export default function PantallaTrasladoNuevo() {
  const navigation = useNavigation<NavegacionNuevo>();
  const { punto, draft, actualizarDraft } = useTraslado();

  const [puntos, setPuntos] = useState<Punto[]>([]);
  const [cargandoPuntos, setCargandoPuntos] = useState(true);
  const [errorPuntos, setErrorPuntos] = useState<string | null>(null);
  const [selectorDestinoAbierto, setSelectorDestinoAbierto] = useState(false);
  const [selectorFechaAbierto, setSelectorFechaAbierto] = useState(false);
  const [observacionesAbiertas, setObservacionesAbiertas] = useState(false);
  // undefined = modal cerrado; null = agregando uno nuevo; item = editando ese.
  const [productoEditado, setProductoEditado] = useState<ItemTrasladoDraft | null | undefined>(undefined);

  useEffect(() => {
    fetchPuntos()
      .then(setPuntos)
      .catch((err) => setErrorPuntos(mensajeError(err, 'traslado')))
      .finally(() => setCargandoPuntos(false));
  }, []);

  // El propio punto no es una opcion de destino -- ya lo rechaza el backend
  // (origen != destino), pero ni se ofrece aca.
  const puntosDestino = puntos.filter((p) => p.id !== punto?.id);

  // Alta o edicion segun si el localId ya esta en la lista.
  const guardarItem = (guardado: ItemTrasladoDraft) => {
    const existe = draft.items.some((item) => item.localId === guardado.localId);
    actualizarDraft({
      items: existe
        ? draft.items.map((item) => (item.localId === guardado.localId ? guardado : item))
        : [...draft.items, guardado],
    });
  };

  const quitarItem = (localId: string) => {
    actualizarDraft({ items: draft.items.filter((item) => item.localId !== localId) });
  };

  const hayObservaciones = draft.observaciones.trim() !== '';

  const itemsValidos = draft.items.length > 0 && draft.items.every(productoValido);
  const puedeContinuar =
    draft.numeroTalonario.trim() !== '' &&
    !!draft.destino &&
    draft.transportadorNombre.trim() !== '' &&
    fechaValida(draft.fecha) &&
    itemsValidos &&
    !!draft.firmaDespachaBase64;

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
            icono="cube-outline"
            rol="Bodega origen · Despacho"
            texto="Completa el destino, el transportador y los productos que salen. Al final firma como quien despacha."
          />

          <View style={styles.tarjeta}>
            <Text style={styles.etiquetaSeccion}>Origen</Text>
            <Text style={styles.previewSubtexto}>{punto?.nombre ?? '—'}</Text>

            <Text style={styles.etiquetaSeccion}>Número de talonario</Text>
            <TextInput
              value={draft.numeroTalonario}
              onChangeText={(v) =>
                actualizarDraft({ numeroTalonario: v.replace(TALONARIO_CARACTERES_INVALIDOS, '').slice(0, 30) })
              }
              placeholder="Ej. 00231"
              placeholderTextColor={NEUTRAL_500}
              autoCapitalize="characters"
              style={styles.inputCantidad}
            />

            <Text style={styles.etiquetaSeccion}>Destino</Text>
            {cargandoPuntos ? (
              <Text style={styles.previewSubtexto}>Cargando puntos...</Text>
            ) : errorPuntos ? (
              <Text style={styles.textoErrorInline}>{errorPuntos}</Text>
            ) : puntosDestino.length === 0 ? (
              <Text style={styles.previewSubtexto}>No hay otros puntos activos todavía.</Text>
            ) : (
              <CampoSelector
                icono="location-outline"
                texto={draft.destino?.nombre ?? null}
                placeholder="Elegir punto destino"
                onPress={() => setSelectorDestinoAbierto(true)}
              />
            )}

            <Text style={styles.etiquetaSeccion}>Transportador</Text>
            <TextInput
              value={draft.transportadorNombre}
              onChangeText={(v) => actualizarDraft({ transportadorNombre: v })}
              placeholder="Nombre de quien transporta"
              placeholderTextColor={NEUTRAL_500}
              style={styles.inputCantidad}
            />

            <Text style={styles.etiquetaSeccion}>Fecha</Text>
            <CampoSelector
              icono="calendar-outline"
              texto={fechaValida(draft.fecha) ? formatearFechaLarga(draft.fecha) : null}
              placeholder="Elegir fecha"
              onPress={() => setSelectorFechaAbierto(true)}
            />
          </View>

          <Text style={styles.etiquetaSeccion}>Productos</Text>
          {draft.items.length === 0 ? (
            <Text style={styles.previewSubtexto}>Todavía no agregaste productos.</Text>
          ) : (
            draft.items.map((item) => {
              const detalle = [item.marca, item.presentacion].filter(Boolean).join(' · ');
              return (
                // Tocar la tarjeta la edita en el mismo modal; la papelera la quita.
                <Pressable
                  key={item.localId}
                  onPress={() => setProductoEditado(item)}
                  style={({ pressed }) => [styles.tarjeta, estilos.tarjetaProducto, pressed && { opacity: 0.8 }]}
                >
                  <View style={estilos.cantidadCaja}>
                    <Text style={estilos.cantidadTexto}>{item.cantidad}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemDescripcion} numberOfLines={2}>
                      {item.producto}
                    </Text>
                    {detalle ? <Text style={styles.previewSubtexto}>{detalle}</Text> : null}
                  </View>
                  <Pressable onPress={() => quitarItem(item.localId)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={20} color={NEUTRAL_400} />
                  </Pressable>
                </Pressable>
              );
            })
          )}
          <Pressable
            style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
            onPress={() => setProductoEditado(null)}
          >
            <ContenidoBoton icono="add-outline" texto="Agregar producto" color={NEUTRAL_400} />
          </Pressable>

          {/* Observaciones y firma de quien despacha van juntas: es lo ultimo
              que se completa antes de pasarle el celular al conductor. */}
          <View style={styles.tarjeta}>
            <CampoFirma
              titulo="Firma de quien despacha"
              valor={draft.firmaDespachaBase64}
              onCambio={(firma) => actualizarDraft({ firmaDespachaBase64: firma })}
              accesorio={
                <Pressable
                  style={({ pressed }) => [
                    styles.boton,
                    { flex: 1 },
                    hayObservaciones && { borderColor: ACENTO },
                    pressed && styles.botonPresionado,
                  ]}
                  onPress={() => setObservacionesAbiertas(true)}
                >
                  <ContenidoBoton
                    icono={hayObservaciones ? 'chatbox-ellipses' : 'chatbox-ellipses-outline'}
                    texto="Observaciones"
                    color={hayObservaciones ? TEXTO_PRIMARIO : NEUTRAL_400}
                  />
                </Pressable>
              }
            />
            {hayObservaciones ? (
              <Pressable onPress={() => setObservacionesAbiertas(true)} style={styles.notaPreviewFila}>
                <Ionicons name="chatbox-ellipses-outline" size={14} color={NEUTRAL_500} />
                <Text style={styles.notaPreview} numberOfLines={2}>
                  {draft.observaciones.trim()}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.acciones}>
            <Pressable
              disabled={!puedeContinuar}
              style={({ pressed }) => [
                styles.boton,
                styles.botonPrimario,
                !puedeContinuar && styles.botonDeshabilitado,
                pressed && puedeContinuar && styles.botonPresionado,
              ]}
              onPress={() => navigation.navigate('FirmaTransportador')}
            >
              <ContenidoBoton icono="arrow-forward-outline" texto="Continuar" />
            </Pressable>
          </View>
        </ScrollView>
      </EvitarTeclado>

      <ModalSelectorPunto
        visible={selectorDestinoAbierto}
        puntos={puntosDestino}
        seleccionadoId={draft.destino?.id ?? null}
        onElegir={(p) => actualizarDraft({ destino: p })}
        onCerrar={() => setSelectorDestinoAbierto(false)}
      />
      <SelectorFecha
        visible={selectorFechaAbierto}
        valor={draft.fecha}
        onElegir={(fecha) => actualizarDraft({ fecha })}
        onCerrar={() => setSelectorFechaAbierto(false)}
      />
      <HojaModal
        visible={observacionesAbiertas}
        titulo="Observaciones"
        onCerrar={() => setObservacionesAbiertas(false)}
      >
        <TextInput
          value={draft.observaciones}
          onChangeText={(v) => actualizarDraft({ observaciones: v })}
          placeholder="Información adicional del traslado (opcional)"
          placeholderTextColor={NEUTRAL_500}
          style={[styles.inputNota, { minHeight: 120, textAlignVertical: 'top' }]}
          multiline
          autoFocus
        />
        <Pressable
          style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
          onPress={() => setObservacionesAbiertas(false)}
        >
          <ContenidoBoton icono="checkmark-outline" texto="Listo" />
        </Pressable>
      </HojaModal>
      <ModalProducto
        visible={productoEditado !== undefined}
        inicial={productoEditado ?? null}
        onGuardar={guardarItem}
        onCerrar={() => setProductoEditado(undefined)}
      />
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  campoSelector: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campoSelectorTexto: { flex: 1, color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  tarjetaProducto: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cantidadCaja: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(200,99,31,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cantidadTexto: { color: ACENTO, fontSize: 18, fontFamily: FUENTE_DISPLAY },
});
