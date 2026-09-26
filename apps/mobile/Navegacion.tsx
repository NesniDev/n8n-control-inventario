// Navegacion animada -- reemplaza el switch manual por fase que antes vivia
// en App.tsx/PantallaCaptura. Dos niveles:
//   Tabs (barra abajo, visible desde que abre la app):
//     Despachos | TrasladosPuntos | Remisiones
//   Cada tab maneja SU PROPIO login -- los usuarios de despachos, traslados
//   y remisiones son distintos, asi que no hay una sesion global: entrar a
//   una tab no deja logueado en las otras.
//     -> Despachos: stack Login -> Captura, Buscar, Confirmando, Resultado.
// Los ParamList se declaran aca (y no en EntregaContext.tsx) porque son el
// tipo "de arriba hacia abajo": los consumen las pantallas y EntregaContext.tsx
// via import type (sin dependencia de runtime, se borra en compilacion).
import { useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import {
  fetchPuntos,
  fetchSupervisores,
  fetchUsuariosPunto,
  loginPunto,
  loginSupervisor,
  type Empleado,
  type Punto,
  type Sede,
  type Supervisor,
  type UsuarioPunto,
} from './api';
import { EntregaProvider } from './EntregaContext';
import { TrasladoProvider } from './TrasladoContext';
import PantallaLogin from './PantallaLogin';
import PantallaCapturaFoto from './PantallaCapturaFoto';
import PantallaBuscar from './PantallaBuscar';
import PantallaConfirmando from './PantallaConfirmando';
import PantallaResultado from './PantallaResultado';
import PantallaTrasladoInicio from './PantallaTrasladoInicio';
import PantallaTrasladoNuevo from './PantallaTrasladoNuevo';
import PantallaTrasladoFirmaTransportador from './PantallaTrasladoFirmaTransportador';
import PantallaTrasladoResultado from './PantallaTrasladoResultado';
import PantallaTrasladoBandeja from './PantallaTrasladoBandeja';
import PantallaTrasladoRecepcion from './PantallaTrasladoRecepcion';
import PantallaTrasladoDetalle from './PantallaTrasladoDetalle';
import PantallaNovedadesSupervision from './PantallaNovedadesSupervision';
import PantallaNovedadDetalle from './PantallaNovedadDetalle';
import PantallaRemisiones from './PantallaRemisiones';
import PantallaInicio from './PantallaInicio';
import { ACENTO, ESTILO_TAB_BAR, FUENTE_BODY_SEMI, NEUTRAL_500 } from './tema';

export type DespachosStackParamList = {
  Login: undefined;
  Captura: undefined;
  Buscar: undefined;
  Confirmando: undefined;
  Resultado: { mensaje: string };
};

// LoginPunto -> InicioTraslados -> NuevoTraslado -> FirmaTransportador ->
// ResultadoTraslado es el camino de CREAR un traslado (bodega origen);
// BandejaRecepcion -> RecepcionTraslado es el de RECIBIRLO (bodega
// destino) -- las dos ramas cuelgan de InicioTraslados, no una de la otra.
// LoginSupervision -> NovedadesSupervision -> NovedadDetalle es el camino de
// Supervision (Erika revisando y resolviendo novedades, ver
// TrasladoContext.tsx RolTraslados) -- rama totalmente aparte, sin nada
// colgando de InicioTraslados.
export type TrasladosStackParamList = {
  LoginPunto: undefined;
  LoginSupervision: undefined;
  InicioTraslados: undefined;
  NuevoTraslado: undefined;
  FirmaTransportador: undefined;
  ResultadoTraslado: { consecutivo: number };
  BandejaRecepcion: undefined;
  RecepcionTraslado: { trasladoId: string };
  DetalleTraslado: { trasladoId: string };
  NovedadesSupervision: undefined;
  NovedadDetalle: { trasladoId: string };
};

export type TabsParamList = {
  Inicio: undefined;
  Despachos: NavigatorScreenParams<DespachosStackParamList>;
  TrasladosPuntos: NavigatorScreenParams<TrasladosStackParamList>;
  Remisiones: undefined;
};

const Tabs = createBottomTabNavigator<TabsParamList>();
const DespachosStack = createNativeStackNavigator<DespachosStackParamList>();
const TrasladosStack = createNativeStackNavigator<TrasladosStackParamList>();

// Flujo de despachos de bodega (foto de factura/traslado), con su propio
// login por PIN. La sesion vive aca (y no en App.tsx) porque es solo de esta
// tab.
//
// EntregaProvider va en el `layout` del Navigator -- NO como hijo de el.
// @react-navigation/core recorre los `children` de un Navigator con
// getRouteConfigsFromChildren, que solo acepta Screen, Group o
// React.Fragment; cualquier otro elemento tira "A navigator can only contain
// 'Screen', 'Group' or 'React.Fragment' as its direct children" en runtime.
// `layout` ademas le pasa el `navigation` de ESTE stack, que es el que
// reiniciar() necesita para volver a Captura sin tocar las otras tabs.
//
// Login y el resto se alternan como Screen hijos del mismo Navigator
// (patron "auth flow" estandar de la libreria): React Navigation trata el
// cambio como una navegacion normal y anima la transicion Login -> Captura.
function Despachos() {
  // Sede y empleado se resuelven juntos en el login (ver PantallaLogin) --
  // un solo estado evita un instante con empleado seteado y sede todavia no.
  const [sesion, setSesion] = useState<{ empleado: Empleado; sede: Sede } | null>(null);

  return (
    <DespachosStack.Navigator
      screenOptions={{ headerShown: false }}
      layout={({ children, navigation }) => (
        <EntregaProvider
          navigation={navigation}
          empleado={sesion?.empleado ?? null}
          sede={sesion?.sede ?? null}
          cerrarSesion={() => setSesion(null)}
        >
          {children}
        </EntregaProvider>
      )}
    >
      {!sesion ? (
        <DespachosStack.Screen name="Login">
          {() => (
            <PantallaLogin
              // PantallaLogin.tsx quedo generalizada (usuario: UsuarioLogin,
              // lugar: Lugar) para poder loguear tambien Traslados (ver
              // Traslados() mas abajo) -- el cast de vuelta a Empleado/Sede
              // es seguro porque los defaults de cargarUsuarios/login (sin
              // pasar props aca) son justo fetchEmpleados/loginConPin, que
              // devuelven esos tipos mas ricos.
              onLogin={(empleado, sede) => setSesion({ empleado: empleado as Empleado, sede: sede as Sede })}
            />
          )}
        </DespachosStack.Screen>
      ) : (
        <>
          <DespachosStack.Screen name="Captura" component={PantallaCapturaFoto} />
          <DespachosStack.Screen name="Buscar" component={PantallaBuscar} />
          <DespachosStack.Screen name="Confirmando" component={PantallaConfirmando} />
          <DespachosStack.Screen name="Resultado" component={PantallaResultado} />
        </>
      )}
    </DespachosStack.Navigator>
  );
}

// Flujo de traslados entre puntos, con su propio login por PIN -- mismo
// patron que Despachos() de arriba (sesion propia de la tab, Provider en el
// `layout` del Navigator, Login alternado como Screen). A diferencia de
// Despachos, esta tab tiene DOS puntos de entrada post-login colgando
// directo de InicioTraslados (crear un traslado, o ir a la bandeja de
// recepcion) -- ver TrasladosStackParamList.
// Sesion discriminada por rol -- 'punto' guarda usuario+punto (como antes),
// 'supervision' guarda el supervisor logueado (hoy solo Erika). El stack
// entero cambia de pantallas segun cual sea (ver el JSX mas abajo), nunca se
// mezclan.
type SesionTraslados =
  | { rol: 'punto'; usuario: UsuarioPunto; punto: Punto }
  | { rol: 'supervision'; supervisor: Supervisor };

function Traslados() {
  const [sesion, setSesion] = useState<SesionTraslados | null>(null);

  return (
    <TrasladosStack.Navigator
      screenOptions={{ headerShown: false }}
      layout={({ children, navigation }) => (
        <TrasladoProvider
          navigation={navigation}
          rol={sesion?.rol ?? 'punto'}
          usuario={sesion?.rol === 'punto' ? sesion.usuario : null}
          punto={sesion?.rol === 'punto' ? sesion.punto : null}
          supervisor={sesion?.rol === 'supervision' ? sesion.supervisor : null}
          cerrarSesion={() => setSesion(null)}
        >
          {children}
        </TrasladoProvider>
      )}
    >
      {!sesion ? (
        <>
          <TrasladosStack.Screen name="LoginPunto">
            {({ navigation }) => (
              <PantallaLogin
                titulo="Traslados entre puntos"
                etiquetaLugar="punto"
                cargarLugares={fetchPuntos}
                cargarUsuarios={fetchUsuariosPunto}
                login={loginPunto}
                usuarioUnicoPorLugar
                // usuario/punto llegan tipados como UsuarioLogin/Lugar (formas
                // minimas, ver api.ts) -- el cast de vuelta a UsuarioPunto/
                // Punto es seguro porque cargarUsuarios/login de arriba son
                // justo los que devuelven esos tipos mas ricos (mismo criterio
                // que Despachos() con Empleado/Sede).
                onLogin={(usuario, punto) =>
                  setSesion({ rol: 'punto', usuario: usuario as UsuarioPunto, punto: punto as Punto })
                }
                accionExtra={{
                  texto: 'Entrar como Supervisión',
                  icono: 'shield-checkmark-outline',
                  onPress: () => navigation.navigate('LoginSupervision'),
                }}
              />
            )}
          </TrasladosStack.Screen>
          <TrasladosStack.Screen name="LoginSupervision">
            {({ navigation }) => (
              <PantallaLogin
                titulo="Supervisión de traslados"
                etiquetaLugar="área"
                // Un solo "lugar" sintetico -- Supervision no tiene sedes ni
                // puntos, pero PantallaLogin necesita elegir un lugar antes
                // de mostrar el popup "¿Quién eres?" con los supervisores.
                cargarLugares={async () => [{ id: 'supervision', nombre: 'Supervisión' }]}
                cargarUsuarios={fetchSupervisores}
                login={loginSupervisor}
                // usuario llega tipado como UsuarioLogin -- el cast a
                // Supervisor es seguro porque cargarUsuarios/login de arriba
                // son justo fetchSupervisores/loginSupervisor.
                onLogin={(usuario) => setSesion({ rol: 'supervision', supervisor: usuario as Supervisor })}
                accionExtra={{
                  texto: 'Volver a puntos',
                  icono: 'arrow-back',
                  onPress: () => navigation.goBack(),
                }}
              />
            )}
          </TrasladosStack.Screen>
        </>
      ) : sesion.rol === 'supervision' ? (
        <>
          <TrasladosStack.Screen name="NovedadesSupervision" component={PantallaNovedadesSupervision} />
          <TrasladosStack.Screen name="NovedadDetalle" component={PantallaNovedadDetalle} />
        </>
      ) : (
        <>
          <TrasladosStack.Screen name="InicioTraslados" component={PantallaTrasladoInicio} />
          <TrasladosStack.Screen name="NuevoTraslado" component={PantallaTrasladoNuevo} />
          <TrasladosStack.Screen name="FirmaTransportador" component={PantallaTrasladoFirmaTransportador} />
          <TrasladosStack.Screen name="ResultadoTraslado" component={PantallaTrasladoResultado} />
          <TrasladosStack.Screen name="BandejaRecepcion" component={PantallaTrasladoBandeja} />
          <TrasladosStack.Screen name="RecepcionTraslado" component={PantallaTrasladoRecepcion} />
          <TrasladosStack.Screen name="DetalleTraslado" component={PantallaTrasladoDetalle} />
        </>
      )}
    </TrasladosStack.Navigator>
  );
}

export default function Navegacion() {
  return (
    <Tabs.Navigator
      // Inicio es lo que se ve cada vez que se abre la app -- portada con el
      // logo, antes de elegir area (ver PantallaInicio.tsx).
      initialRouteName="Inicio"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACENTO,
        tabBarInactiveTintColor: NEUTRAL_500,
        tabBarStyle: ESTILO_TAB_BAR,
        tabBarLabelStyle: { fontFamily: FUENTE_BODY_SEMI },
        // Sin esto, la barra de tabs queda flotando arriba del teclado en
        // Android (edge-to-edge, ver EvitarTeclado.tsx) cada vez que un campo
        // de texto toma foco.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="Inicio"
        component={PantallaInicio}
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Despachos"
        component={Despachos}
        options={{
          title: 'Despachos',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="TrasladosPuntos"
        component={Traslados}
        options={{
          title: 'Traslados',
          tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Remisiones"
        component={PantallaRemisiones}
        options={{
          title: 'Remisiones',
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}
