// Campo de firma reusable -- mismo patron de react-native-signature-canvas
// que VisorFirma en PantallaConfirmando.tsx (que no se toca), generalizado
// como componente propio: modal a pantalla completa, Borrar/Guardar via ref,
// y una vez firmado muestra la vista previa con "Volver a firmar". Usado por
// NuevoTraslado (firma de quien despacha), FirmaTransportador (firma del
// conductor) y RecepcionTraslado (firma de quien recibe).
import { useRef, useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Signature, { type SignatureViewRef } from 'react-native-signature-canvas';

import {
  ContenidoBoton,
  ESTILO_WEB_FIRMA,
  estilosFirma,
  NEUTRAL_400,
  NEUTRAL_900,
  styles,
  TEXTO_PRIMARIO,
} from './tema';

export default function CampoFirma({
  titulo,
  valor,
  onCambio,
  disabled = false,
  accesorio,
}: {
  titulo: string;
  // Data URI base64 (mismo formato que entrega onOK de <Signature>) -- null
  // mientras no se firmo todavia.
  valor: string | null;
  onCambio: (v: string) => void;
  // true mientras se esta subiendo/procesando la firma ya capturada (ver
  // FirmaTransportador, que dispara el envio apenas se firma) -- evita
  // reabrir el modal y disparar un segundo envio mientras el primero sigue
  // en vuelo.
  disabled?: boolean;
  // Boton extra que va al lado de "Firmar", en la misma fila (ej. el de
  // Observaciones en NuevoTraslado). Sin esto, "Firmar" ocupa todo el ancho.
  accesorio?: ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);
  const firmaRef = useRef<SignatureViewRef | null>(null);
  const [vacia, setVacia] = useState(false);

  const abrir = () => {
    if (disabled) return;
    setAbierta(true);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.etiquetaSeccion}>{titulo}</Text>

      {valor ? (
        <Pressable onPress={abrir}>
          <Image
            source={{ uri: valor }}
            style={[styles.preview, { height: 140, backgroundColor: '#ffffff' }]}
            resizeMode="contain"
          />
        </Pressable>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {accesorio}
        <Pressable
          disabled={disabled}
          style={({ pressed }) => [
            styles.boton,
            { flex: 1 },
            !valor && styles.botonPrimario,
            disabled && styles.botonDeshabilitado,
            pressed && styles.botonPresionado,
          ]}
          onPress={abrir}
        >
          <ContenidoBoton
            icono={valor ? 'refresh-outline' : 'create-outline'}
            texto={valor ? 'Volver a firmar' : 'Firmar'}
            color={valor ? NEUTRAL_400 : TEXTO_PRIMARIO}
          />
        </Pressable>
      </View>

      {abierta ? (
        <Modal visible animationType="slide" onRequestClose={() => setAbierta(false)} statusBarTranslucent>
          <SafeAreaView style={estilosFirma.fondo}>
            <View style={estilosFirma.header}>
              <Text style={estilosFirma.titulo}>{titulo}</Text>
              <Pressable onPress={() => setAbierta(false)} hitSlop={14}>
                <Ionicons name="close" size={26} color={TEXTO_PRIMARIO} />
              </Pressable>
            </View>
            <View style={estilosFirma.canvas}>
              <Signature
                ref={firmaRef}
                onOK={(firma) => {
                  setVacia(false);
                  onCambio(firma);
                  setAbierta(false);
                }}
                onEmpty={() => setVacia(true)}
                backgroundColor="#ffffff"
                penColor={NEUTRAL_900}
                // Footer propio del WebView oculto -- Borrar/Guardar los
                // manejan los botones de RN de abajo via el ref (mismo
                // criterio que VisorFirma en PantallaConfirmando.tsx).
                webStyle={ESTILO_WEB_FIRMA}
              />
            </View>
            {vacia ? <Text style={estilosFirma.error}>Firma antes de guardar</Text> : null}
            <View style={estilosFirma.acciones}>
              <Pressable
                style={({ pressed }) => [estilosFirma.boton, pressed && styles.botonPresionado]}
                onPress={() => {
                  setVacia(false);
                  firmaRef.current?.clearSignature();
                }}
              >
                <ContenidoBoton icono="refresh-outline" texto="Borrar" color={NEUTRAL_400} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  estilosFirma.boton,
                  estilosFirma.botonPrimario,
                  pressed && styles.botonPresionado,
                ]}
                onPress={() => {
                  setVacia(false);
                  firmaRef.current?.readSignature();
                }}
              >
                <ContenidoBoton icono="checkmark-circle-outline" texto="Guardar firma" />
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}
