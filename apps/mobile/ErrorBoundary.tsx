import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ACENTO, NEUTRAL_400, styles as temaStyles } from './tema';

// Red de seguridad general del arbol de render -- se vuelve mas relevante
// con expo-updates (agrega una dependencia de red al arranque), pero cubre
// cualquier error de render, no solo fallos de actualizacion.
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={temaStyles.container}>
          <View style={estilos.contenedor}>
            <Text style={estilos.titulo}>Ocurrió un error</Text>
            <Text style={estilos.mensaje}>Cerrá y volvé a abrir la app para continuar.</Text>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  titulo: { color: ACENTO, fontSize: 18, fontWeight: '600' },
  mensaje: { color: NEUTRAL_400, fontSize: 14, textAlign: 'center' },
});
