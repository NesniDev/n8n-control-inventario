// Fila de un reporte de factura faltante (tipo + numero, quien la reporto y
// hace cuanto) con acciones opcionales. Variantes: pendiente con "Descartar"
// (bodeguero, sus propios reportes); pendiente con "Ya la subi" + "Descartar"
// (mostrador); y resuelta ("Ya subida por ...", sin acciones). La comparten
// PantallaFacturasFaltantes (bodeguero) y TarjetaFacturasPorSubir (mostrador);
// esta ultima usa la variante `compacta` (una sola linea, ver FilaCompacta).
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { descartarFacturaFaltante, marcarFacturaSubida, type FacturaFaltante } from './api';
import { esErrorFacturaNoRegistrada, mensajeError } from './errorMessages';
import { haceCuanto } from './SelectorFecha';
import { FUENTE_BODY, FUENTE_BODY_SEMI, FUENTE_DISPLAY, NEUTRAL_500, NEUTRAL_700, TEXTO_PRIMARIO } from './tema';

const ROJO = '#f87171';
const VERDE = '#34d399';

/**
 * Pide confirmacion y descarta el reporte. `alTerminar` se llama al terminar
 * (para recargar la lista); si fallo, antes se avisa con un Alert.
 */
export function confirmarDescartarFactura(f: FacturaFaltante, empleadoId: string, alTerminar: () => void) {
  Alert.alert(
    'Descartar reporte',
    `¿Quieres descartar el reporte de la factura ${f.tipo} ${f.indicativo_numero}?`,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          try {
            await descartarFacturaFaltante(f.id, empleadoId);
          } catch (err) {
            Alert.alert('No se pudo descartar', mensajeError(err, 'factura_faltante'), [{ text: 'Entendido' }]);
          }
          // Tambien tras un error: un 409 ("ya estaba cerrado") significa que la
          // lista estaba desactualizada, y recargar la deja al dia.
          alTerminar();
        },
      },
    ]
  );
}

/**
 * Pide confirmacion y marca la factura como ya subida (el backend verifica que
 * exista en entregas). `alTerminar` recarga la lista, tambien tras un error.
 */
export function confirmarMarcarSubida(f: FacturaFaltante, empleadoId: string, alTerminar: () => void) {
  Alert.alert('Ya la subí', `¿Ya subiste la factura ${f.tipo} ${f.indicativo_numero}?`, [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Sí, ya la subí',
      onPress: async () => {
        try {
          await marcarFacturaSubida(f.id, empleadoId);
        } catch (err) {
          if (esErrorFacturaNoRegistrada(err)) {
            const detalle = (err as { detail?: unknown }).detail;
            Alert.alert('Todavía no aparece', typeof detalle === 'string' ? detalle : 'Sube la foto de la factura primero.', [
              { text: 'Entendido' },
            ]);
          } else {
            Alert.alert('No se pudo marcar', mensajeError(err, 'factura_faltante'), [{ text: 'Entendido' }]);
          }
        }
        alTerminar();
      },
    },
  ]);
}

export default function FilaFacturaFaltante({
  factura,
  sedeMiaId,
  onMarcarSubida,
  onDescartar,
  compacta = false,
}: {
  factura: FacturaFaltante;
  // Sede de quien mira la lista: define si la fila muestra "Para X" (el reporte
  // va a otra sede) o "Desde X" (lo reporto otra sede hacia la mia).
  sedeMiaId: string;
  // Mostrador: accion principal "Ya la subi" (solo en filas pendientes).
  onMarcarSubida?: () => void;
  // Sin esto no se muestra la accion "Descartar".
  onDescartar?: () => void;
  // Fila de una linea para el banner del mostrador (TarjetaFacturasPorSubir).
  compacta?: boolean;
}) {
  const reportante = factura.sede_reporta_id ?? factura.sede_id;
  let sedeTexto = '';
  if (factura.sede_id !== sedeMiaId) {
    sedeTexto = `Para ${factura.sede_nombre ?? 'otra sede'} · `;
  } else if (reportante !== factura.sede_id) {
    sedeTexto = `Desde ${factura.sede_reporta_nombre ?? 'otra sede'} · `;
  }
  if (compacta) {
    return <FilaCompacta factura={factura} sedeTexto={sedeTexto} onMarcarSubida={onMarcarSubida} onDescartar={onDescartar} />;
  }
  if (factura.estado === 'resuelta') {
    return (
      <View style={estilos.fila}>
        <Ionicons name="checkmark-circle" size={22} color={VERDE} />
        <View style={estilos.textos}>
          <Text style={estilos.documento}>
            {factura.tipo} {factura.indicativo_numero}
          </Text>
          <Text style={[estilos.detalle, { color: VERDE }]} numberOfLines={2}>
            Ya subida por {factura.sede_nombre ?? 'el punto de venta'}
            {factura.cerrada_por_nombre ? ` · ${factura.cerrada_por_nombre}` : ''}
            {factura.cerrada_at ? ` · ${haceCuanto(factura.cerrada_at)}` : ''}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={estilos.fila}>
      <View style={estilos.textos}>
        <Text style={estilos.documento}>
          {factura.tipo} {factura.indicativo_numero}
        </Text>
        <Text style={estilos.detalle} numberOfLines={2}>
          {sedeTexto}
          {factura.reportado_por_nombre ? `Reportada por ${factura.reportado_por_nombre} · ` : 'Reportada '}
          {haceCuanto(factura.reportado_at)}
        </Text>
      </View>
      {onMarcarSubida || onDescartar ? (
        <View style={estilos.acciones}>
          {onMarcarSubida ? (
            <Pressable
              onPress={onMarcarSubida}
              hitSlop={8}
              style={({ pressed }) => [estilos.marcar, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`Ya subí la factura ${factura.tipo} ${factura.indicativo_numero}`}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color={VERDE} />
              <Text style={estilos.marcarTexto}>Ya la subí</Text>
            </Pressable>
          ) : null}
          {onDescartar ? (
            <Pressable
              onPress={onDescartar}
              hitSlop={8}
              style={({ pressed }) => [estilos.descartar, onMarcarSubida && estilos.descartarSecundario, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`Descartar reporte de ${factura.tipo} ${factura.indicativo_numero}`}
            >
              <Ionicons name="close-circle-outline" size={onMarcarSubida ? 14 : 16} color={ROJO} />
              <Text style={[estilos.descartarTexto, onMarcarSubida && { fontSize: 11 }]}>Descartar</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// Una linea: documento + quien/cuando a la izquierda, "Ya" y una X chica a la
// derecha. Descartar queda como icono discreto (solo para numeros mal escritos).
function FilaCompacta({
  factura,
  sedeTexto,
  onMarcarSubida,
  onDescartar,
}: {
  factura: FacturaFaltante;
  sedeTexto: string;
  onMarcarSubida?: () => void;
  onDescartar?: () => void;
}) {
  return (
    <View style={estilos.filaCompacta}>
      <View style={estilos.textos}>
        <Text style={estilos.documentoCompacto} numberOfLines={1}>
          {factura.tipo} {factura.indicativo_numero}
        </Text>
        <Text style={estilos.detalle} numberOfLines={1}>
          {sedeTexto}
          {factura.reportado_por_nombre ? `${factura.reportado_por_nombre} · ` : ''}
          {haceCuanto(factura.reportado_at)}
        </Text>
      </View>
      {onMarcarSubida ? (
        <Pressable
          onPress={onMarcarSubida}
          hitSlop={6}
          style={({ pressed }) => [estilos.marcarCompacto, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Ya subí la factura ${factura.tipo} ${factura.indicativo_numero}`}
        >
          <Ionicons name="checkmark" size={16} color={VERDE} />
          <Text style={estilos.marcarTexto}>Ya</Text>
        </Pressable>
      ) : null}
      {onDescartar ? (
        <Pressable
          onPress={onDescartar}
          hitSlop={10}
          style={({ pressed }) => [estilos.descartarIcono, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Descartar reporte de ${factura.tipo} ${factura.indicativo_numero}`}
        >
          <Ionicons name="close" size={16} color={NEUTRAL_500} />
        </Pressable>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: NEUTRAL_700,
  },
  textos: { flex: 1, gap: 2 },
  documento: { color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_DISPLAY },
  detalle: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY },
  acciones: { alignItems: 'flex-end', gap: 6 },
  marcar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.5)',
    backgroundColor: 'rgba(52,211,153,0.12)',
  },
  marcarTexto: { color: VERDE, fontSize: 14, fontFamily: FUENTE_BODY_SEMI },
  descartarSecundario: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 0 },
  descartar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
  },
  descartarTexto: { color: ROJO, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  filaCompacta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: NEUTRAL_700,
  },
  documentoCompacto: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_DISPLAY },
  marcarCompacto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.5)',
    backgroundColor: 'rgba(52,211,153,0.12)',
  },
  descartarIcono: { padding: 4 },
});
