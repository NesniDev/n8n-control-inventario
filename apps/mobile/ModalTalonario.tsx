// Modales del talonario por punto (ver app/services/talonarios.py en el
// backend): configurar o cambiar el talonario activo de una letra (un punto
// puede llevar varios en paralelo, p. ej. A y V), y anular la siguiente hoja. Se abren desde la tarjeta de talonario de PantallaTrasladoInicio. Mismo
// patron que ModalProducto: una HojaModal con campos y un boton primario.
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { anularHojaTalonario, configurarTalonario, type TalonarioPunto } from './api';
import { mensajeError } from './errorMessages';
import HojaModal from './HojaModal';
import { MARCA } from './vidrio';
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

// Empresas con talonario propio: cada una usa siempre la misma letra, asi el
// operador elige la empresa y no teclea el prefijo.
// `color` identifica a la empresa en tarjetas y selectores (insignia con la
// letra); `sobreColor` es el texto que contrasta encima de ese color.
export const EMPRESAS_TALONARIO = [
  { letra: 'A', nombre: 'Comercializadora El Imperio', corto: 'El Imperio', color: MARCA.oro, sobreColor: MARCA.tinta },
  { letra: 'V', nombre: 'Agroveterinaria La Rebaja', corto: 'La Rebaja', color: MARCA.verde, sobreColor: '#ffffff' },
] as const;

/** Datos de la empresa de una letra (nombre, color), o null si la letra no es de ninguna. */
export function datosEmpresa(letra: string) {
  return EMPRESAS_TALONARIO.find((e) => e.letra === letra) ?? null;
}

/** Insignia redonda con la letra del talonario, en el color de su empresa. */
export function InsigniaEmpresa({ letra, tamano = 40 }: { letra: string; tamano?: number }) {
  const empresa = datosEmpresa(letra);
  return (
    <View
      style={{
        width: tamano,
        height: tamano,
        borderRadius: tamano / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: empresa?.color ?? NEUTRAL_700,
      }}
    >
      <Text style={{ color: empresa?.sobreColor ?? TEXTO_PRIMARIO, fontSize: tamano * 0.45, fontFamily: FUENTE_DISPLAY }}>
        {letra}
      </Text>
    </View>
  );
}

/** Nombre de la empresa de un talonario por su letra, o null si la letra no es de ninguna. */
export function empresaTalonario(letra: string): string | null {
  return EMPRESAS_TALONARIO.find((e) => e.letra === letra)?.nombre ?? null;
}

/** Letra de la hoja de un traslado ("V 120" -> "V"); null en los traslados
 *  anteriores al talonario por punto (sin talonario_id). */
export function letraTraslado(t: { numero_talonario?: string | null; talonario_id?: string | null }): string | null {
  if (!t.numero_talonario || !t.talonario_id) return null;
  return /^\s*([A-Za-z]{1,3})/.exec(t.numero_talonario)?.[1].toUpperCase() ?? null;
}

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
  // Talonarios activos del punto. Si el de la empresa elegida todavia tiene
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
  // Talonario que ya venia en uso (p. ej. 1-50 y van en la 35): se registra
  // desde la siguiente hoja por usar en vez de desde la primera.
  const [enUso, setEnUso] = useState(false);
  const [siguiente, setSiguiente] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Empresas que se ofrecen: al cambiar, solo la del talonario elegido; al
  // agregar, solo las que todavia no tienen talonario activo en el punto.
  const opciones = letraInicial
    ? EMPRESAS_TALONARIO.filter((e) => e.letra === letraInicial)
    : EMPRESAS_TALONARIO.filter((e) => !talonarios.some((t) => t.letra === e.letra));

  useEffect(() => {
    if (visible) {
      // Con una sola opcion se deja elegida de una vez.
      setLetra(letraInicial ?? (opciones.length === 1 ? opciones[0].letra : ''));
      setNumero('');
      setMotivo('');
      setEnUso(false);
      setSiguiente('');
      setError(null);
    }
    // opciones se deriva de talonarios/letraInicial; basta con reiniciar al abrir.
  }, [visible, letraInicial]);

  const actual = talonarios.find((t) => t.letra === letra) ?? null;
  const exigeMotivo = actual !== null && !actual.agotado;
  const letraValida = EMPRESAS_TALONARIO.some((e) => e.letra === letra);
  const inicial = numero ? Number(numero) : 0;
  const numeroValido = /^\d{1,7}$/.test(numero) && inicial > 0 && inicial + HOJAS - 1 <= 9999999;
  const final = inicial + HOJAS - 1;
  // "Ya en uso" solo para el primer talonario de la empresa en el punto: al
  // cambiar uno existente, el nuevo empieza en su primera hoja (el backend
  // tambien lo valida, incluso si el anterior ya se habia cerrado).
  const puedeEnUso = actual === null;
  const desde = puedeEnUso && enUso && siguiente ? Number(siguiente) : inicial;
  const siguienteValido = !puedeEnUso || !enUso || (numeroValido && /^\d{1,7}$/.test(siguiente) && desde >= inicial && desde <= final);
  const valido = letraValida && numeroValido && siguienteValido && (!exigeMotivo || motivo.trim() !== '');

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
        numero_siguiente: puedeEnUso && enUso ? desde : undefined,
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
      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 14 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      {/* 1. Empresa: tarjetas grandes con la insignia de su letra. */}
      <Campo etiqueta={letraInicial ? 'Empresa' : 'Elige la empresa'}>
        <View style={{ gap: 8 }}>
          {opciones.map((empresa) => {
            const activa = empresa.letra === letra;
            return (
              <Pressable
                key={empresa.letra}
                onPress={() => setLetra(empresa.letra)}
                disabled={!!letraInicial}
                style={({ pressed }) => [estilos.empresa, activa && estilos.empresaActiva, pressed && { opacity: 0.8 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: activa }}
                accessibilityLabel={`${empresa.nombre}, talonario ${empresa.letra}`}
              >
                <InsigniaEmpresa letra={empresa.letra} tamano={34} />
                <View style={{ flex: 1 }}>
                  <Text style={estilos.empresaNombre}>{empresa.nombre}</Text>
                  <Text style={estilos.empresaDetalle}>Hojas {empresa.letra} 0000</Text>
                </View>
                <Ionicons
                  name={activa ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={activa ? ACENTO : NEUTRAL_500}
                />
              </Pressable>
            );
          })}
        </View>
      </Campo>

      {/* 2. Primera hoja, con la letra fija delante del numero. */}
      <Campo etiqueta="Primera hoja del talonario">
        <View style={[estilos.campoNumero, !letraValida && { opacity: 0.5 }]}>
          <Text style={estilos.prefijo}>{letra || '—'}</Text>
          <TextInput
            value={numero}
            onChangeText={(v) => setNumero(v.replace(/[^0-9]/g, '').slice(0, 7))}
            keyboardType="number-pad"
            maxLength={7}
            placeholder="Ej. 6301"
            placeholderTextColor={NEUTRAL_500}
            style={estilos.inputNumero}
            editable={letraValida}
            autoFocus={!!letraInicial && letraValida}
            accessibilityLabel="Primera hoja del talonario"
          />
        </View>
        <Text style={estilos.ayuda}>El número impreso en la primera hoja. El talonario trae {HOJAS} hojas.</Text>
      </Campo>

      {/* 3. Talonario que ya se venia usando antes de registrarlo en la app
          (solo el primero de cada empresa en el punto). */}
      {puedeEnUso ? (
        <Pressable
          onPress={() => setEnUso((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: enUso }}
          style={[estilos.enUso, enUso && estilos.enUsoActivo]}
        >
          <Ionicons name={enUso ? 'checkbox' : 'square-outline'} size={22} color={enUso ? ACENTO : NEUTRAL_500} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={estilos.enUsoTitulo}>Este talonario ya está en uso</Text>
            <Text style={estilos.ayuda}>Márcalo si ya se gastaron algunas hojas antes de registrarlo.</Text>
          </View>
        </Pressable>
      ) : null}

      {puedeEnUso && enUso ? (
        <Campo etiqueta="Siguiente hoja por usar">
          <View style={[estilos.campoNumero, numeroValido && !!siguiente && !siguienteValido && estilos.campoError]}>
            <Text style={estilos.prefijo}>{letra || '—'}</Text>
            <TextInput
              value={siguiente}
              onChangeText={(v) => setSiguiente(v.replace(/[^0-9]/g, '').slice(0, 7))}
              keyboardType="number-pad"
              maxLength={7}
              placeholder={numeroValido ? `Entre ${inicial} y ${final}` : 'Ej. 6335'}
              placeholderTextColor={NEUTRAL_500}
              style={estilos.inputNumero}
              accessibilityLabel="Siguiente hoja por usar"
            />
          </View>
          {numeroValido && siguiente && !siguienteValido ? (
            <Text style={styles.textoErrorInline}>
              Debe ser una hoja entre {letra} {inicial} y {letra} {final}.
            </Text>
          ) : null}
        </Campo>
      ) : null}

      {/* Resumen de lo que va a quedar registrado. */}
      {letraValida && numeroValido && siguienteValido && (!(puedeEnUso && enUso) || siguiente) ? (
        <View style={estilos.vista}>
          <View style={estilos.vistaFila}>
            <View style={{ alignItems: 'center' }}>
              <Text style={estilos.vistaEtiqueta}>Desde</Text>
              <Text style={estilos.vistaRango}>
                {letra} {inicial}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={NEUTRAL_500} />
            <View style={{ alignItems: 'center' }}>
              <Text style={estilos.vistaEtiqueta}>Hasta</Text>
              <Text style={estilos.vistaRango}>
                {letra} {final}
              </Text>
            </View>
          </View>
          <View style={estilos.vistaBarra}>
            <View style={[estilos.vistaBarraUsada, { width: `${((desde - inicial) / HOJAS) * 100}%` }]} />
          </View>
          <Text style={estilos.vistaPie}>
            {desde > inicial
              ? `Se empieza en la hoja ${letra} ${desde} · quedan ${final - desde + 1} de ${HOJAS}`
              : `${HOJAS} hojas disponibles`}
          </Text>
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
      </ScrollView>
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
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(245,197,66,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.45)',
  },
  vistaFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  vistaEtiqueta: { color: NEUTRAL_500, fontSize: 11.5, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.6 },
  vistaRango: { color: ACENTO, fontSize: 20, fontFamily: FUENTE_DISPLAY, letterSpacing: 0.5 },
  vistaBarra: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.10)' },
  vistaBarraUsada: { height: 6, backgroundColor: NEUTRAL_500 },
  vistaPie: { color: TEXTO_PRIMARIO, fontSize: 13, fontFamily: FUENTE_BODY_SEMI, textAlign: 'center' },
  ayuda: { color: NEUTRAL_500, fontSize: 12.5, fontFamily: FUENTE_BODY },
  empresa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  empresaActiva: { borderColor: ACENTO, backgroundColor: 'rgba(245,197,66,0.08)' },
  empresaNombre: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  empresaDetalle: { color: NEUTRAL_500, fontSize: 12.5, fontFamily: FUENTE_BODY },
  campoNumero: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    overflow: 'hidden',
  },
  campoError: { borderColor: '#f87171' },
  prefijo: {
    minWidth: 48,
    alignSelf: 'stretch',
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingTop: 13,
    color: ACENTO,
    fontSize: 18,
    fontFamily: FUENTE_DISPLAY,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRightWidth: 1,
    borderRightColor: NEUTRAL_700,
  },
  inputNumero: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXTO_PRIMARIO,
    fontFamily: FUENTE_DISPLAY,
    fontSize: 18,
    letterSpacing: 0.5,
  },
  enUso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  enUsoActivo: { borderColor: ACENTO, backgroundColor: 'rgba(245,197,66,0.06)' },
  enUsoTitulo: { color: TEXTO_PRIMARIO, fontSize: 14.5, fontFamily: FUENTE_BODY_SEMI },
});
