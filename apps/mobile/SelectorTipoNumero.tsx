// Selector controlado de tipo de documento (chips + "Otro" libre) y de
// indicativo/numero -- compartido por PantallaBuscar (consultar factura) y
// PantallaFacturasFaltantes (reportar factura no subida). El estado vive en
// la pantalla que lo usa; aca solo se pinta y se avisa de los cambios.
import { Fragment, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { NEUTRAL_400, NEUTRAL_500, styles } from './tema';

// FEI/FV1 son de Sede Centro, EDP/EDV de Polo Sur (ver _TIPO_SEDE_DUENA en
// duplicates.py); TB9/RM3/RM2/RSF no tienen sede duena. Solo sugerencia rapida
// para los chips -- se puede escribir cualquier otro tipo con el chip "+ Otro".
export const TIPOS_DOCUMENTO = ['FEI', 'FV1', 'EDP', 'EDV', 'TB9', 'RM3', 'RM2', 'RSF'] as const;
// Remisiones solo maneja RM3/RM2/RSF (ver flujo en EntregaContext) y Despachos el resto.
export const TIPOS_REMISION: readonly string[] = ['RM3', 'RM2', 'RSF'];

/** Tipos sugeridos segun el flujo: remisiones (RM3/RM2/RSF) o despachos (el resto). */
export function tiposPorFlujo(esRemision: boolean): string[] {
  return TIPOS_DOCUMENTO.filter((t) => TIPOS_REMISION.includes(t) === esRemision);
}

type Props = {
  tipo: string;
  setTipo: (v: string) => void;
  tipoCustom: boolean;
  setTipoCustom: (v: boolean) => void;
  numero: string;
  setNumero: (v: string) => void;
  tipos: readonly string[];
  // false: sin chip "+ Otro" (remisiones solo maneja RM3/RM2/RSF).
  permitirOtro?: boolean;
  // true (default): cada campo va en su propia tarjeta (PantallaBuscar). false:
  // sin tarjeta, para meterlo dentro de otra (PantallaFacturasFaltantes).
  conTarjetas?: boolean;
  // Placeholder del input de numero.
  placeholderNumero?: string;
  editable?: boolean;
};

export default function SelectorTipoNumero({
  tipo,
  setTipo,
  tipoCustom,
  setTipoCustom,
  numero,
  setNumero,
  tipos,
  permitirOtro = true,
  conTarjetas = true,
  placeholderNumero = 'Ej: 10254',
  editable = true,
}: Props) {
  // Funcion y no componente anidado: un componente definido aca se
  // remontaria en cada render y el TextInput perderia el foco al teclear.
  const envolver = (children: ReactNode) =>
    conTarjetas ? <View style={styles.tarjeta}>{children}</View> : <View style={estilos.grupo}>{children}</View>;

  return (
    <Fragment>
      {envolver(
        <>
        <View style={styles.filaConIcono}>
          <Ionicons name="pricetags-outline" size={15} color={NEUTRAL_400} />
          <Text style={styles.etiquetaSeccion}>Tipo de documento</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.selectorSedesContenido}
        >
          {tipos.map((t) => {
            const activo = !tipoCustom && tipo === t;
            return (
              <Pressable
                key={t}
                disabled={!editable}
                onPress={() => {
                  setTipoCustom(false);
                  setTipo(t);
                }}
                style={[styles.chipSede, estilos.chipTipo, activo && styles.chipSedeActiva]}
              >
                <Text style={[styles.chipSedeTexto, activo && styles.chipSedeTextoActivo]}>{t}</Text>
              </Pressable>
            );
          })}
          {permitirOtro ? (
            <Pressable
              disabled={!editable}
              onPress={() => {
                setTipoCustom(true);
                setTipo('');
              }}
              style={[styles.chipSede, estilos.chipTipo, styles.chipSedeFila, tipoCustom && styles.chipSedeActiva]}
            >
              <Ionicons name="add-outline" size={14} color={tipoCustom ? '#fff' : NEUTRAL_400} />
              <Text style={[styles.chipSedeTexto, tipoCustom && styles.chipSedeTextoActivo]}>Otro</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {tipoCustom ? (
          <TextInput
            value={tipo}
            onChangeText={(texto) => setTipo(texto.toUpperCase())}
            placeholder="Escribe el tipo (ej: OT, NC)"
            placeholderTextColor={NEUTRAL_500}
            autoCapitalize="characters"
            editable={editable}
            style={styles.inputCantidad}
          />
        ) : null}
        </>
      )}

      {envolver(
        <>
        <View style={styles.filaConIcono}>
          <Ionicons name="barcode-outline" size={15} color={NEUTRAL_400} />
          <Text style={styles.etiquetaSeccion}>Indicativo / número</Text>
        </View>
        <View style={estilos.inputConIcono}>
          <Ionicons name="search" size={18} color={NEUTRAL_500} style={estilos.inputIcono} />
          <TextInput
            value={numero}
            onChangeText={setNumero}
            placeholder={placeholderNumero}
            placeholderTextColor={NEUTRAL_500}
            keyboardType="number-pad"
            editable={editable}
            style={[styles.inputCantidad, estilos.inputConIconoTexto]}
          />
        </View>
        </>
      )}
    </Fragment>
  );
}

const estilos = StyleSheet.create({
  grupo: { gap: 12 },
  chipTipo: { minWidth: 54, alignItems: 'center' },
  inputConIcono: { position: 'relative', justifyContent: 'center' },
  inputIcono: { position: 'absolute', left: 14, zIndex: 1 },
  inputConIconoTexto: { paddingLeft: 40 },
});
