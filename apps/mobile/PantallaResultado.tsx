// Pantalla final del flujo (procesada / pendiente de revision / error).
// `mensaje` llega por route.params -- unico caso de traspaso puntual entre
// pantallas via parametro de ruta en vez de contexto (ver EntregaContext.tsx):
// se arma en Captura/Buscar/Confirmando justo antes de navegar aca, no es
// estado compartido en vivo despues de la transicion.
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { HeaderEntrega, useEntrega } from './EntregaContext';
import { ContenidoBoton, ESTADO_INFO, styles } from './tema';
import type { DespachosStackParamList } from './Navegacion';

type Props = NativeStackScreenProps<DespachosStackParamList, 'Resultado'>;

export default function PantallaResultado({ route }: Props) {
  const { mensaje } = route.params;
  const { estadoFinal, reiniciar } = useEntrega();

  const infoEstadoFinal = estadoFinal ? ESTADO_INFO[estadoFinal] : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HeaderEntrega />

        {infoEstadoFinal ? (
          <View style={[styles.badgeEstado, { backgroundColor: infoEstadoFinal.fondo }]}>
            <Ionicons name={infoEstadoFinal.icono} size={22} color={infoEstadoFinal.color} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.badgeEstadoTitulo, { color: infoEstadoFinal.color }]}>
                {infoEstadoFinal.texto}
              </Text>
              <Text style={styles.badgeEstadoMensaje}>{mensaje}</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.acciones}>
          <Pressable
            style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
            onPress={reiniciar}
          >
            <ContenidoBoton icono="camera-outline" texto="Nueva captura" />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
