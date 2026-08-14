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

# El indice unico sobre (numero_guia, remitente) es la barrera real contra
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
    created_at timestamptz not null default now()
);

create table if not exists entregas (
    id uuid primary key default gen_random_uuid(),
    numero_guia text not null,
    hash_evidencia text not null unique,
    sede_origen_id text not null,
    sede_destino_id text,
    remitente text not null,
    destinatario text not null,
    items jsonb not null default '[]',
    estado text not null default 'pendiente_revision'
        check (estado in ('procesada', 'pendiente_revision', 'duplicado_bloqueado')),
    confianza_ia jsonb not null default '{}',
    evidencia_url text not null,
    operador_id text not null,
    capturado_at timestamptz not null,
    procesado_at timestamptz,
    actualizado_at timestamptz not null default now(),
    unique (numero_guia, remitente)
);

create index if not exists idx_entregas_sede_capturado
    on entregas (sede_origen_id, capturado_at desc);

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
