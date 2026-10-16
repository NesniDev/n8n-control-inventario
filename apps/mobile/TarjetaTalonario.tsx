// Tarjeta de los talonarios activos del punto (uno por letra, p. ej. A general
// y V veterinaria en paralelo): empresa, siguiente hoja, cuantas quedan y una
// barra de uso, con avisos cuando quedan pocas o ya se agoto. Sin talonario
// invita a configurarlo. Se muestra en la tab Inicio (solo sesiones de punto);
// la tab Traslados solo consulta los talonarios para bloquear "Nuevo traslado".
// Carga su propio dato (siempre fresco al volver a la pantalla) y trae los
// modales de configurar y anular hoja.
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { fetchTalonariosPunto, type TalonarioPunto } from './api';
import {
  datosEmpresa,
  EMPRESAS_TALONARIO,
  InsigniaEmpresa,
  ModalAnularHoja,
  ModalConfigurarTalonario,
  rangoCorto,
} from './ModalTalonario';
import { FUENTE_BODY, FUENTE_BODY_SEMI, FUENTE_DISPLAY, NEUTRAL_400, NEUTRAL_500, TEXTO_PRIMARIO } from './tema';
import { MARCA } from './vidrio';

// Mismas superficies que las tarjetas de Inicio (PantallaInicio.tsx).
const SUPERFICIE = '#0f2350';
const BORDE_SUPERFICIE = 'rgba(255,255,255,0.08)';
const ROJO = '#f87171';

// Estado del talonario: color + texto + icono (el color nunca va solo).
function estadoDe(t: TalonarioPunto) {
  if (t.agotado) return { texto: 'Agotado', icono: 'alert-circle' as const, color: ROJO };
  if (t.quedan <= t.umbral_aviso) return { texto: 'Pocas hojas', icono: 'warning' as const, color: MARCA.oro };
  return { texto: 'Activo', icono: 'checkmark-circle' as const, color: '#4ade80' };
}

function FilaTalonario({
  talonario,
  onAnular,
  onCambiar,
}: {
  talonario: TalonarioPunto;
  onAnular: () => void;
  onCambiar: () => void;
}) {
  const empresa = datosEmpresa(talonario.letra);
  const estado = estadoDe(talonario);
  const total = talonario.numero_final - talonario.numero_inicial + 1;
  const usadas = total - talonario.quedan;
  const alerta = estado.texto !== 'Activo';

  const tono = empresa?.claro ?? MARCA.oro;

  return (
    <View style={[estilos.tarjeta, estilos.tarjetaActiva, alerta && { borderColor: `${estado.color}73` }]}>
      {/* Encabezado: quien es (empresa + letra) y en que estado esta. */}
      <View style={estilos.encabezado}>
        <InsigniaEmpresa letra={talonario.letra} tamano={34} />
        <View style={{ flex: 1 }}>
          <Text style={estilos.empresa} numberOfLines={1}>
            {empresa?.nombre ?? 'Talonario'}
          </Text>
          <Text style={estilos.rango}>Hojas {rangoCorto(talonario)}</Text>
        </View>
        <View style={[estilos.estado, { backgroundColor: `${estado.color}1f` }]}>
          <Ionicons name={estado.icono} size={12} color={estado.color} />
          <Text style={[estilos.estadoTexto, { color: estado.color }]}>{estado.texto}</Text>
        </View>
      </View>

      {/* Dato principal: la hoja que toca fotografiar ahora y cuantas quedan,
          en dos columnas iguales y centradas, con la barra de uso debajo. */}
      <View style={estilos.siguiente}>
        <View style={estilos.datos}>
          <View style={estilos.columna}>
            <Text style={estilos.etiqueta}>Siguiente hoja</Text>
            <Text
              style={[estilos.hoja, { color: talonario.agotado ? ROJO : tono }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {talonario.agotado ? 'Sin hojas' : talonario.siguiente_hoja}
            </Text>
          </View>
          <View style={estilos.divisor} />
          <View style={estilos.columna}>
            <Text style={estilos.etiqueta}>Quedan</Text>
            <Text style={[estilos.quedan, alerta && { color: estado.color }]}>
              {talonario.quedan}
              <Text style={estilos.quedanTotal}> / {total}</Text>
            </Text>
          </View>
        </View>
        <View style={estilos.barraFondo}>
          <View
            style={[
              estilos.barraRelleno,
              { width: `${(usadas / total) * 100}%`, backgroundColor: alerta ? estado.color : tono },
            ]}
          />
        </View>
      </View>

      {/* Pie: aviso o progreso a la izquierda y acciones compactas a la derecha
          (hitSlop lleva el area tactil a 44 px aunque el boton se vea pequeno). */}
      <View style={estilos.pie}>
        <Text
          style={[estilos.ayuda, estilos.pieTexto, alerta && { color: estado.color, fontFamily: FUENTE_BODY_SEMI }]}
          numberOfLines={2}
        >
          {talonario.agotado
            ? 'Pide un talonario nuevo.'
            : alerta
              ? 'Quedan pocas hojas.'
              : `${usadas} de ${total} usadas`}
        </Text>
        {talonario.agotado ? null : (
          <Pressable
            onPress={onAnular}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Anular la hoja ${talonario.siguiente_hoja}`}
            style={({ pressed }) => [estilos.accion, pressed && estilos.presionado]}
          >
            <Ionicons name="close-circle-outline" size={15} color={NEUTRAL_400} />
            <Text style={estilos.accionTexto}>Anular</Text>
          </Pressable>
        )}
        <Pressable
          onPress={onCambiar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Cambiar talonario de ${empresa?.nombre ?? talonario.letra}`}
          style={({ pressed }) => [
            estilos.accion,
            talonario.agotado
              ? estilos.accionPrimaria
              : { borderColor: `${tono}66`, backgroundColor: `${tono}14` },
            pressed && estilos.presionado,
          ]}
        >
          <Ionicons name="swap-horizontal" size={15} color={talonario.agotado ? MARCA.tinta : tono} />
          <Text style={[estilos.accionTexto, { color: talonario.agotado ? MARCA.tinta : tono }]}>
            {talonario.agotado ? 'Cambiar talonario' : 'Cambiar'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function TarjetaTalonario({
  puntoId,
  usuarioId,
  onCambio,
}: {
  puntoId: string;
  usuarioId: string;
  /** Se llama despues de configurar o anular, con los talonarios resultantes. */
  onCambio?: (talonarios: TalonarioPunto[]) => void;
}) {
  // undefined = todavia no se sabe (cargando o fallo la consulta: no se muestra
  // nada); [] = sin talonarios.
  const [talonarios, setTalonarios] = useState<TalonarioPunto[] | undefined>(undefined);
  // Modal de configurar abierto: letra a precargar ('' = talonario nuevo).
  const [configurando, setConfigurando] = useState<string | null>(null);
  // Talonario cuya siguiente hoja se esta anulando.
  const [anulando, setAnulando] = useState<TalonarioPunto | null>(null);

  // Los talonarios cambian con cada traslado creado: siempre frescos al volver aqui.
  useFocusEffect(
    useCallback(() => {
      let vigente = true;
      fetchTalonariosPunto(puntoId, { forzar: true })
        .then((lista) => vigente && setTalonarios(lista))
        .catch(() => {});
      return () => {
        vigente = false;
      };
    }, [puntoId])
  );

  // Tras configurar o anular se vuelve a pedir la lista: asi se ven todas las letras.
  const cambio = () => {
    fetchTalonariosPunto(puntoId, { forzar: true })
      .then((lista) => {
        setTalonarios(lista);
        onCambio?.(lista);
      })
      .catch(() => {});
  };

  const modales = (
    <>
      <ModalConfigurarTalonario
        visible={configurando !== null}
        puntoId={puntoId}
        usuarioId={usuarioId}
        talonarios={talonarios ?? []}
        letraInicial={configurando || undefined}
        onCerrar={() => setConfigurando(null)}
        onListo={() => {
          cambio();
          setConfigurando(null);
        }}
      />
      <ModalAnularHoja
        visible={anulando !== null}
        puntoId={puntoId}
        usuarioId={usuarioId}
        talonario={anulando}
        onCerrar={() => setAnulando(null)}
        onListo={() => {
          cambio();
          setAnulando(null);
        }}
      />
    </>
  );

  if (talonarios === undefined) return null;

  // Empresas que todavia no tienen talonario activo en el punto.
  const faltantes = EMPRESAS_TALONARIO.filter((e) => !talonarios.some((t) => t.letra === e.letra));

  if (talonarios.length === 0) {
    // Sin talonario: tarjeta que invita a configurarlo, con las empresas posibles.
    return (
      <>
        <Pressable
          onPress={() => setConfigurando('')}
          accessibilityRole="button"
          accessibilityLabel="Configura tu talonario. Necesario para crear traslados."
          style={({ pressed }) => [estilos.tarjeta, estilos.vacia, pressed && estilos.presionado]}
        >
          <View style={estilos.encabezado}>
            <View style={estilos.iconoVacio}>
              <Ionicons name="receipt-outline" size={20} color={MARCA.tinta} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilos.empresa}>Configura tu talonario</Text>
              <Text style={estilos.ayuda}>Necesario para crear traslados</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={MARCA.oro} />
          </View>
          <View style={estilos.empresasVacia}>
            {EMPRESAS_TALONARIO.map((e) => (
              <View key={e.letra} style={estilos.empresaVacia}>
                <InsigniaEmpresa letra={e.letra} tamano={22} />
                <Text style={estilos.empresaVaciaTexto} numberOfLines={1}>
                  {e.corto}
                </Text>
              </View>
            ))}
          </View>
        </Pressable>
        {modales}
      </>
    );
  }

  return (
    <>
      <View style={{ gap: 10 }}>
        {talonarios.map((talonario) => (
          <FilaTalonario
            key={talonario.id}
            talonario={talonario}
            onAnular={() => setAnulando(talonario)}
            onCambiar={() => setConfigurando(talonario.letra)}
          />
        ))}

        {/* Otro talonario en paralelo; se oculta cuando todas las empresas ya
            tienen el suyo, y nombra a la que falta si es una sola. */}
        {faltantes.length > 0 ? (
          <Pressable
            onPress={() => setConfigurando('')}
            accessibilityRole="button"
            accessibilityLabel={
              faltantes.length === 1 ? `Agregar talonario de ${faltantes[0].nombre}` : 'Agregar talonario'
            }
            style={({ pressed }) => [estilos.agregar, pressed && estilos.presionado]}
          >
            {faltantes.length === 1 ? (
              <InsigniaEmpresa letra={faltantes[0].letra} tamano={22} />
            ) : (
              <Ionicons name="add-circle-outline" size={20} color={MARCA.oro} />
            )}
            <Text style={estilos.agregarTexto}>
              {faltantes.length === 1 ? `Agregar talonario de ${faltantes[0].corto}` : 'Agregar talonario'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {modales}
    </>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    borderRadius: 18,
    backgroundColor: SUPERFICIE,
    borderWidth: 1,
    borderColor: BORDE_SUPERFICIE,
  },
  tarjetaActiva: { gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  presionado: { opacity: 0.75 },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  empresa: { color: TEXTO_PRIMARIO, fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  rango: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY },
  estado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  estadoTexto: { fontSize: 12, fontFamily: FUENTE_BODY_SEMI },
  siguiente: {
    gap: 10,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  datos: { flexDirection: 'row', alignItems: 'center' },
  columna: { flex: 1, alignItems: 'center', gap: 2 },
  divisor: { width: 1, alignSelf: 'stretch', marginVertical: 4, backgroundColor: 'rgba(255,255,255,0.10)' },
  etiqueta: { color: NEUTRAL_500, fontSize: 11, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.6 },
  hoja: { fontSize: 22, fontFamily: FUENTE_DISPLAY, lineHeight: 28, textAlign: 'center' },
  quedan: { color: TEXTO_PRIMARIO, fontSize: 20, fontFamily: FUENTE_DISPLAY, lineHeight: 28, fontVariant: ['tabular-nums'] },
  quedanTotal: { color: NEUTRAL_500, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  ayuda: { color: NEUTRAL_400, fontSize: 12.5, fontFamily: FUENTE_BODY },
  barraFondo: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  barraRelleno: { height: 5, borderRadius: 3 },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pieTexto: { flex: 1 },
  // Botones tipo pastilla: 32 px visibles, 44+ tactiles con hitSlop.
  accion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  accionPrimaria: { backgroundColor: MARCA.oro, borderColor: MARCA.oro },
  accionTexto: { color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  vacia: { gap: 12, padding: 16, borderColor: 'rgba(245,197,66,0.45)' },
  iconoVacio: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MARCA.oro,
  },
  empresasVacia: { flexDirection: 'row', gap: 8 },
  empresaVacia: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  empresaVaciaTexto: { flexShrink: 1, color: NEUTRAL_400, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  agregar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(245,197,66,0.45)',
  },
  agregarTexto: { color: MARCA.oro, fontSize: 14, fontFamily: FUENTE_BODY_SEMI },
});
