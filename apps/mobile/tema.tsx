// Tema visual compartido -- colores, fuentes, estilos y el par tipo/tabla de
// estado final. Extraido verbatim de App.tsx (sin cambios de logica/valores)
// al separar la navegacion en pantallas propias, para que cada pantalla
// nueva pueda importar los mismos tokens sin duplicarlos.
//
// Nota: el plan de ejecucion nombraba este archivo "tema.ts", pero incluye
// ContenidoBoton (un componente, con JSX) -- un archivo .ts no puede tener
// sintaxis JSX (TypeScript la interpreta como type assertion y falla el
// parseo). Se usa extension .tsx en su lugar; el contenido es idéntico al
// planeado, cero cambios de logica/valores.
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const NEUTRAL_900 = '#0f1520'; // fondo
export const NEUTRAL_850 = '#161d29'; // tarjetas
export const NEUTRAL_800 = '#1d2635'; // inputs / superficies elevadas
export const NEUTRAL_700 = '#2a3446'; // borde
export const BORDE_FUERTE = '#384158'; // borde de mas contraste (checkbox, foco)
export const NEUTRAL_500 = '#6b7688'; // texto terciario
export const NEUTRAL_400 = '#9aa3b5'; // texto secundario
export const TEXTO_PRIMARIO = '#f5f3ef'; // blanco calido, no #fff puro
export const ACENTO = '#c8631f';

// CSS inyectado dentro del <style> del WebView de <Signature> (ver
// h5/html.js del paquete) -- el fondo del canvas en si queda blanco
// (backgroundColor="#ffffff" en el uso mas abajo, asi la firma exportada se
// ve igual sin importar donde se abra despues), pero el resto del WebView
// (borde, footer, botones) sigue la paleta oscura del resto de la app.
export const ESTILO_WEB_FIRMA = `
  body, html { background-color: ${NEUTRAL_800}; }
  .m-signature-pad {
    box-shadow: none;
    border: 1px solid ${NEUTRAL_700};
    border-radius: 12px;
  }
  /* Footer propio del WebView (Borrar/Guardar) oculto -- esos botones los
     reemplazan los Pressable de VisorFirma via el ref (readSignature /
     clearSignature), que no dependen de que el footer HTML calce en el
     alto disponible (eso era justo lo que fallaba antes). */
  .m-signature-pad--footer { display: none; }
`;

// Space Grotesk para titulos/labels/numeros (caracter tecnico, va bien con
// cantidades); Manrope para texto de cuerpo (mas calido, legible en chico).
// Los pesos vienen del archivo de fuente en si -- no combinar con
// fontWeight numerico en los estilos de abajo, un font file cargado ya
// tiene un solo peso real.
export const FUENTE_DISPLAY = 'SpaceGrotesk_700Bold';
export const FUENTE_DISPLAY_SEMI = 'SpaceGrotesk_600SemiBold';
export const FUENTE_BODY = 'Manrope_400Regular';
export const FUENTE_BODY_MEDIA = 'Manrope_500Medium';
export const FUENTE_BODY_SEMI = 'Manrope_600SemiBold';
export const FUENTE_BODY_BOLD = 'Manrope_700Bold';

export const { width: ANCHO_PANTALLA, height: ALTO_PANTALLA } = Dimensions.get('window');

export const estilosVisorZoom = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#000000f2', alignItems: 'center', justifyContent: 'center' },
  botonCerrar: { position: 'absolute', top: 54, right: 20, zIndex: 10, padding: 6 },
  area: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  // backgroundColor blanco: sin efecto en fotos normales (son opacas), pero
  // evita que una firma (trazo sobre fondo transparente) se pierda contra
  // el fondo oscuro del visor.
  imagen: { width: ANCHO_PANTALLA, height: ALTO_PANTALLA * 0.82, backgroundColor: '#ffffff' },
  ayuda: {
    position: 'absolute',
    bottom: 36,
    color: NEUTRAL_400,
    fontSize: 12,
    fontFamily: FUENTE_BODY_SEMI,
  },
});

export const estilosFirma = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: NEUTRAL_900, padding: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titulo: { color: TEXTO_PRIMARIO, fontSize: 18, fontFamily: FUENTE_DISPLAY },
  subtitulo: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_MEDIA },
  // Sin altura fija adivinada -- ocupa todo el espacio disponible del
  // modal a pantalla completa (el problema anterior era justo un alto fijo
  // insuficiente, ver comentario en VisorFirma).
  canvas: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  error: { color: '#f87171', fontSize: 13, fontFamily: FUENTE_BODY_MEDIA },
  acciones: { flexDirection: 'row', gap: 10 },
  boton: {
    flex: 1,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  botonPrimario: { backgroundColor: ACENTO, borderColor: ACENTO },
});

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL_900,
  },
  scroll: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { marginTop: 8, marginBottom: 4, gap: 4 },
  headerFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonVolverHeader: { marginRight: 2 },
  recuadroIdentidad: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  recuadroFila: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  recuadroEmpleadoTexto: { color: NEUTRAL_400, fontSize: 11.5, fontFamily: FUENTE_BODY_SEMI, flexShrink: 1 },
  recuadroSedeTexto: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_DISPLAY, flexShrink: 1 },
  cerrarSesion: { color: '#f87171', fontSize: 12, fontFamily: FUENTE_BODY_SEMI, marginTop: 6 },
  cerrarSesionDeshabilitado: { color: NEUTRAL_500 },
  tarjeta: {
    backgroundColor: NEUTRAL_850,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    padding: 18,
    gap: 12,
    // Sombra ambiente para despegar la tarjeta del fondo -- shadow* para
    // iOS, elevation para Android (RN no comparte una sola propiedad).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 6,
  },
  etiquetaSeccion: {
    color: NEUTRAL_500,
    fontSize: 11,
    fontFamily: FUENTE_DISPLAY_SEMI,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  badgeIdentificador: {
    color: ACENTO,
    fontSize: 12,
    fontFamily: FUENTE_BODY_SEMI,
    backgroundColor: 'rgba(200,99,31,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  itemDescripcion: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_BOLD },
  inputDescripcion: {
    borderBottomWidth: 1.5,
    borderBottomColor: ACENTO,
    paddingVertical: 2,
  },
  inputCantidadLeida: {
    minWidth: 56,
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  textoErrorInline: { color: '#f87171', fontSize: 13, fontFamily: FUENTE_BODY_MEDIA },
  inputCantidad: {
    borderWidth: 1.5,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXTO_PRIMARIO,
    fontSize: 17,
    fontFamily: FUENTE_DISPLAY_SEMI,
  },
  inputCantidadBloqueado: { opacity: 0.5 },
  inputCantidadError: { borderColor: '#f87171' },
  checkboxFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxCaja: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.6,
    borderColor: BORDE_FUERTE,
    backgroundColor: NEUTRAL_800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCajaMarcada: { backgroundColor: ACENTO, borderColor: ACENTO },
  checkboxTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI, flexShrink: 1 },
  filaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filaAccionesItem: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  filaConIcono: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inputNota: {
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXTO_PRIMARIO,
    fontSize: 13,
    fontFamily: FUENTE_BODY,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  notaPreviewFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notaPreview: { color: NEUTRAL_400, fontSize: 13, fontStyle: 'italic', flexShrink: 1 },
  // Caja propia para la nota a nivel documento (PantallaConfirmando) --
  // mismo criterio visual que devolucionCaja/historialCaja para marcar un
  // sub-bloque distinto dentro de la tarjeta, asi no se confunde con las
  // notas por producto de la lista de abajo.
  notaGeneralCaja: {
    gap: 6,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  devolucionCaja: {
    gap: 9,
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  chipsEnvoltorio: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  historialCaja: {
    gap: 6,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  historialFila: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  historialFecha: { color: NEUTRAL_500, fontSize: 11, fontFamily: FUENTE_DISPLAY_SEMI, fontVariant: ['tabular-nums'] },
  historialTexto: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY, flexShrink: 1 },
  selectorSedesContenido: { gap: 8, paddingRight: 4 },
  chipSede: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  chipSedeActiva: { backgroundColor: ACENTO, borderColor: ACENTO },
  chipSedeFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipSedeTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_BOLD },
  chipSedeTextoActivo: { color: TEXTO_PRIMARIO },
  preview: { width: '100%', height: 300, borderRadius: 14, backgroundColor: NEUTRAL_800 },
  iconoAmpliar: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#00000099',
    borderRadius: 999,
    padding: 6,
  },
  previewVacio: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BORDE_FUERTE,
    borderStyle: 'dashed',
    gap: 4,
  },
  previewTexto: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY_SEMI, marginTop: 4 },
  previewSubtexto: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY },
  estadoBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mensajeSubiendo: { color: NEUTRAL_400, fontSize: 14, fontFamily: FUENTE_BODY, flexShrink: 1 },
  badgeEstado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    padding: 16,
  },
  badgeEstadoTitulo: { fontSize: 14, fontFamily: FUENTE_DISPLAY_SEMI },
  badgeEstadoMensaje: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY, marginTop: 2 },
  acciones: { gap: 10, marginTop: 4 },
  boton: {
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  botonPresionado: { opacity: 0.75 },
  botonDeshabilitado: { opacity: 0.4 },
  botonPrimario: { backgroundColor: ACENTO, borderColor: ACENTO },
  botonTexto: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_DISPLAY_SEMI, fontSize: 15 },
  botonContenido: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

// Definido aca (no en EntregaContext.tsx) porque ESTADO_INFO -- tabla
// puramente visual icono/texto/color -- lo necesita como key; asi tema.tsx
// no depende de EntregaContext.tsx.
export type EstadoFinal = 'procesada' | 'pendiente_revision' | 'error';

export const ESTADO_INFO: Record<
  EstadoFinal,
  { icono: keyof typeof Ionicons.glyphMap; texto: string; color: string; fondo: string }
> = {
  procesada: { icono: 'checkmark-circle', texto: 'Procesada', color: '#34d399', fondo: 'rgba(52,211,153,0.12)' },
  pendiente_revision: {
    icono: 'search',
    texto: 'Pendiente de revisión',
    color: '#fbbf24',
    fondo: 'rgba(251,191,36,0.12)',
  },
  error: { icono: 'warning', texto: 'Error', color: '#f87171', fondo: 'rgba(248,113,113,0.12)' },
};

// Contenido icono+texto reusado en todos los botones -- iconos de
// @expo/vector-icons en vez de emojis, mismo look consistente en toda la app.
export function ContenidoBoton({
  icono,
  texto,
  color = TEXTO_PRIMARIO,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  texto: string;
  color?: string;
}) {
  return (
    <View style={styles.botonContenido}>
      <Ionicons name={icono} size={18} color={color} />
      <Text style={[styles.botonTexto, { color }]}>{texto}</Text>
    </View>
  );
}
