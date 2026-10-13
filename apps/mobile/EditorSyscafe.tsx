// Editor del numero Syscafe de un traslado -- solo lo monta Supervision (sesion
// 'supervision') dentro de PantallaTrasladoDetalle. Guarda con
// PATCH /traslados-puntos/{id}/syscafe (formato CODIGO-NUMERO, ej. NBR-945) y
// permite borrarlo; el 422 (formato) y el 409 (ya lo tiene otro traslado) se
// muestran tal cual los escribe el backend.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { asignarSyscafe, type Traslado } from './api';
import { mensajeError } from './errorMessages';
import { ContenidoBoton, FUENTE_BODY, NEUTRAL_400, NEUTRAL_500, styles, TEXTO_PRIMARIO, TEXTO_SOBRE_ACENTO } from './tema';

export default function EditorSyscafe({
  traslado,
  supervisorId,
  onGuardado,
}: {
  traslado: Traslado;
  supervisorId: string;
  onGuardado: (traslado: Traslado) => void;
}) {
  const guardado = traslado.numero_syscafe ?? '';
  const [valor, setValor] = useState(guardado);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const texto = valor.trim();
  const sinCambios = texto.toUpperCase() === guardado;

  const enviar = async (nuevo: string | null) => {
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await asignarSyscafe(traslado.id, supervisorId, nuevo);
      // El backend devuelve el valor normalizado (ej. "nbr 945" -> "NBR-945").
      setValor(actualizado.numero_syscafe ?? '');
      onGuardado({ ...traslado, numero_syscafe: actualizado.numero_syscafe ?? null });
    } catch (err) {
      setError(mensajeError(err, 'traslado'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View style={styles.tarjeta}>
      <Text style={styles.etiquetaSeccion}>Número Syscafe</Text>
      <TextInput
        value={valor}
        onChangeText={(t) => {
          setValor(t);
          setError(null);
        }}
        placeholder="NBR-945"
        placeholderTextColor={NEUTRAL_500}
        autoCapitalize="characters"
        autoCorrect={false}
        style={[styles.inputNota, estilos.input]}
        editable={!enviando}
      />
      <Text style={estilos.ayuda}>Formato código-número, por ejemplo NBR-945. Déjalo vacío para quitarlo.</Text>
      {error ? <Text style={styles.textoErrorInline}>{error}</Text> : null}
      <View style={estilos.acciones}>
        {guardado ? (
          <Pressable
            disabled={enviando}
            onPress={() => enviar(null)}
            style={({ pressed }) => [styles.boton, enviando && styles.botonDeshabilitado, pressed && styles.botonPresionado]}
          >
            <ContenidoBoton icono="trash-outline" texto="Borrar" />
          </Pressable>
        ) : null}
        <Pressable
          disabled={enviando || sinCambios}
          onPress={() => enviar(texto || null)}
          style={({ pressed }) => [
            styles.boton,
            styles.botonPrimario,
            (enviando || sinCambios) && styles.botonDeshabilitado,
            pressed && styles.botonPresionado,
          ]}
        >
          {enviando ? (
            <ActivityIndicator color={TEXTO_SOBRE_ACENTO} />
          ) : (
            <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="save-outline" texto="Guardar" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  input: { fontSize: 16, fontFamily: FUENTE_BODY, color: TEXTO_PRIMARIO, letterSpacing: 0.5 },
  ayuda: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY },
  acciones: { flexDirection: 'row', gap: 10 },
});
