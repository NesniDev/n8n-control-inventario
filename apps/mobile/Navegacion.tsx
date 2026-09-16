// Stack de navegacion animado -- reemplaza el switch manual por fase que
// antes vivia en App.tsx/PantallaCaptura. RootStackParamList se declara aca
// (y no en EntregaContext.tsx) porque es el tipo "de arriba hacia abajo": lo
// consume EntregaContext.tsx via import type (sin dependencia de runtime,
// se borra en compilacion) para tipar useNavigation() en reiniciar()/
// cancelarConfirmacion().
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { Empleado, Sede } from './api';
import { EntregaProvider } from './EntregaContext';
import PantallaLogin from './PantallaLogin';
import PantallaCapturaFoto from './PantallaCapturaFoto';
import PantallaBuscar from './PantallaBuscar';
import PantallaConfirmando from './PantallaConfirmando';
import PantallaResultado from './PantallaResultado';

export type RootStackParamList = {
  Login: undefined;
  Captura: undefined;
  Buscar: undefined;
  Confirmando: undefined;
  Resultado: { mensaje: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// EntregaProvider se monta SIEMPRE, como ancestro constante de
// Stack.Navigator -- NO como hijo condicional dentro de el.
// @react-navigation/core recorre los `children` de Stack.Navigator con
// getRouteConfigsFromChildren, que solo acepta Screen, Group o
// React.Fragment como hijos directos/anidados; cualquier otro tipo de
// elemento (EntregaProvider es un componente funcion normal que devuelve un
// Context.Provider) hace que tire "A navigator can only contain 'Screen',
// 'Group' or 'React.Fragment' as its direct children" en runtime.
//
// Ademas, esto preserva la transicion animada Login -> Captura: si este
// componente devolviera en un render <Stack.Navigator> (sin sesion) y en el
// siguiente <EntregaProvider><Stack.Navigator> (con sesion), React veria un
// tipo de elemento distinto en la misma posicion del arbol y desmontaria
// todo el Navigator viejo para montar uno nuevo de cero, matando la
// animacion. Con EntregaProvider siempre presente y Stack.Navigator siempre
// en la misma posicion, solo cambian los Screen hijos -- React Navigation
// trata ese cambio como una navegacion normal y anima la transicion
// (patron "auth flow" estandar de la libreria).
export default function Navegacion({
  sesion,
  onLogin,
  onCerrarSesion,
}: {
  sesion: { empleado: Empleado; sede: Sede } | null;
  onLogin: (empleado: Empleado, sede: Sede) => void;
  onCerrarSesion: () => void;
}) {
  return (
    <EntregaProvider
      empleado={sesion?.empleado ?? null}
      sede={sesion?.sede ?? null}
      cerrarSesion={onCerrarSesion}
    >
      {/* headerShown: false -- la app tiene su propio header (sede/
          empleado + "Cerrar sesión"), ver HeaderEntrega en
          EntregaContext.tsx. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!sesion ? (
          <Stack.Screen name="Login">{() => <PantallaLogin onLogin={onLogin} />}</Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Captura" component={PantallaCapturaFoto} />
            <Stack.Screen name="Buscar" component={PantallaBuscar} />
            <Stack.Screen name="Confirmando" component={PantallaConfirmando} />
            <Stack.Screen name="Resultado" component={PantallaResultado} />
          </>
        )}
      </Stack.Navigator>
    </EntregaProvider>
  );
}
