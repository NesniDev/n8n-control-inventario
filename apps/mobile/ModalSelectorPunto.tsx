// Selector de punto destino para NuevoTraslado -- lista vertical con buscador
// (son ~25 puntos, los chips lado a lado no se podian recorrer). Busca sin
// mayusculas ni tildes, por codigo o nombre ("tf1", "sachica").
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Punto } from './api';
import HojaModal from './HojaModal';
import {
  ACENTO,
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  TEXTO_PRIMARIO,
} from './tema';

const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function ModalSelectorPunto({
  visible,
  titulo = 'Punto destino',
  puntos,
  seleccionadoId,
  onElegir,
  onCerrar,
}: {
  visible: boolean;
  // Reusado tambien por PantallaNovedadDetalle para elegir el CODIGO del
  // consecutivo (no un destino de traslado) -- default igual al uso
  // original de NuevoTraslado para no tocar ese llamador.
  titulo?: string;
  puntos: Punto[];
  seleccionadoId: string | null;
  onElegir: (punto: Punto) => void;
  onCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const filtro = normalizar(busqueda.trim());
  const visibles = puntos.filter((p) => normalizar(p.nombre).includes(filtro));

  const cerrar = () => {
    setBusqueda('');
    onCerrar();
  };

  return (
    <HojaModal visible={visible} titulo={titulo} onCerrar={cerrar}>
      <TextInput
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Buscar por código o nombre…"
        placeholderTextColor={NEUTRAL_500}
        style={estilos.buscar}
        autoCorrect={false}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
        {visibles.length === 0 ? (
          <Text style={estilos.vacio}>Ningún punto coincide con “{busqueda}”.</Text>
        ) : (
          visibles.map((p) => {
            const activo = p.id === seleccionadoId;
            return (
              <Pressable
                key={p.id}
                onPress={() => {
                  onElegir(p);
                  cerrar();
                }}
                style={({ pressed }) => [estilos.fila, activo && estilos.filaActiva, pressed && estilos.filaPresionada]}
              >
                <Ionicons name="business" size={18} color={ACENTO} />
                <Text style={estilos.filaTexto} numberOfLines={1}>
                  {p.nombre}
                </Text>
                {activo ? <Ionicons name="checkmark-circle" size={20} color={ACENTO} /> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </HojaModal>
  );
}

const estilos = StyleSheet.create({
  buscar: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: TEXTO_PRIMARIO,
    fontFamily: FUENTE_BODY,
    fontSize: 15,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  filaActiva: { borderColor: ACENTO, backgroundColor: 'rgba(200,99,31,0.14)' },
  filaPresionada: { borderColor: NEUTRAL_500 },
  filaTexto: { flex: 1, color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  vacio: { color: NEUTRAL_500, fontSize: 13, fontFamily: FUENTE_BODY, textAlign: 'center', paddingVertical: 16 },
});
