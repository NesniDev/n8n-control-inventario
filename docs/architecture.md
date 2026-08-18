# Arquitectura: Sistema de Control Logístico Multi-Sede con IA

> Diagrama de referencia (flujo de despacho + job de turnos): https://claude.ai/code/artifact/b0d0b9f0-a91b-419f-aebb-42e927af3e4f

## Contexto

Sistema de control logístico y gestión de entregas multi-sede que:

- Elimina digitación manual capturando datos de guías/remisiones por foto + IA.
- Evita despachos duplicados entre sedes mediante una base de datos centralizada en tiempo real con trazabilidad.
- Sugiere turnos óptimos del personal a partir de analítica predictiva sobre el histórico de entregas.
- Registra logs de cada evento (captura, extracción, cruce de sedes).

Parámetros de diseño:

- **IA de visión:** LLM multimodal (OpenAI GPT-4o, vision) — no OCR de plantilla fija, porque las guías varían de formato entre sedes/proveedores.
- **App de operadores:** Móvil nativa (React Native + Expo).
- **Escala inicial:** 2 a 5 sedes, <500 entregas/día. Arquitectura simple y barata de operar, sin bloquear crecimiento futuro.
- **Base de datos:** Supabase (Postgres) — un solo proveedor cubre base de datos, storage, auth y tiempo real (Realtime), en vez de estar armando esas cuatro piezas por separado.

## 1. Arquitectura de la solución (stack)

**App móvil (operadores)** — `apps/mobile`
- React Native + Expo: cámara nativa, un solo código base, EAS Build/OTA updates.
- Offline-first ligero: cola local para fotos capturadas sin señal (pendiente de implementar — ver TODO en `apps/mobile/api.ts`).

**Backend / API** — `apps/backend`
- FastAPI (Python): orquesta la subida, la llamada a IA, la validación/normalización, la escritura en DB y el logging.

**IA de extracción (Data Entry por Visión)**
- OpenAI (`VISION_MODEL`, por defecto `gpt-5.6-luna`) vía API, con salida estructurada (`response_format` de tipo `json_schema`, modo `strict`) forzando un JSON schema fijo.
- Score de confianza por campo; si es bajo o faltan campos críticos → estado `pendiente_revision`.

**Base de datos (multi-sede, tiempo real)** — provisionada vía Marketplace de Vercel (`vercel integration add supabase`)
- Supabase (Postgres): `unique (tipo, indicativo_numero)` que bloquea duplicados a nivel de base de datos (ej. no puede haber dos "FEI 10254"), y Supabase Realtime (replicación lógica de Postgres) para notificar en tiempo real a todas las sedes sin un relay propio.

**Almacenamiento de evidencia**
- Object storage — la DB solo guarda URL + hash SHA-256. Candidato natural: Supabase Storage (mismo proyecto, sin un proveedor aparte), o S3/R2/GCS si se prefiere separar responsabilidades.

**Orquestación** — `n8n/workflows`
- n8n: recibe el webhook "foto subida", llama al backend (que a su vez llama a la IA, valida, escribe en Supabase), dispara notificaciones y corre el job semanal de turnos.

**Dashboard administrativo** — `apps/dashboard`
- Next.js: entregas en tiempo real (Supabase Realtime), alertas de duplicado, logs.

## 2. Flujo de automatización (paso a paso)

1. **Captura**: operador en Sede A fotografía la guía; la app adjunta `sede_id`, `operador_id`, timestamp.
2. **Subida**: imagen a object storage; se genera hash SHA-256.
3. **Trigger**: evento "imagen subida" dispara webhook a n8n.
4. **Extracción IA**: se llama al LLM de visión con la imagen + schema JSON; se recibe el tipo de documento (FEI/TB/RM3/RM2), indicativo/número, cantidad entregada y cantidad pendiente, + confianza por campo.
5. **Validación automática**: confianza alta y campos completos → continúa; confianza baja → `pendiente_revision` + notificación.
6. **Chequeo de duplicados**: índice único (tipo + indicativo/número) antes de insertar. Si ya existe → se bloquea, se registra en `logs`, se notifica a ambas sedes.
7. **Persistencia**: si no hay duplicado, se inserta en `entregas` con estado `procesada`.
8. **Propagación en tiempo real**: Change Stream/listener actualiza dashboards/apps.
9. **Logging**: cada paso anterior escribe un evento inmutable en `logs`.
10. **Job de turnos**: semanalmente, `apps/backend/scripts/generar_turnos.py` corre la analítica predictiva y genera `shift_recommendations`.

Ver el diagrama enlazado arriba para el flujo visual completo, incluyendo las ramas de confianza baja y duplicado bloqueado.

## 3. Modelo de datos (tablas Postgres)

```
sedes            (id uuid pk, nombre, codigo unique, direccion, timezone, activa, created_at)
empleados        (id uuid pk, nombre, sede_id, rol, estado, created_at)
entregas         (id uuid pk, tipo, indicativo_numero, hash_evidencia unique, sede_origen_id,
                   cantidad_entregada, cantidad_pendiente, estado, confianza_ia jsonb,
                   evidencia_url, operador_id, capturado_at, procesado_at, actualizado_at)
                  -- tipo in ('FEI', 'TB', 'RM3', 'RM2'): factura, traslado o remision
                  -- unique (tipo, indicativo_numero)  ← barrera anti-duplicado real (ej. "FEI 10254")
turnos                (id uuid pk, empleado_id, sede_id, fecha, hora_inicio, hora_fin, origen)
shift_recommendations (id uuid pk, sede_id, semana_iso, bloques_sugeridos jsonb, generado_at, modelo_usado)
                       -- unique (sede_id, semana_iso)
logs (append-only)    (id uuid pk, evento, entidad_tipo, entidad_id, actor_id, sede_id, resultado, detalle jsonb, timestamp)
```

DDL exacto: `apps/backend/app/db.py` (`_SCHEMA`, aplicado automáticamente al arrancar). Modelos de request/response (Pydantic): `apps/backend/app/models/`.

## 4. Viabilidad y riesgos

| Riesgo | Mitigación |
|---|---|
| Calidad de imagen (borrosa, mal iluminada) | Validación de nitidez en el cliente antes de subir, guía visual de encuadre |
| Latencia de la IA de visión | Subida asíncrona: confirmación instantánea + notificación push con el resultado |
| Falsos positivos/negativos en duplicados | Restricción `unique` a nivel de DB (`tipo` + `indicativo_numero`) + `hash_evidencia` único como respaldo |
| Condición de carrera entre 2 sedes casi simultáneas | `INSERT` atómico contra el `unique` constraint como barrera final; Postgres rechaza el segundo insert con `UniqueViolationError` (`app/services/duplicates.py`) |
| Costo/rate limits del proveedor de IA | El cliente de OpenAI reintenta solo con backoff exponencial ante 429/5xx/timeouts (`max_retries` del SDK); `HTTP: procesar entrega` en n8n reintenta ante caídas de conexión contra el backend (`retryOnFail` en `pipeline-despacho.json`). Cachear por hash de imagen sigue pendiente |
| Conectividad intermitente en sede | Cola offline con idempotency key por captura (pendiente en `apps/mobile`) |
| Poco histórico para el modelo de turnos | Empezar con percentiles simples (implementado), avanzar a forecasting estacional con ≥2-3 meses de datos |

## Estructura del repositorio

```
apps/
  mobile/      React Native + Expo — captura del operador
  backend/     FastAPI — pipeline, API, job de turnos
  dashboard/   Next.js — panel en tiempo (casi) real
n8n/
  workflows/   Documentación de los flujos de orquestación
docs/
  architecture.md  Este documento
```
