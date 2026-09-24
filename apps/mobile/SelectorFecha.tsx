// Selector de fecha en JS puro (calendario mensual en una HojaModal) -- a
// proposito sin @react-native-community/datetimepicker: esa libreria trae
// codigo nativo, cambia el fingerprint y obligaria a generar e instalar un
// .apk nuevo en cada celular; asi sigue llegando por EAS Update (OTA).
// El valor viaja como "AAAA-MM-DD" (mismo formato que espera el backend en
// TrasladoPuntoCrear.fecha), siempre en fecha LOCAL del celular.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HojaModal from './HojaModal';
import {
  ACENTO,
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY_SEMI,
  NEUTRAL_400,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  TEXTO_PRIMARIO,
} from './tema';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const dosDigitos = (n: number) => String(n).padStart(2, '0');

export function aTextoFecha(fecha: Date): string {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

function desdeTextoFecha(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

// "mié 23 sep 2026" -- lo que se muestra en el campo, en vez del AAAA-MM-DD.
export function formatearFechaLarga(valor: string): string {
  const fecha = desdeTextoFecha(valor);
  if (!fecha) return valor;
  return `${DIAS_CORTOS[fecha.getDay()]} ${fecha.getDate()} ${MESES[fecha.getMonth()].slice(0, 3)} ${fecha.getFullYear()}`;
}

// "hace 5 min" / "hace 3 h" / "ayer" -- para mostrar cuanto hace que se
// envio o recibio un traslado (Inicio y Bandeja).
export function haceCuanto(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}

// Celdas del mes: null para los huecos antes del dia 1 (semana arranca en lunes).
function celdasDelMes(anio: number, mes: number): (number | null)[] {
  const offset = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();
  return [...Array<null>(offset).fill(null), ...Array.from({ length: diasEnMes }, (_, i) => i + 1)];
}

export default function SelectorFecha({
  visible,
  valor,
  onElegir,
  onCerrar,
}: {
  visible: boolean;
  valor: string;
  onElegir: (valor: string) => void;
  onCerrar: () => void;
}) {
  const seleccionada = desdeTextoFecha(valor) ?? new Date();
  const [mesVisible, setMesVisible] = useState({ anio: seleccionada.getFullYear(), mes: seleccionada.getMonth() });
  const hoy = aTextoFecha(new Date());

  const moverMes = (delta: number) => {
    setMesVisible(({ anio, mes }) => {
      const nueva = new Date(anio, mes + delta, 1);
      return { anio: nueva.getFullYear(), mes: nueva.getMonth() };
    });
  };

  const elegir = (texto: string) => {
    onElegir(texto);
    onCerrar();
  };

  const celdas = celdasDelMes(mesVisible.anio, mesVisible.mes);

  return (
    <HojaModal visible={visible} titulo="Fecha del traslado" onCerrar={onCerrar}>
      <View style={estilos.navegacionMes}>
        <Pressable onPress={() => moverMes(-1)} hitSlop={10} style={estilos.botonMes}>
          <Ionicons name="chevron-back" size={22} color={TEXTO_PRIMARIO} />
        </Pressable>
        <Text style={estilos.tituloMes}>
          {MESES[mesVisible.mes].charAt(0).toUpperCase() + MESES[mesVisible.mes].slice(1)} {mesVisible.anio}
        </Text>
        <Pressable onPress={() => moverMes(1)} hitSlop={10} style={estilos.botonMes}>
          <Ionicons name="chevron-forward" size={22} color={TEXTO_PRIMARIO} />
        </Pressable>
      </View>

      <View style={estilos.grilla}>
        {DIAS_SEMANA.map((d, i) => (
          <Text key={`c${i}`} style={estilos.cabeceraDia}>
            {d}
          </Text>
        ))}
        {celdas.map((dia, i) => {
          if (dia === null) return <View key={`v${i}`} style={estilos.celda} />;
          const texto = `${mesVisible.anio}-${dosDigitos(mesVisible.mes + 1)}-${dosDigitos(dia)}`;
          const activa = texto === valor;
          const esHoy = texto === hoy;
          return (
            <Pressable key={texto} style={estilos.celda} onPress={() => elegir(texto)}>
              <View style={[estilos.circulo, esHoy && estilos.circuloHoy, activa && estilos.circuloActivo]}>
                <Text style={[estilos.numeroDia, activa && estilos.numeroDiaActivo]}>{dia}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={({ pressed }) => [estilos.botonHoy, pressed && { opacity: 0.75 }]} onPress={() => elegir(hoy)}>
        <Ionicons name="today-outline" size={18} color={ACENTO} />
        <Text style={estilos.botonHoyTexto}>Hoy</Text>
      </Pressable>
    </HojaModal>
  );
}

const estilos = StyleSheet.create({
  navegacionMes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  botonMes: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: NEUTRAL_800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tituloMes: { color: TEXTO_PRIMARIO, fontSize: 16, fontFamily: FUENTE_DISPLAY_SEMI },
  grilla: { flexDirection: 'row', flexWrap: 'wrap' },
  cabeceraDia: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: NEUTRAL_500,
    fontSize: 12,
    fontFamily: FUENTE_BODY_SEMI,
    paddingBottom: 6,
  },
  celda: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  circulo: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  circuloHoy: { borderWidth: 1.5, borderColor: NEUTRAL_700 },
  circuloActivo: { backgroundColor: ACENTO, borderColor: ACENTO },
  numeroDia: { color: NEUTRAL_400, fontSize: 15, fontFamily: FUENTE_BODY },
  numeroDiaActivo: { color: TEXTO_PRIMARIO, fontFamily: FUENTE_BODY_SEMI },
  botonHoy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
    backgroundColor: NEUTRAL_800,
  },
  botonHoyTexto: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
});
