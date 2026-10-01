"""Reporte de facturas faltantes: un empleado de bodega (operador) avisa que
una factura todavia no fue subida por el mostrador (punto_venta) de la sede
duena de ese tipo de documento (o de su propia sede si el tipo no tiene duena).
Los mostradores ven los reportes pendientes dirigidos a su sede, y el reporte se
cierra solo cuando esa factura entra a `entregas` (ver resolver_por_entrega,
que llama procesar_extraccion en duplicates.py). Ver tabla facturas_faltantes
en app/db.py.
"""

import asyncpg

from app.db import get_pool
from app.models.factura_faltante import EstadoFacturaFaltante
from app.models.log import EventoLog
from app.services.logging_service import registrar_evento

# Roles que pueden reportar una factura faltante (bodega y sus superiores).
_ROLES_REPORTAN = ("operador", "supervisor", "admin")
# Roles que pueden descartar un reporte de su sede (ademas de quien lo hizo).
# punto_venta NO: el mostrador solo puede marcarla como subida (marcar_subida),
# para que un aviso no se cierre sin que la factura exista.
_ROLES_DESCARTAN = ("supervisor", "admin")
# Roles que pueden marcar un reporte como "ya subida" (mostrador de la sede destino).
_ROLES_MARCAN_SUBIDA = ("punto_venta", "supervisor", "admin")


class FacturaYaReportada(Exception):
    """Ya hay un reporte pendiente para ese (tipo, indicativo_numero)."""


class FacturaYaSubida(Exception):
    """La factura ya existe en entregas -- no hay nada que reportar."""


class ReporteNoAutorizado(Exception):
    """El empleado no existe, esta inactivo, tiene un rol que no corresponde
    o es de otra sede."""


class ReporteNoEncontrado(Exception):
    pass


class FacturaNoRegistrada(Exception):
    """Se intento marcar como subida una factura que todavia no esta en entregas."""


class ReporteYaCerrado(Exception):
    """El reporte ya esta resuelto o descartado -- solo se descarta desde pendiente."""


_SELECT_REPORTE = """
    select f.id, f.tipo, f.indicativo_numero, f.sede_id,
           coalesce(f.sede_reporta_id, f.sede_id) as sede_reporta_id,
           s.nombre as sede_nombre, sr.nombre as sede_reporta_nombre,
           f.reportado_por, e.nombre as reportado_por_nombre, f.reportado_at,
           f.estado, f.entrega_id, f.cerrada_at, f.cerrada_por,
           ec.nombre as cerrada_por_nombre
    from facturas_faltantes f
    left join empleados ec on ec.id::text = f.cerrada_por
    left join empleados e on e.id::text = f.reportado_por
    left join sedes s on s.id::text = f.sede_id
    left join sedes sr on sr.id::text = coalesce(f.sede_reporta_id, f.sede_id)
"""


def _a_dict(row: asyncpg.Record) -> dict:
    fila = dict(row)
    fila["id"] = str(fila["id"])
    if fila.get("entrega_id") is not None:
        fila["entrega_id"] = str(fila["entrega_id"])
    return fila


async def _empleado_activo(conn: asyncpg.Connection, empleado_id: str) -> asyncpg.Record | None:
    # id::text: empleado_id llega como texto libre del celular, comparar contra
    # el cast evita un error de sintaxis uuid si viene algo que no lo es.
    return await conn.fetchrow(
        "select id, sede_id, rol from empleados where id::text = $1 and estado = 'activo'",
        empleado_id,
    )


async def reportar(*, tipo: str, indicativo_numero: str, empleado_id: str, sede_id: str) -> dict:
    # Misma normalizacion que procesar_extraccion (duplicates.py): sin esto
    # "fei" y "FEI" serian documentos distintos para el unique y para entregas.
    tipo = tipo.strip().upper()
    indicativo_numero = indicativo_numero.strip()

    pool = await get_pool()
    async with pool.acquire() as conn:
        empleado = await _empleado_activo(conn, empleado_id)
        if empleado is None or empleado["rol"] not in _ROLES_REPORTAN or empleado["sede_id"] != sede_id:
            raise ReporteNoAutorizado()

        ya_subida = await conn.fetchval(
            "select 1 from entregas where tipo = $1 and indicativo_numero = $2",
            tipo,
            indicativo_numero,
        )
        if ya_subida:
            raise FacturaYaSubida()

        # Sede destino: la duena del tipo (EDP/EDV -> Polo Sur, FEI/FV1 -> Sede
        # Centro); sin duena (o si el codigo no existe en sedes) queda la del
        # que reporta.
        # Import perezoso: duplicates.py importa este modulo (resolver_por_entrega).
        from app.services.duplicates import _TIPO_SEDE_DUENA

        sede_destino_id = sede_id
        codigo_duena = _TIPO_SEDE_DUENA.get(tipo)
        if codigo_duena is not None:
            id_duena = await conn.fetchval("select id::text from sedes where codigo = $1", codigo_duena)
            if id_duena is not None:
                sede_destino_id = id_duena

        try:
            reporte_id = await conn.fetchval(
                """
                insert into facturas_faltantes
                    (tipo, indicativo_numero, sede_id, sede_reporta_id, reportado_por)
                values ($1, $2, $3, $4, $5)
                returning id
                """,
                tipo,
                indicativo_numero,
                sede_destino_id,
                sede_id,
                empleado_id,
            )
        except asyncpg.UniqueViolationError as exc:
            # El unique parcial (solo estado = 'pendiente') es la barrera real
            # contra dos reportes simultaneos del mismo documento.
            raise FacturaYaReportada() from exc

        fila = await conn.fetchrow(_SELECT_REPORTE + " where f.id = $1", reporte_id)

    await registrar_evento(
        EventoLog.FACTURA_FALTANTE_REPORTADA,
        entidad_tipo="factura_faltante",
        entidad_id=str(reporte_id),
        actor_id=empleado_id,
        sede_id=sede_id,
        resultado="ok",
        detalle={"tipo": tipo, "indicativo_numero": indicativo_numero, "sede_destino_id": sede_destino_id},
    )
    return _a_dict(fila)


async def listar(
    sede_id: str,
    estado: str = EstadoFacturaFaltante.PENDIENTE.value,
    vista: str = "destino",
    horas: int | None = None,
) -> list[dict]:
    """vista 'destino' (mostrador): reportes dirigidos a `sede_id`. Vista 'sede'
    (bodega): los dirigidos a `sede_id` mas los que esa sede reporto hacia otra.
    `horas` limita a lo cerrado/reportado en las ultimas N horas."""
    if vista == "sede":
        filtro_sede = "(f.sede_id = $1 or coalesce(f.sede_reporta_id, f.sede_id) = $1)"
    else:
        filtro_sede = "f.sede_id = $1"
    args: list = [sede_id, estado]
    filtro_horas = ""
    if horas is not None:
        args.append(horas)
        filtro_horas = " and coalesce(f.cerrada_at, f.reportado_at) >= now() - make_interval(hours => $3)"
    # Los cerrados se muestran del mas reciente al mas viejo; los pendientes, del mas antiguo.
    orden = "f.cerrada_at desc" if estado != EstadoFacturaFaltante.PENDIENTE.value else "f.reportado_at asc"
    pool = await get_pool()
    rows = await pool.fetch(
        _SELECT_REPORTE + f" where {filtro_sede} and f.estado = $2{filtro_horas} order by {orden}",
        *args,
    )
    return [_a_dict(r) for r in rows]


async def descartar(reporte_id: str, empleado_id: str) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        reporte = await conn.fetchrow(
            "select id, tipo, indicativo_numero, sede_id, reportado_por, estado"
            " from facturas_faltantes where id::text = $1",
            reporte_id,
        )
        if reporte is None:
            raise ReporteNoEncontrado()

        empleado = await _empleado_activo(conn, empleado_id)
        if empleado is None:
            raise ReporteNoAutorizado()
        es_quien_reporto = reporte["reportado_por"] == empleado_id
        es_de_la_sede = empleado["sede_id"] == reporte["sede_id"] and empleado["rol"] in _ROLES_DESCARTAN
        if not (es_quien_reporto or es_de_la_sede):
            raise ReporteNoAutorizado()

        # El where estado = 'pendiente' cubre la carrera con el cierre
        # automatico (resolver_por_entrega): si ya se cerro, no devuelve fila.
        actualizado = await conn.fetchval(
            """
            update facturas_faltantes
            set estado = 'descartada', cerrada_at = now(), cerrada_por = $2
            where id = $1 and estado = 'pendiente'
            returning id
            """,
            reporte["id"],
            empleado_id,
        )
        if actualizado is None:
            raise ReporteYaCerrado()
        fila = await conn.fetchrow(_SELECT_REPORTE + " where f.id = $1", reporte["id"])

    await registrar_evento(
        EventoLog.FACTURA_FALTANTE_DESCARTADA,
        entidad_tipo="factura_faltante",
        entidad_id=str(reporte["id"]),
        actor_id=empleado_id,
        sede_id=reporte["sede_id"],
        resultado="ok",
        detalle={"tipo": reporte["tipo"], "indicativo_numero": reporte["indicativo_numero"]},
    )
    return _a_dict(fila)


async def marcar_subida(reporte_id: str, empleado_id: str) -> dict:
    """El mostrador confirma "ya la subi". Verifica primero que la factura exista
    en entregas; si no, FacturaNoRegistrada (no se cierra nada)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        reporte = await conn.fetchrow(
            "select id, tipo, indicativo_numero, sede_id, estado from facturas_faltantes where id::text = $1",
            reporte_id,
        )
        if reporte is None:
            raise ReporteNoEncontrado()

        empleado = await _empleado_activo(conn, empleado_id)
        if empleado is None or empleado["rol"] not in _ROLES_MARCAN_SUBIDA or empleado["sede_id"] != reporte["sede_id"]:
            raise ReporteNoAutorizado()

        if reporte["estado"] == EstadoFacturaFaltante.RESUELTA.value:
            # Ya se cerro sola al entrar la factura: exito idempotente.
            return _a_dict(await conn.fetchrow(_SELECT_REPORTE + " where f.id = $1", reporte["id"]))
        if reporte["estado"] != EstadoFacturaFaltante.PENDIENTE.value:
            raise ReporteYaCerrado()

        entrega_id = await conn.fetchval(
            "select id from entregas where tipo = $1 and indicativo_numero = $2",
            reporte["tipo"],
            reporte["indicativo_numero"],
        )
        if entrega_id is None:
            raise FacturaNoRegistrada()

        # El where estado = 'pendiente' cubre la carrera con el cierre automatico.
        actualizado = await conn.fetchval(
            """
            update facturas_faltantes
            set estado = 'resuelta', entrega_id = $2, cerrada_at = now(), cerrada_por = $3
            where id = $1 and estado = 'pendiente'
            returning id
            """,
            reporte["id"],
            entrega_id,
            empleado_id,
        )
        fila = await conn.fetchrow(_SELECT_REPORTE + " where f.id = $1", reporte["id"])
        if actualizado is None:
            # Se cerro entre la lectura y el update: exito solo si quedo resuelta.
            if fila["estado"] == EstadoFacturaFaltante.RESUELTA.value:
                return _a_dict(fila)
            raise ReporteYaCerrado()

    await registrar_evento(
        EventoLog.FACTURA_FALTANTE_RESUELTA,
        entidad_tipo="factura_faltante",
        entidad_id=str(reporte["id"]),
        actor_id=empleado_id,
        sede_id=reporte["sede_id"],
        resultado="manual",
        detalle={
            "tipo": reporte["tipo"],
            "indicativo_numero": reporte["indicativo_numero"],
            "entrega_id": str(entrega_id),
        },
    )
    return _a_dict(fila)


async def resolver_por_entrega(
    conn: asyncpg.Connection, tipo: str, indicativo_numero: str, entrega_id
) -> list[str]:
    """Cierra como 'resuelta' el reporte pendiente de ese documento, si lo hay.

    Corre sobre la conexion que le pasan para quedar dentro de la transaccion
    del insert en entregas (si esa transaccion hace rollback, el reporte
    vuelve a pendiente). Devuelve los ids resueltos para que el llamador
    escriba el log recien despues del commit.
    """
    rows = await conn.fetch(
        """
        update facturas_faltantes
        set estado = 'resuelta', entrega_id = $3, cerrada_at = now()
        where tipo = $1 and indicativo_numero = $2 and estado = 'pendiente'
        returning id
        """,
        tipo,
        indicativo_numero,
        entrega_id,
    )
    return [str(r["id"]) for r in rows]
