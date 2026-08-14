import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — ver apps/mobile/.env'
  );
}

// Cliente con la anon key (publica por diseño, protegida por RLS del lado del
// servidor) — la mobile app nunca debe usar la service_role key.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const EVIDENCIA_BUCKET = 'evidencia';
