// El edge-to-edge de Android (SDK 57 / RN 0.86) hace que el teclado ya no
// redimensione la ventana, asi que los TextInput cerca del fondo quedan
// tapados. Se usa 'padding' en los dos sistemas operativos (antes solo se
// aplicaba en iOS) para evitarlo de forma consistente.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView } from 'react-native';

export default function EvitarTeclado({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}
