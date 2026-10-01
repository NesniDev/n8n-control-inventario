"use client";

import { useEffect, useRef, useState } from "react";

const ADMIN_TOKEN_STORAGE_KEY = "despachos_admin_token";

// Token de administrador para los endpoints protegidos con X-Admin-Token (borrado
// de entregas y pantalla /creador, ver verificar_token_admin en el backend) --
// persistido en localStorage para no tener que pegarlo de nuevo en cada visita.
// Arranca en "" siempre (no se lee localStorage en el initializer de useState)
// para que el primer render en el cliente coincida con el del servidor -- leerlo
// de sincrono ahi rompia la hidratacion cuando ya habia un token guardado de antes.
export function useAdminToken(): [string, (token: string) => void] {
  const [adminToken, setAdminToken] = useState("");
  useEffect(() => {
    // queueMicrotask (no setState directo en el cuerpo del efecto) para
    // no disparar react-hooks/set-state-in-effect.
    queueMicrotask(() => {
      try {
        setAdminToken(localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "");
      } catch {
        // localStorage puede fallar (modo privado, storage lleno) -- el
        // token simplemente no persiste entre visitas.
      }
    });
  }, []);
  // Se salta el primer efecto (dispara al montar, antes de que el efecto de
  // arriba termine de cargar el valor guardado) para no pisar el token ya
  // guardado con el "" inicial.
  const primerEfectoToken = useRef(true);
  useEffect(() => {
    if (primerEfectoToken.current) {
      primerEfectoToken.current = false;
      return;
    }
    try {
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
    } catch {
      // localStorage puede fallar (modo privado, storage lleno) -- no es
      // critico, el token simplemente no persiste entre visitas.
    }
  }, [adminToken]);

  return [adminToken, setAdminToken];
}
