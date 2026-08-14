"""Provisiona el bucket de Supabase Storage donde la app movil sube las fotos
de evidencia, y las policies de RLS que permiten subir/leer con la anon key
(la app movil nunca usa la service_role key). Idempotente — se puede correr
mas de una vez.

Requiere en apps/backend/.env:
    SUPABASE_URL=https://<project-ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...
    DATABASE_URL=... (conexion directa a Postgres, ya usada por el resto del backend)

Uso:
    python -m scripts.setup_storage
"""

import asyncio

import asyncpg
import httpx

from app.config import get_settings

BUCKET = "evidencia"


async def crear_bucket(supabase_url: str, service_role_key: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{supabase_url}/storage/v1/bucket",
            headers={
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
            },
            json={"id": BUCKET, "name": BUCKET, "public": True},
        )
        if resp.status_code == 200:
            print(f"[storage] bucket '{BUCKET}' creado")
        elif resp.status_code == 400 and "already exists" in resp.text.lower():
            print(f"[storage] bucket '{BUCKET}' ya existia")
        else:
            resp.raise_for_status()


async def crear_policies(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(
            f"""
            drop policy if exists "evidencia_anon_insert" on storage.objects;
            create policy "evidencia_anon_insert" on storage.objects
                for insert to anon
                with check (bucket_id = '{BUCKET}');

            drop policy if exists "evidencia_anon_select" on storage.objects;
            create policy "evidencia_anon_select" on storage.objects
                for select to anon
                using (bucket_id = '{BUCKET}');
            """
        )
        print("[storage] policies de RLS aplicadas (anon insert/select sobre el bucket)")
    finally:
        await conn.close()


async def main() -> None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise SystemExit(
            "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en apps/backend/.env"
        )
    await crear_bucket(settings.supabase_url, settings.supabase_service_role_key)
    await crear_policies(settings.database_url)


if __name__ == "__main__":
    asyncio.run(main())
