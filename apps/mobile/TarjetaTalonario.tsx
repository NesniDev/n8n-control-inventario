// Tarjeta del talonario activo del punto: rango, siguiente hoja y cuantas
// quedan, con avisos cuando quedan pocas o ya se agoto. Sin talonario invita a
// configurarlo. Se muestra en la tab Inicio (solo sesiones de punto); la tab
// Traslados solo consulta el talonario para bloquear "Nuevo traslado".
// Carga su propio dato (siempre fresco al volver a la pantalla) y trae los
// modales de configurar y anular hoja.
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { fetchTalonarioPunto, type TalonarioPunto } from './api';
import { ModalAnularHoja, ModalConfigurarTalonario, rangoCorto } from './ModalTalonario';
import {
  ACENTO,
  ContenidoBoton,
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  styles,
  TEXTO_PRIMARIO,
  TEXTO_SOBRE_ACENTO,
} from './tema';

const AMARILLO = '#fbbf24';

export default function TarjetaTalonario({
  puntoId,
  usuarioId,
  onCambio,
}: {
  puntoId: string;
  usuarioId: string;
  /** Se llama despues de configurar o anular, con el talonario resultante. */
  onCambio?: (talonario: TalonarioPunto | null) => void;
}) {
  // undefined = todavia no se sabe (cargando o fallo la consulta: no se muestra
  // nada); null = sin talonario.
  const [talonario, setTalonario] = useState<TalonarioPunto | null | undefined>(undefined);
  const [configurando, setConfigurando] = useState(false);
  const [anulando, setAnulando] = useState(false);

  // El talonario cambia con cada traslado creado: siempre fresco al volver aqui.
  useFocusEffect(
    useCallback(() => {
      let vigente = true;
      fetchTalonarioPunto(puntoId, { forzar: true })
        .then((t) => vigente && setTalonario(t))
        .catch(() => {});
      return () => {
        vigente = false;
      };
    }, [puntoId])
  );

  const cambio = (nuevo: TalonarioPunto | null) => {
    setTalonario(nuevo);
    onCambio?.(nuevo);
  };

  const modales = (
    <>
      <ModalConfigurarTalonario
        visible={configurando}
        puntoId={puntoId}
        usuarioId={usuarioId}
        actual={talonario ?? null}
        onCerrar={() => setConfigurando(false)}
        onListo={(nuevo) => {
          cambio(nuevo);
          setConfigurando(false);
        }}
      />
      <ModalAnularHoja
        visible={anulando}
        puntoId={puntoId}
        usuarioId={usuarioId}
        talonario={talonario ?? null}
        onCerrar={() => setAnulando(false)}
        onListo={(actualizado) => {
          cambio(actualizado);
          setAnulando(false);
        }}
      />
    </>
  );

  if (talonario === undefined) return null;

  if (talonario === null) {
    return (
      <>
        <View style={[styles.tarjeta, estilos.tarjetaTalonario, { borderColor: AMARILLO }]}>
          <View style={estilos.talonarioTitulo}>
            <Ionicons name="document-text-outline" size={18} color={AMARILLO} />
            <Text style={estilos.talonarioTituloTexto}>Configura tu talonario</Text>
          </View>
          <Text style={estilos.talonarioDetalle}>
            Antes de crear traslados, indica la letra y el primer número de tu talonario.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && styles.botonPresionado]}
            onPress={() => setConfigurando(true)}
          >
            <ContenidoBoton color={TEXTO_SOBRE_ACENTO} icono="settings-outline" texto="Configurar talonario" />
          </Pressable>
        </View>
        {modales}
      </>
    );
  }

  const pocas = !talonario.agotado && talonario.quedan <= talonario.umbral_aviso;
  return (
    <>
      <View
        style={[
          styles.tarjeta,
          estilos.tarjetaTalonario,
          (talonario.agotado || pocas) && { borderColor: talonario.agotado ? '#f87171' : AMARILLO },
        ]}
      >
        <View style={estilos.talonarioTitulo}>
          <Ionicons name="document-text-outline" size={18} color={ACENTO} />
          <Text style={estilos.talonarioTituloTexto}>Talonario {rangoCorto(talonario)}</Text>
        </View>
        {talonario.agotado ? (
          <Text style={[estilos.talonarioAviso, { color: '#f87171' }]}>
            Talonario agotado. Pide un talonario y configúralo.
          </Text>
        ) : (
          <Text style={estilos.talonarioDetalle}>
            Siguiente hoja: <Text style={estilos.talonarioResaltado}>{talonario.siguiente_hoja}</Text> · Quedan{' '}
            <Text style={estilos.talonarioResaltado}>{talonario.quedan}</Text>
          </Text>
        )}
        {pocas ? (
          <Text style={[estilos.talonarioAviso, { color: AMARILLO }]}>
            Pide un talonario (quedan {talonario.quedan} {talonario.quedan === 1 ? 'hoja' : 'hojas'})
          </Text>
        ) : null}
        <View style={estilos.talonarioBotones}>
          {talonario.agotado ? null : (
            <Pressable
              style={({ pressed }) => [styles.boton, { flex: 1 }, pressed && styles.botonPresionado]}
              onPress={() => setAnulando(true)}
            >
              <ContenidoBoton icono="close-circle-outline" texto="Anular hoja" color={TEXTO_PRIMARIO} />
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.boton,
              talonario.agotado && styles.botonPrimario,
              { flex: 1 },
              pressed && styles.botonPresionado,
            ]}
            onPress={() => setConfigurando(true)}
          >
            <ContenidoBoton
              icono="swap-horizontal-outline"
              texto="Cambiar talonario"
              color={talonario.agotado ? TEXTO_SOBRE_ACENTO : TEXTO_PRIMARIO}
            />
          </Pressable>
        </View>
      </View>
      {modales}
    </>
  );
}

const estilos = StyleSheet.create({
  tarjetaTalonario: { gap: 10 },
  talonarioTitulo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  talonarioTituloTexto: { color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_DISPLAY },
  talonarioDetalle: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY },
  talonarioResaltado: { color: ACENTO, fontFamily: FUENTE_BODY_SEMI },
  talonarioAviso: { fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  talonarioBotones: { flexDirection: 'row', gap: 10 },
});
