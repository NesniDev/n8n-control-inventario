// Cliente de Supabase solo para Realtime (escuchar cambios en `entregas` y
// `logs`) — la lectura/escritura de datos sigue yendo por la API del
// backend (app/lib/api.ts), esto solo dispara un refresh instantaneo en
// vez de esperar el proximo polling de SWR.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && publishableKey ? createClient(url, publishableKey) : null;
