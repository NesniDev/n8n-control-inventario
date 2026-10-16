// Visor a pantalla completa para revisar una foto ya tomada (evidencia,
// traslado, talonario) con zoom y giro -- pellizcar con dos dedos para
// acercar/alejar, arrastrar con un dedo para moverse dentro de la imagen
// ampliada y doble toque para alternar entre 1x y 2.5x. `giro` muestra la foto
// girada (la pantalla que la abre lleva el boton de girar); es solo de la
// vista, no cambia el archivo. Sin dependencias nuevas: PanResponder + touches crudos,
// nada de gesture-handler/reanimated (evita otro build nativo).
import { useRef, useState } from 'react';
import { Image, Modal, PanResponder, Pressable, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { estilosVisorZoom, TEXTO_PRIMARIO } from './tema';

const ESCALA_MIN = 1;
const ESCALA_MAX = 5;

function limitar(valor: number) {
  return Math.min(Math.max(valor, ESCALA_MIN), ESCALA_MAX);
}

export default function VisorFotoZoom({
  uri,
  giro = 0,
  onCerrar,
}: {
  uri: string;
  // Grados (0, 90, 180, 270).
  giro?: number;
  onCerrar: () => void;
}) {
  const { width: anchoPantalla, height: altoPantalla } = useWindowDimensions();
  const [escala, setEscala] = useState(1);
  const [desplazamiento, setDesplazamiento] = useState({ x: 0, y: 0 });

  // Copias en ref de la escala: el PanResponder se crea una sola vez, asi que
  // sus callbacks no ven el estado nuevo (leerian siempre la escala inicial).
  const escalaActual = useRef(1);
  const escalaAlIniciarPinch = useRef(1);
  const distanciaAlIniciarPinch = useRef<number | null>(null);
  const ultimoToqueUnico = useRef<{ x: number; y: number } | null>(null);
  const inicioToqueSimple = useRef<{ x: number; y: number; tiempo: number } | null>(null);
  const ultimoTapSimple = useRef(0);

  const cambiarEscala = (nueva: number) => {
    const valor = limitar(nueva);
    escalaActual.current = valor;
    setEscala(valor);
    if (valor === 1) setDesplazamiento({ x: 0, y: 0 });
  };

  const distanciaEntreToques = (toques: { pageX: number; pageY: number }[]) =>
    Math.hypot(toques[0].pageX - toques[1].pageX, toques[0].pageY - toques[1].pageY);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const toques = evt.nativeEvent.touches;
        if (toques.length === 1) {
          inicioToqueSimple.current = { x: toques[0].pageX, y: toques[0].pageY, tiempo: Date.now() };
        }
      },
      onPanResponderMove: (evt) => {
        const toques = evt.nativeEvent.touches;
        if (toques.length === 2) {
          ultimoToqueUnico.current = null;
          const distanciaActual = distanciaEntreToques(toques);
          if (distanciaAlIniciarPinch.current == null) {
            // Primer frame con dos dedos: fija el punto de partida en vez de
            // saltar de golpe a la escala que daria el primer delta.
            distanciaAlIniciarPinch.current = distanciaActual;
            escalaAlIniciarPinch.current = escalaActual.current;
          } else {
            cambiarEscala(escalaAlIniciarPinch.current * (distanciaActual / distanciaAlIniciarPinch.current));
          }
        } else if (toques.length === 1) {
          distanciaAlIniciarPinch.current = null;
          const toque = toques[0];
          const anterior = ultimoToqueUnico.current;
          if (escalaActual.current > 1 && anterior) {
            setDesplazamiento((prev) => ({
              x: prev.x + (toque.pageX - anterior.x),
              y: prev.y + (toque.pageY - anterior.y),
            }));
          }
          ultimoToqueUnico.current = { x: toque.pageX, y: toque.pageY };
        }
      },
      onPanResponderRelease: (evt) => {
        distanciaAlIniciarPinch.current = null;
        ultimoToqueUnico.current = null;

        const inicio = inicioToqueSimple.current;
        inicioToqueSimple.current = null;
        if (!inicio) return;

        const fin = evt.nativeEvent.changedTouches[0];
        const movimiento = fin ? Math.hypot(fin.pageX - inicio.x, fin.pageY - inicio.y) : 0;
        const duracion = Date.now() - inicio.tiempo;
        if (movimiento > 10 || duracion > 250) return; // fue arrastre, no tap

        const ahora = Date.now();
        if (ahora - ultimoTapSimple.current < 300) {
          // Doble toque: alterna entre 1x y 2.5x.
          ultimoTapSimple.current = 0;
          cambiarEscala(escalaActual.current > 1 ? 1 : 2.5);
        } else {
          ultimoTapSimple.current = ahora;
        }
      },
    })
  ).current;

  // De lado (90/270) se cambian ancho y alto de la caja para que, ya girada,
  // la foto siga entrando completa en la pantalla.
  const deLado = giro % 180 !== 0;
  const altoUtil = altoPantalla * 0.72;
  const caja = deLado ? { width: altoUtil, height: anchoPantalla } : { width: anchoPantalla, height: altoUtil };

  return (
    <Modal visible animationType="fade" onRequestClose={onCerrar} statusBarTranslucent>
      <View style={estilosVisorZoom.fondo}>
        <Pressable
          style={estilosVisorZoom.botonCerrar}
          onPress={onCerrar}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        >
          <Ionicons name="close" size={26} color={TEXTO_PRIMARIO} />
        </Pressable>
        <View style={estilosVisorZoom.area} {...panResponder.panHandlers}>
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={[
              estilosVisorZoom.imagen,
              caja,
              {
                transform: [
                  { translateX: desplazamiento.x },
                  { translateY: desplazamiento.y },
                  { rotate: `${giro}deg` },
                  { scale: escala },
                ],
              },
            ]}
          />
        </View>

      </View>
    </Modal>
  );
}
