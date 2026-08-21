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

-- OJO: un unique constraint crea un indice con el mismo nombre por debajo;
-- si ya existe, Postgres tira duplicate_table (42P07) en vez de
-- duplicate_object (42710) al intentar recrearlo, asi que la constraint por
-- excepcion (como la del publication de mas abajo) no alcanza aca — hay que
-- chequear existencia antes en pg_constraint.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'entregas_tipo_check' and conrelid = 'entregas'::regclass
    ) then
        alter table entregas add constraint entregas_tipo_check check (tipo in ('FEI', 'TB', 'RM3', 'RM2'));
    end if;
end $$;

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
