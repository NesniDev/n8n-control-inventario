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

1. El operador inicia sesión eligiendo **sede → PIN** (sin usuario/contraseña — ver abajo). La sede elegida en el login pasa a ser la sede de trabajo de esa sesión, no necesariamente la del perfil del empleado (permite cubrir turno en otra sede).
2. Toma la foto (`expo-image-picker`).
3. `subirEvidencia()` (`api.ts`) la sube al bucket `evidencia` de Supabase Storage y calcula un hash SHA-256 del contenido.
4. `procesarEntrega()` llama a `POST /entregas/procesar` del backend con la URL pública + el hash.
5. La UI muestra el resultado: `procesada`, `pendiente_revision`, o el error (p. ej. `409` si la guía ya fue registrada por otra sede — con un popup nativo además del texto en pantalla).

## Login por sede + PIN

Sin correo ni contraseña. El login tiene dos pasos (`PantallaLogin.tsx`): elegir sede (`GET /sedes`) y confirmar con el PIN de 4 a 6 dígitos, que identifica al empleado (no hace falta elegirlo aparte). El PIN nunca se guarda en texto plano (PBKDF2-HMAC-SHA256 + sal por empleado, ver `apps/backend/app/services/auth_pin.py`).

**Crear un empleado** (hasta que exista una pantalla de administración):

```bash
curl -X POST https://learning-backend.nxepde.easypanel.host/empleados \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Juan Pérez","sede_id":"<id-de-la-sede>","pin":"1234"}'
```

`sede_id` sale de `GET /sedes`. El login es `POST /auth/pin` con `{"pin":"1234"}` — como el PIN no indexa directo al empleado (la sal es distinta por fila), se verifica contra cada empleado activo; a esta escala (pocos operadores) el costo es insignificante.

## Storage

El bucket y sus políticas de RLS (permiten `insert`/`select` a la anon key, scoped a `bucket_id = 'evidencia'`) se provisionan con:

```bash
cd apps/backend
python -m scripts.setup_storage
```

Es idempotente — se puede correr de nuevo sin problema.
