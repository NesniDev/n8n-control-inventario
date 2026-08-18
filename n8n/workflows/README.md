# Flujos de n8n

Referencia de los dos workflows de orquestación descritos en la
[arquitectura](../../docs/architecture.md). n8n no reimplementa la lógica de
negocio (eso vive en `apps/backend`) — orquesta el trigger, las llamadas
externas y las notificaciones alrededor de ella.

**`pipeline-despacho.json`** en esta misma carpeta es un export real e
importable (Workflows → Import from File en la UI de n8n) del Workflow 1
descrito abajo — sin credenciales de Slack/Email reales (esos nodos vienen
como `NoOp`, listos para reemplazar). El Workflow 2 (cron de turnos) no se
versiona como JSON porque es un `Schedule Trigger` + `Execute Command`
directo, más simple de armar a mano siguiendo la tabla de abajo.

## Workflow 1 — Pipeline de despacho

Corresponde a la Figura 1 del diagrama de arquitectura. Se dispara cuando un
operador sube una foto desde la app móvil.

| # | Nodo | Tipo | Qué hace |
|---|---|---|---|
| 1 | `Webhook: foto subida` | Webhook Trigger | Recibe `{ evidencia_url, hash_evidencia, sede_origen_id, operador_id, capturado_at }` una vez que la app móvil confirma la subida a Storage. |
| 2 | `HTTP: procesar entrega` | HTTP Request | `POST` al backend: `{{$env.API_BASE_URL}}/entregas/procesar` con el body del webhook. El backend ya ejecuta extracción por IA, chequeo de duplicados, inserción y logging (ver `apps/backend/app/routers/entregas.py`). |
| 3 | `IF: estado` | IF | Rama según la respuesta: `procesada` → continuar; `pendiente_revision` → notificar supervisor; `409` (duplicado) → notificar alerta de duplicado. |
| 4a | `Notificar: revisión manual` | Slack / Email / WhatsApp Business | Aviso al supervisor de la sede con el link a la entrega en el dashboard. |
| 4b | `Notificar: duplicado bloqueado` | Slack / Email | Aviso a ambas sedes involucradas (origen del intento + sede que ya la había registrado) citando el evento de `logs`. |
| 5 | `Respond to Webhook` | Respond to Webhook | Devuelve el resultado a la app móvil (código 201 / 409 / 502 según corresponda). |

**Reintentos:**
- `HTTP: procesar entrega` tiene `retryOnFail` (3 intentos, 2s entre cada uno)
  configurado en `pipeline-despacho.json` — absorbe caídas transitorias de
  red/conexión contra el backend (ej. el VPS reiniciando a mitad de un
  deploy). El nodo usa `neverError: true` para poder ramificar sobre
  respuestas de negocio (409 duplicado, 422 validación) sin que n8n las trate
  como fallo, así que estos reintentos solo se disparan ante errores reales
  de conexión, no ante esos códigos de estado — reintentarlos no tendría
  sentido, van a fallar siempre igual.
- La IA de visión (`apps/backend/app/services/vision.py`) **no necesita**
  reintento acá: el cliente de OpenAI (`openai==1.59.6`) ya reintenta solo,
  con backoff exponencial + jitter, ante 408/409/429/5xx y errores de
  conexión/timeout (`max_retries=2` por defecto = 3 intentos totales). Si
  `/entregas/procesar` devuelve 502, es porque ya se agotaron esos intentos
  del lado del backend.

## Workflow 2 — Analítica semanal de turnos

Corresponde a la Figura 2. Se dispara por cron, no por evento.

| # | Nodo | Tipo | Qué hace |
|---|---|---|---|
| 1 | `Cron: semanal` | Schedule Trigger | Ej. todos los lunes 03:00, zona horaria de la sede. |
| 2 | `Execute Command` | Execute Command | Corre `python -m scripts.generar_turnos` dentro del entorno del backend (ver `apps/backend/scripts/generar_turnos.py`), que agrega `entregas`, calcula percentiles y escribe en `shift_recommendations`. |
| 3 | `HTTP: obtener recomendaciones` | HTTP Request | `GET {{$env.API_BASE_URL}}/turnos/recomendaciones` para armar el mensaje de notificación. |
| 4 | `Notificar: RRHH/supervisores` | Slack / Email | Envía el resumen de bloques sugeridos por sede. |

## Variables de entorno de n8n

| Variable | Ejemplo |
|---|---|
| `API_BASE_URL` | `https://api.tuempresa.com` |
| `SLACK_WEBHOOK_URL` / credencial Slack | — |
