// Banner "Facturas por subir" -- solo para el mostrador (punto_venta): lista
// los avisos pendientes dirigidos a su sede (de cualquier bodeguero) (ver
// PantallaFacturasFaltantes.tsx). Se oculta sola si no hay avisos o si falla
// la red: nunca estorba la captura de facturas.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { fetchFacturasFaltantes, type FacturaFaltante } from './api';
import FilaFacturaFaltante, { confirmarMarcarSubida } from './FilaFacturaFaltante';
import { FUENTE_BODY_BOLD, NEUTRAL_850 } from './tema';
import { vibrar } from './vidrio';

// Ids de avisos que ya se le mostraron al mostrador en esta sesion de la app:
// la alerta emergente salta solo por los nuevos, no cada vez que vuelve a la
// pantalla. Vive en memoria (se reinicia al cerrar la app, igual que la sesion).
const avisadas = new Set<string>();

export default function TarjetaFacturasPorSubir({
  sedeId,
  empleadoId,
  // Cambia (ej. un contador) cuando hay que recargar sin salir de la pantalla,
  // como justo despues de subir una factura.
  recargarClave,
}: {
  sedeId: string;
  empleadoId: string;
  recargarClave?: unknown;
}) {
  const [lista, setLista] = useState<FacturaFaltante[]>([]);
  const [abierta, setAbierta] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const nuevaLista = await fetchFacturasFaltantes(sedeId, { forzar: true, vista: 'destino' });
      setLista(nuevaLista);
      const nuevas = nuevaLista.filter((f) => !avisadas.has(f.id));
      if (nuevas.length > 0) {
        nuevas.forEach((f) => avisadas.add(f.id));
        vibrar.aviso();
        const documentos = nuevas.map((f) => `${f.tipo} ${f.indicativo_numero}`).join(', ');
        Alert.alert(
          nuevas.length === 1 ? 'Factura por subir' : 'Facturas por subir',
          nuevas.length === 1
            ? `Bodega está esperando la factura ${documentos}.`
            : `Bodega está esperando ${nuevas.length} facturas: ${documentos}.`,
          [
            { text: 'Después', style: 'cancel' },
            { text: 'Ver', onPress: () => setAbierta(true) },
          ]
        );
      }
    } catch {
      // Sin red (o error del servidor): se oculta la tarjeta, sin bloquear nada.
      setLista([]);
    }
  }, [sedeId]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  // Recarga puntual al cambiar recargarClave (el primer valor ya lo cubre el foco).
  useEffect(() => {
    if (recargarClave !== undefined) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargarClave]);

  if (lista.length === 0) return null;

  const titulo = lista.length === 1 ? '1 factura por subir' : `${lista.length} facturas por subir`;

  // Banner colapsado por defecto: no le quita espacio a la camara. Al tocarlo
  // se despliega la lista compacta (ver FilaFacturaFaltante `compacta`). El
  // mostrador solo puede marcar "Ya" -- descartar no es tarea suya (el backend
  // tampoco se lo permite, ver _ROLES_DESCARTAN).
  return (
    <View style={estilosTarjeta.banner}>
      <Pressable
        onPress={() => setAbierta((a) => !a)}
        style={({ pressed }) => [estilosTarjeta.encabezado, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierta }}
        accessibilityLabel={`${titulo}. Toca para ${abierta ? 'ocultar' : 'ver'} la lista`}
      >
        <Ionicons name="notifications" size={20} color={TEXTO_SOBRE_AMBAR} />
        <Text style={estilosTarjeta.titulo}>{titulo}</Text>
        <Ionicons name={abierta ? 'chevron-up' : 'chevron-down'} size={18} color={TEXTO_SOBRE_AMBAR} />
      </Pressable>
      {abierta ? (
        <View style={estilosTarjeta.lista}>
          {lista.map((f) => (
            <FilaFacturaFaltante
              key={f.id}
              compacta
              factura={f}
              sedeMiaId={sedeId}
              onMarcarSubida={() => confirmarMarcarSubida(f, empleadoId, cargar)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const AMBAR = '#fbbf24';
// Texto oscuro sobre el ambar solido del encabezado (contraste de alerta).
const TEXTO_SOBRE_AMBAR = '#1f1400';

const estilosTarjeta = StyleSheet.create({
  banner: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AMBAR,
    overflow: 'hidden',
  },
  encabezado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: AMBAR,
  },
  titulo: { flex: 1, color: TEXTO_SOBRE_AMBAR, fontSize: 15, fontFamily: FUENTE_BODY_BOLD },
  lista: { paddingHorizontal: 14, paddingBottom: 4, backgroundColor: NEUTRAL_850 },
});
