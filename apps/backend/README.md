# Backend — Control Logístico Multi-Sede

API en FastAPI que implementa el pipeline de la [Figura 1 del diagrama de arquitectura](../../docs/architecture.md): captura → extracción por IA de visión → validación por confianza → chequeo de duplicados entre sedes → persistencia en Postgres (Supabase) → registro de auditoría.

## Setup

```bash
cd apps/backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
copy .env.example .env        # y completar DATABASE_URL, OPENAI_API_KEY, etc.
```

`DATABASE_URL` es la conexión **directa** (no el pooler transaccional de PgBouncer) de un proyecto Supabase — `POSTGRES_URL_NON_POOLING` en las variables que Supabase/Vercel inyectan. El backend mantiene su propio pool de `asyncpg` de larga duración, así que no necesita pasar por PgBouncer.

## Correr en desarrollo

```bash
uvicorn app.main:app --reload --port 8000
```

El schema (tablas + índice único anti-duplicado) se crea automáticamente al arrancar (`ensure_schema()` en `app/db.py`) — no hace falta correr migraciones a mano.

Docs interactivas: http://localhost:8000/docs

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/entregas/procesar` | Recibe `evidencia_url` + metadata de la app móvil, ejecuta el pipeline completo |
| `GET` | `/entregas?sede_id=...` | Lista entregas (para el dashboard) |
| `GET` | `/logs?entidad_id=...` | Consulta de auditoría |
| `POST` / `GET` | `/sedes` | CRUD básico de sedes |
| `POST` / `GET` | `/turnos` | CRUD de turnos |
| `GET` | `/turnos/recomendaciones` | Sugerencias generadas por el job semanal |

## Job de analítica de turnos

Corresponde a la Figura 2 del diagrama. Ejecutar semanalmente (cron de n8n, Task Scheduler, `crontab`):

```bash
python -m scripts.generar_turnos
```

## Notas de arquitectura

- El **bloqueo de duplicados** no depende solo de la lógica de la app: `app/db.py` define un `unique (numero_guia, remitente)` en la tabla `entregas`, que es la barrera real (ver `services/duplicates.py`, que captura `asyncpg.UniqueViolationError`).
- La **sincronización en tiempo real** hacia los dashboards de cada sede se resuelve con **Supabase Realtime** (replicación lógica de Postgres) — el dashboard puede suscribirse directo a la tabla `entregas` sin un relay propio que mantener (a diferencia de MongoDB Change Streams, que sí requerían un listener separado). Pendiente de cablear en `apps/dashboard` — hoy usa polling.
- La **IA de visión** (`services/vision.py`) usa salida estructurada (`response_format` `json_schema`, modo `strict`) de la API de OpenAI (GPT-4o), no parsing de texto libre.
- Conexión provisionada vía Marketplace de Vercel (`vercel integration add supabase`), que generó el proyecto Supabase y los env vars automáticamente.
