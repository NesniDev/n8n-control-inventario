import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';

import type { Empleado, Sede } from './api';
import ErrorBoundary from './ErrorBoundary';
import Navegacion from './Navegacion';
import { ACENTO, styles } from './tema';

export default function App() {
  // Sede y empleado se resuelven juntos en el login (ver PantallaLogin) --
  // un solo estado evita un instante con empleado seteado y sede todavia no.
  // Sigue viviendo aca (no en Navegacion.tsx) -- se le pasa como prop junto
  // con onLogin/onCerrarSesion.
  const [sesion, setSesion] = useState<{ empleado: Empleado; sede: Sede } | null>(null);
  // Space Grotesk (titulos/labels/numeros) + Manrope (texto de cuerpo) --
  // ver los consts FUENTE_* en tema.tsx. Se cargan una sola vez aca arriba,
  // antes de login o captura, para que ninguna pantalla renderice con la
  // fuente del sistema y despues "salte" a la tipografia real.
  const [fuentesCargadas] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        {!fuentesCargadas ? (
          <SafeAreaView style={styles.container}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={ACENTO} />
            </View>
          </SafeAreaView>
        ) : (
          <NavigationContainer>
            <StatusBar style="light" />
            <Navegacion
              sesion={sesion}
              onLogin={(empleado, sede) => setSesion({ empleado, sede })}
              onCerrarSesion={() => setSesion(null)}
            />
          </NavigationContainer>
        )}
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
