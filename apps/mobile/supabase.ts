import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY — ver apps/mobile/.env'
  );
}

// Cliente con la publishable key (publica por diseño, protegida por RLS del
// lado del servidor) — la mobile app nunca debe usar la secret key.
export const supabase = createClient(supabaseUrl, supabasePublishableKey);

export const EVIDENCIA_BUCKET = 'evidencia';
