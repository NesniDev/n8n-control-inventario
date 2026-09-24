// Tab de Remisiones -- placeholder mientras se define el flujo (ver Navegacion.tsx).
// Va a tener su propio login (usuarios distintos a los de despachos), por eso
// todavia no muestra HeaderEntrega: ese header es de la sesion de Despachos.
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { FUENTE_DISPLAY, NEUTRAL_500, styles, TEXTO_PRIMARIO } from './tema';

export default function PantallaRemisiones() {
  return (
    // Sin edge inferior -- ese inset ya lo maneja la barra de tabs.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={{ color: TEXTO_PRIMARIO, fontSize: 20, fontFamily: FUENTE_DISPLAY, marginTop: 8 }}>Remisiones</Text>
        <View style={[styles.preview, styles.previewVacio]}>
          <Ionicons name="document-text-outline" size={40} color={NEUTRAL_500} />
          <Text style={styles.previewTexto}>Próximamente</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
