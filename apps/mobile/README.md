# App móvil — Captura de Despacho

App del operador (React Native + Expo): toma la foto de la guía, la sube a Supabase Storage y le pide al backend que la procese.

## Setup

```bash
cd apps/mobile
npm install
copy .env.example .env    # completar EXPO_PUBLIC_SUPABASE_URL / ANON_KEY / API_URL
npx expo start
```

- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`: mismo proyecto Supabase que usa el backend (la app usa la **anon key**, nunca la `service_role`).
- `EXPO_PUBLIC_API_URL`: URL del backend. En el emulador Android, `localhost` apunta al propio emulador — usar la IP de la máquina host o `10.0.2.2` en su lugar.

## Flujo

1. El operador toma la foto (`expo-image-picker`).
2. `subirEvidencia()` (`api.ts`) la sube al bucket `evidencia` de Supabase Storage y calcula un hash SHA-256 del contenido.
3. `procesarEntrega()` llama a `POST /entregas/procesar` del backend con la URL pública + el hash.
4. La UI muestra el resultado: `procesada`, `pendiente_revision`, o el error (p. ej. `409` si la guía ya fue registrada por otra sede).

## Storage

El bucket y sus políticas de RLS (permiten `insert`/`select` a la anon key, scoped a `bucket_id = 'evidencia'`) se provisionan con:

```bash
cd apps/backend
python -m scripts.setup_storage
```

Es idempotente — se puede correr de nuevo sin problema.
