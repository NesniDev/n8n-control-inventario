# Control Logístico Multi-Sede

Sistema de despacho con captura por IA, bloqueo de duplicados entre sedes y analítica predictiva de turnos. Ver [`docs/architecture.md`](docs/architecture.md) para la arquitectura completa y el [diagrama de flujo](https://claude.ai/code/artifact/b0d0b9f0-a91b-419f-aebb-42e927af3e4f).

## Estructura

| Carpeta | Stack | Qué es |
|---|---|---|
| [`apps/mobile`](apps/mobile) | React Native + Expo | App del operador: captura la foto y envía la entrega |
| [`apps/backend`](apps/backend) | FastAPI + Postgres (Supabase, asyncpg) | Pipeline de extracción, chequeo de duplicados, API, job de turnos |
| [`apps/dashboard`](apps/dashboard) | Next.js | Panel de entregas y auditoría en tiempo (casi) real |
| [`n8n/workflows`](n8n/workflows) | n8n | Documentación de los flujos de orquestación |
| [`docs`](docs) | — | Arquitectura y diagrama |

## Levantar el proyecto en desarrollo

Requiere: Node.js 24+, Python 3.12+, un proyecto Supabase (Postgres), y una API key de Anthropic para la extracción por IA.

### 1. Backend

```bash
cd apps/backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env    # completar DATABASE_URL (Supabase) y OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```

El schema se crea solo al arrancar — no hay migraciones que correr a mano.

### 2. Dashboard

```bash
cd apps/dashboard
copy .env.local.example .env.local
npm install
npm run dev
```

### 3. App móvil

```bash
cd apps/mobile
npm install
npx expo start
```

> La subida de fotos (`apps/mobile/api.ts`) va directo al bucket `evidencia` de Supabase Storage con la anon key — no hace falta backend propio para el upload.

## Estado del scaffold

- ✅ Base de datos real: Supabase (Postgres) provisionado vía Marketplace de Vercel, corriendo.
- ✅ Modelo de datos, API del pipeline (extracción → validación → duplicados → persistencia → logs), job de turnos — **probado end-to-end contra Supabase**.
- ✅ Dashboard leyendo `entregas` y `logs` por polling — **corriendo en http://localhost:3000**.
- ✅ Backend corriendo en http://localhost:8000.
- ✅ App móvil con flujo de captura completo, subiendo de verdad a Supabase Storage (bucket `evidencia`, con RLS scoped a ese bucket — ver `apps/backend/scripts/setup_storage.py`).
- ✅ `OPENAI_API_KEY` configurada — el pipeline completo (foto → extracción IA → bloqueo de duplicados → auditoría) fue probado end-to-end contra Supabase y funciona.
- ⏳ Sincronización en tiempo real vía Supabase Realtime (el dashboard usa polling como interino — Realtime lo reemplazaría sin necesitar un relay propio).
- ⏳ Autenticación de operadores/supervisores (Supabase Auth ya está disponible en el mismo proyecto).
- ⏳ n8n: documentado, siendo desplegado ahora (ver `n8n/workflows`).
