// Tarjeta de los talonarios activos del punto (uno por letra, p. ej. A de
// El Imperio y V de Veterinaria en paralelo), en una sola lista compacta:
// cada fila lleva la letra de la empresa (en su color), la siguiente hoja, el
// estado y una barra de uso. Las
// acciones (anular hoja, cambiar talonario) van en un menu por fila para no
// recargar la tarjeta; si el talonario se agoto, "Cambiar" queda a la vista.
// Sin talonarios invita a configurarlo. Se muestra en la tab Inicio (solo
// sesiones de punto); la tab Traslados solo consulta los talonarios para
// bloquear "Nuevo traslado". Carga su propio dato (siempre fresco al volver a
// la pantalla) y trae los modales de configurar y anular hoja.
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { fetchTalonariosPunto, type TalonarioPunto } from './api';
import HojaModal from './HojaModal';
import {
  datosEmpresa,
  EMPRESAS_TALONARIO,
  InsigniaEmpresa,
  ModalAnularHoja,
  ModalConfigurarTalonario,
} from './ModalTalonario';
import {
  FUENTE_BODY,
  FUENTE_BODY_SEMI,
  FUENTE_DISPLAY,
  NEUTRAL_400,
  NEUTRAL_500,
  NEUTRAL_700,
  NEUTRAL_800,
  NEUTRAL_850,
  TEXTO_PRIMARIO,
} from './tema';
import { MARCA } from './vidrio';

const ROJO = '#f87171';
const VERDE = '#4ade80';

// Estado del talonario: color + texto (el color nunca va solo).
function estadoDe(t: TalonarioPunto) {
  if (t.agotado) return { texto: 'Agotado', color: ROJO };
  if (t.quedan <= t.umbral_aviso) return { texto: 'Pocas hojas', color: MARCA.oro };
  return { texto: 'Activo', color: VERDE };
}

function FilaTalonario({
  talonario,
  primera,
  onOpciones,
  onCambiar,
}: {
  talonario: TalonarioPunto;
  primera: boolean;
  onOpciones: () => void;
  onCambiar: () => void;
}) {
  const empresa = datosEmpresa(talonario.letra);
  const estado = estadoDe(talonario);
  const tono = empresa?.claro ?? MARCA.oro;
  const total = talonario.numero_final - talonario.numero_inicial + 1;
  const usadas = total - talonario.quedan;
  const alerta = estado.texto !== 'Activo';

  return (
    <View style={[estilos.fila, !primera && estilos.filaSeparada]}>
      <View style={[estilos.franja, { backgroundColor: empresa?.color ?? NEUTRAL_700 }]} />
      <View style={estilos.filaCuerpo}>
        {/* Linea 1: letra de la empresa | siguiente hoja | estado | menu. */}
        <View style={estilos.lineaPrincipal}>
          <InsigniaEmpresa letra={talonario.letra} tamano={34} />
          <View style={{ flex: 1 }}>
            <Text style={estilos.etiqueta}>Siguiente hoja</Text>
            <Text style={[estilos.hoja, { color: talonario.agotado ? ROJO : tono }]} numberOfLines={1}>
              {talonario.agotado ? 'Sin hojas' : talonario.siguiente_hoja}
            </Text>
          </View>
          <View style={[estilos.estado, { backgroundColor: `${estado.color}1f` }]}>
            <View style={[estilos.punto, { backgroundColor: estado.color }]} />
            <Text style={[estilos.estadoTexto, { color: estado.color }]}>{estado.texto}</Text>
          </View>
          <Pressable
            onPress={onOpciones}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Opciones del talonario de ${empresa?.nombre ?? talonario.letra}`}
            style={({ pressed }) => [estilos.menu, pressed && estilos.presionado]}
          >
            <Ionicons name="ellipsis-vertical" size={18} color={NEUTRAL_400} />
          </Pressable>
        </View>

        {/* Linea 2: barra de uso del talonario. */}
        <View
          style={estilos.barraFondo}
          accessibilityLabel={`${usadas} de ${total} hojas usadas`}
        >
          <View
            style={[
              estilos.barraRelleno,
              { width: `${(usadas / total) * 100}%`, backgroundColor: alerta ? estado.color : tono },
            ]}
          />
        </View>

        {/* Agotado: la unica accion util queda a la vista. */}
        {talonario.agotado ? (
          <Pressable
            onPress={onCambiar}
            accessibilityRole="button"
            style={({ pressed }) => [estilos.cambiarAgotado, pressed && estilos.presionado]}
          >
            <Ionicons name="swap-horizontal" size={16} color={MARCA.tinta} />
            <Text style={estilos.cambiarAgotadoTexto}>Cambiar talonario</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// Opcion del menu de acciones: icono + titulo + detalle, fila de 60 px.
function Opcion({
  icono,
  titulo,
  detalle,
  color = TEXTO_PRIMARIO,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  titulo: string;
  detalle: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [estilos.opcion, pressed && estilos.presionado]}
    >
      <View style={estilos.opcionIcono}>
        <Ionicons name={icono} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[estilos.opcionTitulo, { color }]}>{titulo}</Text>
        <Text style={estilos.opcionDetalle}>{detalle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={NEUTRAL_500} />
    </Pressable>
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
  // Talonario con el menu de opciones abierto.
  const [opciones, setOpciones] = useState<TalonarioPunto | null>(null);

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

  if (talonarios === undefined) return null;

  // Empresas que todavia no tienen talonario activo en el punto.
  const faltantes = EMPRESAS_TALONARIO.filter((e) => !talonarios.some((t) => t.letra === e.letra));
  const empresaOpciones = opciones ? datosEmpresa(opciones.letra) : null;

  return (
    <>
      <View style={estilos.tarjeta}>
        {/* Encabezado de la lista, con "Agregar" mientras falte alguna empresa. */}
        <View style={estilos.encabezado}>
          <View style={estilos.encabezadoTitulo}>
            <Ionicons name="receipt-outline" size={15} color={NEUTRAL_400} />
            <Text style={estilos.titulo}>Talonarios</Text>
          </View>
          {talonarios.length > 0 && faltantes.length > 0 ? (
            <Pressable
              onPress={() => setConfigurando('')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={
                faltantes.length === 1 ? `Agregar talonario de ${faltantes[0].nombre}` : 'Agregar talonario'
              }
              style={({ pressed }) => [estilos.agregar, pressed && estilos.presionado]}
            >
              <Ionicons name="add" size={16} color={MARCA.oro} />
              <Text style={estilos.agregarTexto}>
                {faltantes.length === 1 ? `Agregar ${faltantes[0].corto}` : 'Agregar'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {talonarios.length === 0 ? (
          // Sin talonario: una sola fila que invita a configurarlo.
          <Pressable
            onPress={() => setConfigurando('')}
            accessibilityRole="button"
            accessibilityLabel="Configura tu talonario. Necesario para crear traslados."
            style={({ pressed }) => [estilos.vacia, pressed && estilos.presionado]}
          >
            <View style={estilos.vaciaInsignias}>
              {EMPRESAS_TALONARIO.map((e, i) => (
                <View key={e.letra} style={i > 0 ? { marginLeft: -8 } : undefined}>
                  <InsigniaEmpresa letra={e.letra} tamano={30} />
                </View>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={estilos.empresa}>Configura tu talonario</Text>
              <Text style={estilos.subtituloTexto}>Necesario para crear traslados</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={MARCA.oro} />
          </Pressable>
        ) : (
          talonarios.map((talonario, i) => (
            <FilaTalonario
              key={talonario.id}
              talonario={talonario}
              primera={i === 0}
              onOpciones={() => setOpciones(talonario)}
              onCambiar={() => setConfigurando(talonario.letra)}
            />
          ))
        )}
      </View>

      {/* Menu de acciones del talonario elegido. */}
      <HojaModal
        visible={opciones !== null}
        titulo={empresaOpciones ? `Talonario ${empresaOpciones.corto}` : 'Talonario'}
        onCerrar={() => setOpciones(null)}
      >
        {opciones ? (
          <View style={{ gap: 8 }}>
            {!opciones.agotado ? (
              <Opcion
                icono="close-circle-outline"
                titulo={`Anular la hoja ${opciones.siguiente_hoja}`}
                detalle="Si se dañó o se perdió. No se puede deshacer."
                color={ROJO}
                onPress={() => {
                  setAnulando(opciones);
                  setOpciones(null);
                }}
              />
            ) : null}
            <Opcion
              icono="swap-horizontal"
              titulo="Cambiar talonario"
              detalle={`Registrar un talonario nuevo de ${empresaOpciones?.corto ?? opciones.letra}.`}
              onPress={() => {
                setConfigurando(opciones.letra);
                setOpciones(null);
              }}
            />
          </View>
        ) : null}
      </HojaModal>

      <ModalConfigurarTalonario
        visible={configurando !== null}
        puntoId={puntoId}
        usuarioId={usuarioId}
        talonarios={talonarios}
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
}

const estilos = StyleSheet.create({
  tarjeta: {
    borderRadius: 18,
    backgroundColor: NEUTRAL_850,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  presionado: { opacity: 0.7 },
  encabezado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  encabezadoTitulo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titulo: { color: NEUTRAL_400, fontSize: 12, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.8 },
  agregar: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  agregarTexto: { color: MARCA.oro, fontSize: 13, fontFamily: FUENTE_BODY_SEMI },
  fila: { flexDirection: 'row' },
  filaSeparada: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  // Franja con el color de la empresa: se distingue A de V de un vistazo.
  franja: { width: 3, marginVertical: 12, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  filaCuerpo: { flex: 1, gap: 8, paddingLeft: 11, paddingRight: 6, paddingVertical: 10 },
  lineaPrincipal: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  empresa: { color: TEXTO_PRIMARIO, fontSize: 14.5, fontFamily: FUENTE_BODY_SEMI },
  punto: { width: 6, height: 6, borderRadius: 3 },
  subtituloTexto: { color: NEUTRAL_500, fontSize: 12, fontFamily: FUENTE_BODY },
  estado: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  estadoTexto: { fontSize: 11.5, fontFamily: FUENTE_BODY_SEMI },
  etiqueta: { color: NEUTRAL_500, fontSize: 10, fontFamily: FUENTE_BODY_SEMI, textTransform: 'uppercase', letterSpacing: 0.8 },
  hoja: { fontSize: 20, fontFamily: FUENTE_DISPLAY, lineHeight: 24, fontVariant: ['tabular-nums'] },
  // 36 px visibles + hitSlop = 48 px de area tactil.
  menu: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Sangria igual a la insignia (34) + separacion (10): alinea con la hoja.
  barraFondo: {
    height: 4,
    marginLeft: 44,
    marginRight: 8,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  barraRelleno: { height: 4, borderRadius: 2 },
  cambiarAgotado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    marginLeft: 44,
    marginRight: 8,
    borderRadius: 12,
    backgroundColor: MARCA.oro,
  },
  cambiarAgotadoTexto: { color: MARCA.tinta, fontSize: 14, fontFamily: FUENTE_BODY_SEMI },
  vacia: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  vaciaInsignias: { flexDirection: 'row' },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: NEUTRAL_800,
    borderWidth: 1,
    borderColor: NEUTRAL_700,
  },
  opcionIcono: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  opcionTitulo: { fontSize: 15, fontFamily: FUENTE_BODY_SEMI },
  opcionDetalle: { color: NEUTRAL_500, fontSize: 12.5, fontFamily: FUENTE_BODY },
});
