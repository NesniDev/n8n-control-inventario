// Alta/edicion de un producto del traslado en una HojaModal, en el orden en
// que se lee el papel en bodega: Cantidad, Nombre del producto, Marca,
// Presentacion. Trabaja sobre una copia local del item -- nada se escribe en
// el borrador (TrasladoContext) hasta tocar "Guardar", asi "Cancelar" o
// cerrar no dejan un producto a medio cargar en la lista.
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import HojaModal from './HojaModal';
import { nuevoItemDraft, type ItemTrasladoDraft } from './TrasladoContext';
import { ContenidoBoton, FUENTE_BODY, FUENTE_BODY_SEMI, NEUTRAL_400, NEUTRAL_500, NEUTRAL_700, NEUTRAL_800, styles, TEXTO_PRIMARIO } from './tema';

export function productoValido(item: ItemTrasladoDraft): boolean {
  return item.producto.trim() !== '' && /^\d+$/.test(item.cantidad.trim()) && Number(item.cantidad.trim()) > 0;
}

export default function ModalProducto({
  visible,
  inicial,
  onGuardar,
  onCerrar,
}: {
  visible: boolean;
  // null = producto nuevo; si viene un item, se edita ese.
  inicial: ItemTrasladoDraft | null;
  onGuardar: (item: ItemTrasladoDraft) => void;
  onCerrar: () => void;
}) {
  const [item, setItem] = useState<ItemTrasladoDraft>(() => inicial ?? nuevoItemDraft());

  // Cada vez que se abre, arranca desde el item a editar o de uno vacio.
  useEffect(() => {
    if (visible) setItem(inicial ?? nuevoItemDraft());
  }, [visible, inicial]);

  const cambiar = (cambios: Partial<ItemTrasladoDraft>) => setItem((prev) => ({ ...prev, ...cambios }));
  const valido = productoValido(item);

  return (
    <HojaModal visible={visible} titulo={inicial ? 'Editar producto' : 'Agregar producto'} onCerrar={onCerrar}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
        <Campo etiqueta="Cantidad">
          <TextInput
            value={item.cantidad}
            onChangeText={(v) => cambiar({ cantidad: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            placeholder="Ej. 1"
            placeholderTextColor={NEUTRAL_500}
            style={estilos.input}
            autoFocus={!inicial}
          />
        </Campo>
        <Campo etiqueta="Nombre del producto">
          <TextInput
            value={item.producto}
            onChangeText={(v) => cambiar({ producto: v })}
            placeholder="Ej. Standard 70"
            placeholderTextColor={NEUTRAL_500}
            style={estilos.input}
          />
        </Campo>
        <Campo etiqueta="Marca">
          <TextInput
            value={item.marca}
            onChangeText={(v) => cambiar({ marca: v })}
            placeholder="Ej. Finca"
            placeholderTextColor={NEUTRAL_500}
            style={estilos.input}
          />
        </Campo>
        <Campo etiqueta="Presentación">
          <TextInput
            value={item.presentacion}
            onChangeText={(v) => cambiar({ presentacion: v })}
            placeholder="Ej. 40kg"
            placeholderTextColor={NEUTRAL_500}
            style={estilos.input}
          />
        </Campo>
      </ScrollView>

      <View style={estilos.acciones}>
        <Pressable style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]} onPress={onCerrar}>
          <ContenidoBoton icono="close-outline" texto="Cancelar" color={NEUTRAL_400} />
        </Pressable>
        <Pressable
          disabled={!valido}
          style={({ pressed }) => [
            styles.boton,
            styles.botonPrimario,
            { flex: 1 },
            !valido && styles.botonDeshabilitado,
            pressed && valido && styles.botonPresionado,
          ]}
          onPress={() => {
            onGuardar({
              ...item,
              cantidad: item.cantidad.trim(),
              producto: item.producto.trim(),
              marca: item.marca.trim(),
              presentacion: item.presentacion.trim(),
            });
            onCerrar();
          }}
        >
          <ContenidoBoton icono="checkmark-outline" texto="Guardar" />
        </Pressable>
      </View>
    </HojaModal>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  etiqueta: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY_SEMI },
  input: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: TEXTO_PRIMARIO,
    fontFamily: FUENTE_BODY,
    fontSize: 16,
  },
  acciones: { flexDirection: 'row', gap: 10 },
});
