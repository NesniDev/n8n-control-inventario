// Modales del talonario por punto (ver app/services/talonarios.py en el
// backend): configurar o cambiar el talonario activo de una letra (un punto
// puede llevar varios en paralelo, p. ej. A y V), y anular la siguiente hoja. Se abren desde la tarjeta de talonario de PantallaTrasladoInicio. Mismo
// patron que ModalProducto: una HojaModal con campos y un boton primario.
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { anularHojaTalonario, configurarTalonario, type TalonarioPunto } from './api';
import { mensajeError } from './errorMessages';
import HojaModal from './HojaModal';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';

// Hojas por talonario: fijo en 50 (debe coincidir con HOJAS_POR_TALONARIO del backend).
const HOJAS = 50;

/** "A 6301–6350" -- rango corto para la tarjeta de inicio. */
export function rangoCorto(t: Pick<TalonarioPunto, 'letra' | 'numero_inicial' | 'numero_final'>): string {
  return `${t.letra} ${t.numero_inicial}–${t.numero_final}`;
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.etiquetaSeccion}>{etiqueta}</Text>
      {children}
    </View>
  );
}

export function ModalConfigurarTalonario({
  visible,
  puntoId,
  usuarioId,
  talonarios,
  letraInicial,
  onCerrar,
  onListo,
}: {
  visible: boolean;
  puntoId: string;
  usuarioId: string;
  // Talonarios activos del punto. Si el de la letra tecleada todavia tiene
  // hojas, cambiarlo exige motivo; los de otras letras no se tocan.
  talonarios: TalonarioPunto[];
  // Letra que se precarga al abrir (al pulsar "Cambiar" en un talonario).
  letraInicial?: string;
  onCerrar: () => void;
  onListo: (talonario: TalonarioPunto) => void;
}) {
  const [letra, setLetra] = useState('');
  const [numero, setNumero] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setLetra(letraInicial ?? '');
      setNumero('');
      setMotivo('');
      setError(null);
    }
  }, [visible, letraInicial]);

  const actual = talonarios.find((t) => t.letra === letra) ?? null;
  const exigeMotivo = actual !== null && !actual.agotado;
  const letraValida = /^[A-Z]{1,3}$/.test(letra);
  const inicial = numero ? Number(numero) : 0;
  const numeroValido = /^\d{1,7}$/.test(numero) && inicial > 0 && inicial + HOJAS - 1 <= 9999999;
  const valido = letraValida && numeroValido && (!exigeMotivo || motivo.trim() !== '');

  const guardar = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const nuevo = await configurarTalonario({
        punto_id: puntoId,
        usuario_id: usuarioId,
        letra,
        numero_inicial: inicial,
        motivo: exigeMotivo ? motivo.trim() : undefined,
      });
      onListo(nuevo);
    } catch (err) {
      setError(mensajeError(err, 'talonario'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <HojaModal
      visible={visible}
      titulo={actual ? 'Cambiar talonario' : talonarios.length > 0 ? 'Agregar talonario' : 'Configura tu talonario'}
      onCerrar={onCerrar}
    >
      <Campo etiqueta="Prefijo">
        <TextInput
          value={letra}
          onChangeText={(v) => setLetra(v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={3}
          placeholder="Ej. A"
          placeholderTextColor={NEUTRAL_500}
          style={estilos.input}
          autoFocus={!letraInicial}
        />
      </Campo>
      <Campo etiqueta="Número">
        <TextInput
          value={numero}
          onChangeText={(v) => setNumero(v.replace(/[^0-9]/g, '').slice(0, 7))}
          keyboardType="number-pad"
          maxLength={7}
          placeholder="Ej. 6301"
          placeholderTextColor={NEUTRAL_500}
          style={estilos.input}
          autoFocus={!!letraInicial}
        />
      </Campo>

      {letraValida && numeroValido ? (
        <View style={estilos.vista}>
          <Text style={estilos.vistaEtiqueta}>El talonario va de</Text>
          <Text style={estilos.vistaRango}>
            {letra} {inicial} – {letra} {inicial + HOJAS - 1}
          </Text>
          <Text style={estilos.vistaEtiqueta}>({HOJAS} hojas)</Text>
        </View>
      ) : null}

      {exigeMotivo ? (
        <Campo etiqueta="Motivo del cambio">
          <Text style={styles.previewSubtexto}>
            El talonario actual ({rangoCorto(actual!)}) todavía tiene {actual!.quedan}{' '}
            {actual!.quedan === 1 ? 'hoja' : 'hojas'} sin usar. Cuéntanos por qué lo cambias.
          </Text>
          <TextInput
            value={motivo}
            onChangeText={setMotivo}
            placeholder="Ej. Se mojó el talonario"
            placeholderTextColor={NEUTRAL_500}
            style={[estilos.input, { minHeight: 70, textAlignVertical: 'top' }]}
            multiline
          />
        </Campo>
      ) : null}

      {error ? <Text style={styles.textoErrorInline}>{error}</Text> : null}

      <Pressable
        disabled={!valido || enviando}
        style={({ pressed }) => [
          styles.boton,
          styles.botonPrimario,
          (!valido || enviando) && styles.botonDeshabilitado,
          pressed && valido && styles.botonPresionado,
        ]}
        onPress={guardar}
      >
        {enviando ? (
          <ActivityIndicator color={TEXTO_SOBRE_ACENTO} />
        ) : (
          <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="checkmark-outline" texto="Guardar talonario" />
        )}
      </Pressable>
    </HojaModal>
  );
}

export function ModalAnularHoja({
  visible,
  puntoId,
  usuarioId,
  talonario,
  onCerrar,
  onListo,
}: {
  visible: boolean;
  puntoId: string;
  usuarioId: string;
  talonario: TalonarioPunto | null;
  onCerrar: () => void;
  onListo: (talonario: TalonarioPunto) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMotivo('');
      setError(null);
    }
  }, [visible]);

  const hoja = talonario?.siguiente_hoja ?? null;
  const valido = hoja !== null && motivo.trim() !== '';

  const anular = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await anularHojaTalonario({
        punto_id: puntoId,
        usuario_id: usuarioId,
        talonario_id: talonario!.id,
        motivo: motivo.trim(),
      });
      onListo(resultado.talonario);
    } catch (err) {
      setError(mensajeError(err, 'talonario'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <HojaModal visible={visible} titulo={hoja ? `Anular la hoja ${hoja}` : 'Anular hoja'} onCerrar={onCerrar}>
      <Text style={styles.previewSubtexto}>
        Solo se puede anular la siguiente hoja del talonario. Una hoja anulada no se puede usar de nuevo.
      </Text>
      <Campo etiqueta="Motivo (obligatorio)">
        <TextInput
          value={motivo}
          onChangeText={setMotivo}
          placeholder="Ej. La hoja salió rota"
          placeholderTextColor={NEUTRAL_500}
          style={[estilos.input, { minHeight: 70, textAlignVertical: 'top' }]}
          multiline
          autoFocus
        />
      </Campo>

      {error ? <Text style={styles.textoErrorInline}>{error}</Text> : null}

      <Pressable
        disabled={!valido || enviando}
        style={({ pressed }) => [
          styles.boton,
          styles.botonPrimario,
          (!valido || enviando) && styles.botonDeshabilitado,
          pressed && valido && styles.botonPresionado,
        ]}
        onPress={anular}
      >
        {enviando ? (
          <ActivityIndicator color={TEXTO_SOBRE_ACENTO} />
        ) : (
          <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="close-circle-outline" texto={hoja ? `Anular ${hoja}` : 'Anular'} />
        )}
      </Pressable>
    </HojaModal>
  );
}

const estilos = StyleSheet.create({
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
  vista: {
    alignItems: 'center',
    gap: 2,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(245,197,66,0.08)',
    borderWidth: 1,
    borderColor: ACENTO,
  },
  vistaEtiqueta: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  vistaRango: { color: ACENTO, fontSize: 20, fontFamily: FUENTE_DISPLAY, letterSpacing: 0.5 },
});
