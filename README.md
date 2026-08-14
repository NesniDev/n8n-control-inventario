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

## Producción (VPS / EasyPanel)

| Servicio | URL |
|---|---|
| Backend (FastAPI) | https://learning-backend.nxepde.easypanel.host |
| n8n | https://learning-n8n.nxepde.easypanel.host |
| Webhook del pipeline | `POST https://learning-n8n.nxepde.easypanel.host/webhook/foto-subida` |

El backend se despliega vía GitHub (build path `apps/backend`, `Dockerfile`) — un push a `main` no auto-despliega todavía (`autoDeploy: false` en el servicio de EasyPanel); hay que disparar el deploy manualmente desde el panel o la API hasta que se configure el webhook de auto-deploy.

## Estado del scaffold

- ✅ Base de datos real: Supabase (Postgres) provisionado vía Marketplace de Vercel, corriendo.
- ✅ Modelo de datos, API del pipeline (extracción → validación → duplicados → persistencia → logs), job de turnos — **probado end-to-end contra Supabase**.
- ✅ Dashboard leyendo `entregas` y `logs` por polling — **corriendo en http://localhost:3000** (local; no desplegado aún).
- ✅ Backend en producción en el VPS (ver tabla arriba), además de local en http://localhost:8000 para desarrollo.
- ✅ App móvil con flujo de captura completo, subiendo de verdad a Supabase Storage (bucket `evidencia`, con RLS scoped a ese bucket — ver `apps/backend/scripts/setup_storage.py`).
- ✅ `OPENAI_API_KEY` configurada — el pipeline completo (foto → extracción IA → bloqueo de duplicados → auditoría) fue probado end-to-end contra Supabase y funciona.
- ✅ n8n en producción, workflow `Pipeline de Despacho` importado y activo — **probado end-to-end** (webhook → backend → OpenAI → Supabase → duplicado bloqueado correctamente en el segundo intento).
- ⏳ Sincronización en tiempo real vía Supabase Realtime (el dashboard usa polling como interino — Realtime lo reemplazaría sin necesitar un relay propio).
- ⏳ Autenticación de operadores/supervisores (Supabase Auth ya está disponible en el mismo proyecto).
- ⏳ Dashboard y app móvil todavía apuntan a `http://localhost:8000` — actualizar `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL` al backend del VPS para usarlos fuera de esta máquina.
