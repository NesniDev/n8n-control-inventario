import json

import asyncpg

from app.config import get_settings

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Codec para que json/jsonb viajen como dict/list de Python en vez de
    # texto crudo — evita json.dumps/loads repetido en cada query.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )
    await conn.set_type_codec(
        "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )

# El indice unico sobre (tipo, indicativo_numero) es la barrera real contra
# duplicados entre sedes: la validacion en la app es UX, esta es la que no
# se puede saltar (ver app/services/duplicates.py).
_SCHEMA = """
create extension if not exists pgcrypto;

create table if not exists sedes (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    codigo text not null unique,
    direccion text not null default '',
    timezone text not null default 'America/Bogota',
    activa boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists empleados (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    sede_id text not null,
    rol text not null default 'operador' check (rol in ('operador', 'supervisor', 'admin')),
    estado text not null default 'activo',
    pin_hash text,
    pin_salt text,
    created_at timestamptz not null default now()
);

-- Columnas agregadas despues del primer deploy: CREATE TABLE IF NOT EXISTS
-- no altera una tabla que ya existe, asi que las agregamos aparte (idempotente).
alter table empleados add column if not exists pin_hash text;
alter table empleados add column if not exists pin_salt text;

-- Roles agregados despues del primer deploy: 'punto_venta' factura primero
-- (crea la entrega como "nueva"), el bodeguero ('operador') solo puede
-- re-fotografiar un documento que punto_venta ya facturo -- ver
-- FacturacionRequerida en duplicates.py. 'faia_viewer' es de solo lectura,
-- ve las fotos marcadas es_faia (GET /entregas/faia), no crea ni confirma
-- nada. El check constraint no es CREATE TABLE IF NOT EXISTS, asi que para
-- ampliar la lista de valores permitidos sobre una base ya existente se
-- dropea y se recrea con el nombre por default de Postgres para un check
-- inline (<tabla>_<columna>_check) -- mismo tipo de ajuste que el drop del
-- check de "tipo" en entregas, pero aca hace falta reponerlo con la lista
-- ampliada en vez de sacarlo del todo.
alter table empleados drop constraint if exists empleados_rol_check;
alter table empleados add constraint empleados_rol_check
    check (rol in ('operador', 'supervisor', 'admin', 'punto_venta', 'faia_viewer'));

create table if not exists entregas (
    id uuid primary key default gen_random_uuid(),
    tipo text not null default 'FEI',
    indicativo_numero text not null default '',
    hash_evidencia text not null unique,
    sede_origen_id text not null,
    estado text not null default 'pendiente_revision'
        check (estado in ('procesada', 'pendiente_revision', 'duplicado_bloqueado')),
    confianza_ia jsonb not null default '{}',
    evidencia_url text not null,
    operador_id text not null,
    capturado_at timestamptz not null,
    procesado_at timestamptz,
    actualizado_at timestamptz not null default now()
);

create index if not exists idx_entregas_sede_capturado
    on entregas (sede_origen_id, capturado_at desc);

-- Rango de fechas sin filtro de sede (ver GET /ranking/productos) -- el
-- indice de arriba no sirve solo cuando no hay sede_origen_id en el where.
create index if not exists idx_entregas_capturado_at on entregas (capturado_at);

-- Un documento puede traer varios productos, cada uno con su propia cantidad
-- (ver app/services/duplicates.py). Reemplaza los campos unicos
-- cantidad_entregada/cantidad_pendiente/detalle que tenia "entregas" antes.
create table if not exists entrega_items (
    id uuid primary key default gen_random_uuid(),
    entrega_id uuid not null references entregas(id) on delete cascade,
    descripcion text not null default '',
    cantidad_entregada integer not null default 0,
    cantidad_pendiente integer not null default 0,
    creado_at timestamptz not null default now(),
    actualizado_at timestamptz not null default now()
);

create index if not exists idx_entrega_items_entrega on entrega_items (entrega_id);

-- Nota manual por producto (una sola, se sobreescribe) -- info adicional que
-- carga el bodeguero (ej. "llego danado", "faltan 2 cajas"), no viene de la IA.
alter table entrega_items add column if not exists nota text;

-- Migracion desde el modelo anterior (numero_guia/remitente/destinatario/items,
-- duplicado por numero_guia+remitente) al modelo de documentos (tipo +
-- indicativo/numero, cantidad entregada/pendiente). Idempotente: corre igual
-- de bien contra una DB nueva que contra una que ya tenia el esquema viejo.
alter table entregas add column if not exists tipo text not null default 'FEI';
alter table entregas add column if not exists indicativo_numero text not null default '';
-- Foto de respaldo cuando el tipo pertenece a otra sede (ej. FEI escaneado
-- desde Polo Sur) -- ver _TIPO_SEDE_DUENA en app/services/duplicates.py.
alter table entregas add column if not exists traslado_url text;
-- Tipo/indicativo_numero PROPIOS del traslado (ej. TB 9-7980), distintos de
-- los de la factura (tipo/indicativo_numero de arriba) -- se persisten para
-- que buscar_entrega() encuentre la misma entrega buscando por el codigo del
-- traslado, no solo por el de la factura (ver app/routers/entregas.py).
alter table entregas add column if not exists traslado_tipo text;
alter table entregas add column if not exists traslado_indicativo_numero text;
-- Firma del cliente al confirmar la entrega (paso 2, PATCH /entregas/{id}/items)
-- -- foto en si vive en Storage (bucket evidencia, subpath firmas/), aca solo
-- la URL publica. Null si el guardado fue "Guardar nota" (sin cambio de
-- cantidades, no es un evento de entrega -- ver aplicar_actualizacion_items).
alter table entregas add column if not exists firma_url text;
-- Marca a nivel documento (no por item) para el flujo FAIA -- ver rol
-- 'faia_viewer' y GET /entregas/faia. Se carga en el paso 2
-- (PATCH /entregas/{id}/items, ver ActualizarItemsRequest.es_faia), no la
-- pone la IA.
alter table entregas add column if not exists es_faia boolean not null default false;
-- Nota a nivel documento (no por item -- esa ya existe en entrega_items.nota)
-- -- la escribe el bodeguero en PantallaConfirmando (ver
-- ActualizarItemsRequest.nota_general), separada visualmente de las notas
-- por producto. Nullable (a diferencia de es_faia, no tiene "default"
-- razonable -- ausencia de nota no es lo mismo que nota vacia a proposito).
alter table entregas add column if not exists nota_general text;
-- Foto tal como quedo en el insert original (ver procesar_extraccion) --
-- nunca se pisa despues, a diferencia de evidencia_url (que aplicar_actualizacion_items
-- SI actualiza cuando bodega vuelve a fotografiar al confirmar). Mismo
-- criterio de inmutabilidad que operador_id: permite mostrar por separado
-- "la foto de quien facturo" (ej. punto_venta) de "la foto de quien
-- confirmo" (ej. bodega) sin perder ninguna de las dos. Null en filas
-- existentes de antes de esta columna -- esas fotos originales ya se
-- perdieron (se pisaron), no hay forma de recuperarlas retroactivamente.
alter table entregas add column if not exists evidencia_creacion_url text;
-- Quien de bodega confirmo cantidades reales por ultima vez (ver
-- aplicar_actualizacion_items) -- a diferencia de operador_id (el creador,
-- inmutable), esta SI se actualiza en cada confirmacion con items reales, asi
-- refleja quien esta con la factura ahora. Null hasta que alguien confirme
-- algo de verdad (ej. punto_venta factura y todavia nadie de bodega la toco)
-- -- el dashboard muestra "NE" en ese caso.
alter table entregas add column if not exists bodeguero_id text;
-- Migracion a items por entrega (un documento puede traer varios productos):
-- cantidad_entregada/cantidad_pendiente/detalle (si existian de una version
-- anterior) se mudan a entrega_items.
alter table entregas drop column if exists cantidad_entregada;
alter table entregas drop column if exists cantidad_pendiente;
alter table entregas drop column if exists detalle;
alter table entregas drop column if exists numero_guia;
alter table entregas drop column if exists remitente;
alter table entregas drop column if exists destinatario;
alter table entregas drop column if exists items;
alter table entregas drop column if exists sede_destino_id;

do $$
begin
    alter table entregas drop constraint if exists entregas_numero_guia_remitente_key;
exception when undefined_object then null;
end $$;

-- "tipo" dejo de estar atado a los 4 valores conocidos (FEI/TB/RM3/RM2): en
-- la practica el documento real no siempre es uno de esos, hace falta poder
-- escribir uno nuevo (ver vision.py, EntregaRevision, buscar_entrega). Se
-- saca el check -- drop es idempotente sin necesidad de chequear pg_constraint
-- primero (a diferencia del unique de mas abajo, un check no deja indice atras).
alter table entregas drop constraint if exists entregas_tipo_check;

-- OJO: un unique constraint crea un indice con el mismo nombre por debajo;
-- si ya existe, Postgres tira duplicate_table (42P07) en vez de
-- duplicate_object (42710) al intentar recrearlo, asi que la constraint por
-- excepcion (como la del publication de mas abajo) no alcanza aca — hay que
-- chequear existencia antes en pg_constraint.

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'entregas_tipo_indicativo_numero_key' and conrelid = 'entregas'::regclass
    ) then
        alter table entregas add constraint entregas_tipo_indicativo_numero_key unique (tipo, indicativo_numero);
    end if;
end $$;

create table if not exists turnos (
    id uuid primary key default gen_random_uuid(),
    empleado_id text not null,
    sede_id text not null,
    fecha date not null,
    hora_inicio time not null,
    hora_fin time not null,
    origen text not null default 'manual' check (origen in ('manual', 'sugerido_ia')),
    created_at timestamptz not null default now()
);

create index if not exists idx_turnos_sede_fecha on turnos (sede_id, fecha);

create table if not exists shift_recommendations (
    id uuid primary key default gen_random_uuid(),
    sede_id text not null,
    semana_iso text not null,
    bloques_sugeridos jsonb not null default '[]',
    generado_at timestamptz not null default now(),
    modelo_usado text not null default 'percentiles_p50_p90',
    unique (sede_id, semana_iso)
);

-- Append-only: solo se inserta, nunca se actualiza ni se borra.
create table if not exists logs (
    id uuid primary key default gen_random_uuid(),
    evento text not null,
    entidad_tipo text not null,
    entidad_id text not null,
    actor_id text not null,
    sede_id text not null,
    resultado text not null,
    detalle jsonb not null default '{}',
    "timestamp" timestamptz not null default now()
);

create index if not exists idx_logs_timestamp on logs ("timestamp" desc);
create index if not exists idx_logs_entidad on logs (entidad_tipo, entidad_id);

-- Devolucion de un producto ya entregado (ver app/services/devoluciones.py).
-- 'reposicion' hace que esa cantidad vuelva a quedar pendiente (se debe
-- re-entregar); 'reembolso' la finaliza -- no vuelve a pendiente, esas
-- unidades salen del total (se devolvio el dinero, no un reemplazo).
create table if not exists devoluciones (
    id uuid primary key default gen_random_uuid(),
    entrega_id uuid not null references entregas(id) on delete cascade,
    item_id uuid not null references entrega_items(id) on delete cascade,
    cantidad integer not null check (cantidad > 0),
    motivo text not null,
    resolucion text not null,
    operador_id text not null,
    sede_id text not null,
    creado_at timestamptz not null default now()
);

create index if not exists idx_devoluciones_entrega on devoluciones (entrega_id);

-- Catalogo codigo -> nombre de producto, deducido de entrega_items.descripcion (ver
-- app/services/productos.py) -- se auto-completa a medida que se procesan/corrigen
-- facturas, sin backfill de lo historico. unique(codigo) es lo que garantiza "sin que
-- se repitan" (el insert usa on conflict do nothing).
create table if not exists productos (
    id uuid primary key default gen_random_uuid(),
    codigo text not null unique,
    nombre text not null,
    creado_at timestamptz not null default now()
);

-- Traslados entre puntos (bodega origen -> conductor -> bodega destino, ver
-- plan "traslados-entre-puntos"): puntos es una lista de lugares DISTINTA de
-- sedes (despachos), con sus propios usuarios. Tablas aditivas, no tocan
-- entregas/sedes/empleados.
create table if not exists puntos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists usuarios_punto (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    punto_id uuid not null references puntos(id),
    pin_hash text,
    pin_salt text,
    estado text not null default 'activo',
    created_at timestamptz not null default now()
);

create index if not exists idx_usuarios_punto_punto on usuarios_punto (punto_id);

-- Codigo corto del punto (ej. "CFC") -- el nombre guarda la etiqueta completa
-- tal como la usan en bodega ("CFC — La Cumbre"); el codigo queda aparte para
-- ordenar y buscar sin parsear el nombre (ver scripts/cargar_puntos.py).
alter table puntos add column if not exists codigo text;
create unique index if not exists puntos_codigo_key on puntos (codigo);

-- El id lo genera el celular (expo-crypto randomUUID()), no gen_random_uuid()
-- del lado del servidor: el path de las firmas en Storage
-- (firmas-traslados/{id}-{rol}.webp) se arma ANTES de crear el traslado, asi
-- que hace falta conocer el id de antemano (ver subirFirmaTraslado en
-- apps/mobile/api.ts y FirmaTransportador).
create table if not exists traslados_puntos (
    id uuid primary key,
    consecutivo bigserial unique,
    punto_origen_id uuid not null references puntos(id),
    punto_destino_id uuid not null references puntos(id),
    transportador_nombre text not null default '',
    fecha date not null,
    observaciones text,
    estado text not null default 'en_transito'
        check (estado in ('en_transito', 'recibido', 'recibido_con_novedad')),
    firma_despacha_url text,
    firma_transporta_url text,
    firma_recibe_url text,
    creado_por uuid not null references usuarios_punto(id),
    recibido_por uuid references usuarios_punto(id),
    recibido_at timestamptz,
    novedad text,
    created_at timestamptz not null default now(),
    check (punto_origen_id <> punto_destino_id)
);

create index if not exists idx_traslados_puntos_destino_estado
    on traslados_puntos (punto_destino_id, estado);
create index if not exists idx_traslados_puntos_origen
    on traslados_puntos (punto_origen_id, created_at desc);

-- Numero impreso en el talonario fisico de traslados (ej. "00231",
-- "A-00231") -- lo tipea el punto que despacha, es lo primero que copia del
-- papel (ver TrasladoPuntoCrear en app/models/traslado_punto.py). Null en
-- los traslados creados antes de este campo -- quedan sin valor para
-- siempre, no hay forma de reconstruirlo despues.
alter table traslados_puntos add column if not exists numero_talonario text;

-- Un traslado puede llevar varios productos, cada uno con su propia cantidad
-- enviada/recibida (mismo criterio que entrega_items para entregas).
create table if not exists traslado_punto_items (
    id uuid primary key default gen_random_uuid(),
    traslado_id uuid not null references traslados_puntos(id) on delete cascade,
    cantidad integer not null check (cantidad > 0),
    producto text not null,
    marca text not null default '',
    presentacion text not null default '',
    -- null hasta que el punto destino confirma la recepcion (ver
    -- registrar_recepcion en app/services/traslados_puntos.py).
    cantidad_recibida integer,
    novedad text
);

create index if not exists idx_traslado_punto_items_traslado on traslado_punto_items (traslado_id);

-- Supervision de novedades (ver el plan "supervision-novedades"): quien
-- resuelve un traslado que llego a un punto con diferencia de cantidad o con
-- una novedad cargada. Cuenta propia -- no es un usuario_punto (no pertenece
-- a un punto) ni un empleado (no pertenece a una sede), solo revisa y
-- resuelve novedades de cualquier traslado.
create table if not exists supervisores (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    pin_hash text,
    pin_salt text,
    estado text not null default 'activo',
    created_at timestamptz not null default now()
);

-- Estado de la novedad de un traslado ya recibido: 'pendiente' apenas
-- registrar_recepcion lo deja en 'recibido_con_novedad', 'resuelta' cuando
-- Supervision carga una solucion (ver resolver_novedad en
-- app/services/traslados_puntos.py). Null en un traslado sin novedad
-- (en_transito o recibido completo) -- no aplica, no se muestra en la
-- bandeja de Supervision.
alter table traslados_puntos add column if not exists novedad_estado text;
alter table traslados_puntos drop constraint if exists traslados_puntos_novedad_estado_check;
alter table traslados_puntos add constraint traslados_puntos_novedad_estado_check
    check (novedad_estado is null or novedad_estado in ('pendiente', 'resuelta'));
alter table traslados_puntos add column if not exists solucion text;
alter table traslados_puntos add column if not exists solucionado_por uuid references supervisores(id);
alter table traslados_puntos add column if not exists solucionado_at timestamptz;

-- Backfill idempotente: traslados que ya habian quedado con novedad antes de
-- que existiera esta columna arrancan en 'pendiente' -- todavia nadie los
-- reviso via Supervision. No pisa una fila que ya tenga novedad_estado
-- seteado (por eso el "is null" -- correr esto de nuevo no revierte una
-- novedad ya resuelta).
update traslados_puntos set novedad_estado = 'pendiente'
    where estado = 'recibido_con_novedad' and novedad_estado is null;

create index if not exists idx_traslados_puntos_novedad_estado
    on traslados_puntos (novedad_estado);

-- Consecutivo bajo el que Supervision guarda la solucion de una novedad
-- (codigo de punto + numero, ej. "NPT-1234", ver resolver_novedad en
-- app/services/traslados_puntos.py). Unico solo entre los que tienen valor
-- (indice parcial) -- una novedad sin resolver no tiene consecutivo todavia,
-- eso no puede chocar con nada.
alter table traslados_puntos add column if not exists consecutivo_solucion text;
create unique index if not exists traslados_puntos_consecutivo_solucion_key
    on traslados_puntos (consecutivo_solucion) where consecutivo_solucion is not null;

-- Realtime de Supabase: sin esto el dashboard no recibe push de cambios,
-- solo podria hacer polling. Falla silenciosamente (DO block) si ya estaban
-- agregadas o si la publicacion no existe (p.ej. Postgres self-hosted sin
-- la extension de Supabase) para no romper el arranque del backend.
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        begin
            alter publication supabase_realtime add table entregas;
        exception when duplicate_object then null;
        end;
        begin
            alter publication supabase_realtime add table entrega_items;
        exception when duplicate_object then null;
        end;
        begin
            alter publication supabase_realtime add table logs;
        exception when duplicate_object then null;
        end;
        begin
            alter publication supabase_realtime add table devoluciones;
        exception when duplicate_object then null;
        end;
        begin
            alter publication supabase_realtime add table productos;
        exception when duplicate_object then null;
        end;
        begin
            alter publication supabase_realtime add table traslados_puntos;
        exception when duplicate_object then null;
        end;
        begin
            alter publication supabase_realtime add table traslado_punto_items;
        exception when duplicate_object then null;
        end;
    end if;
end $$;
"""


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            get_settings().database_url, min_size=1, max_size=10, init=_init_connection
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def ensure_schema() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(_SCHEMA)
