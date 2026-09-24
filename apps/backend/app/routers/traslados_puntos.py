"""Endpoints de puntos (bodegas del flujo de traslados, distintas de las
sedes de despachos) y del flujo de traslados entre puntos -- ver
app/services/traslados_puntos.py y el plan "traslados-entre-puntos". Todo en
un solo router (dos prefijos de path, /puntos y /traslados-puntos) porque son
el mismo flujo chico, igual que sedes/empleados son routers separados pero
ahi si son dos flujos con entidad propia bien grande cada uno.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.models.punto import PinLoginPunto, PuntoCrear, UsuarioPuntoCrear
from app.models.supervisor import PinLoginSupervisor
from app.models.traslado_punto import RecepcionTraslado, SolucionNovedad, TrasladoPuntoCrear
from app.routers.entregas import _verificar_token_admin
from app.services.auth_pin import generar_sal, hashear_pin, verificar_pin
from app.services.traslados_puntos import (
    ConsecutivoDuplicado,
    NovedadInvalida,
    NovedadNoEncontrada,
    NovedadYaResuelta,
    TrasladoInvalido,
    TrasladoNoEncontrado,
    TrasladoYaRecibido,
    crear_traslado,
    registrar_recepcion,
    resolver_novedad,
)

router = APIRouter(tags=["traslados-puntos"])


def _sin_pin(row) -> dict:
    fila = dict(row)
    fila.pop("pin_hash", None)
    fila.pop("pin_salt", None)
    fila["id"] = str(fila["id"])
    if fila.get("punto_id") is not None:
        fila["punto_id"] = str(fila["punto_id"])
    return fila


@router.get("/puntos")
async def listar_puntos() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select id, nombre, codigo from puntos where activo = true order by codigo nulls last, nombre"
    )
    return [{"id": str(r["id"]), "nombre": r["nombre"], "codigo": r["codigo"]} for r in rows]


@router.post("/puntos", status_code=201, dependencies=[Depends(_verificar_token_admin)])
async def crear_punto(payload: PuntoCrear) -> dict:
    """Alta de un punto -- protegida con X-Admin-Token (mismo mecanismo que
    el borrado definitivo de entregas, ver _verificar_token_admin). Sin
    pantalla de admin todavia (fuera de alcance del plan); se usa desde aca
    o desde scripts/crear_punto.py."""
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "insert into puntos (nombre) values ($1) returning id, nombre", payload.nombre
        )
    except Exception as exc:  # noqa: BLE001 - mismo criterio que crear_empleado/crear_sede
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": str(row["id"]), "nombre": row["nombre"]}


@router.get("/puntos/{punto_id}/usuarios")
async def listar_usuarios_punto(punto_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from usuarios_punto where punto_id = $1::uuid and estado = 'activo' order by nombre",
        punto_id,
    )
    return [_sin_pin(r) for r in rows]


@router.post("/puntos/{punto_id}/usuarios", status_code=201, dependencies=[Depends(_verificar_token_admin)])
async def crear_usuario_punto(punto_id: str, payload: UsuarioPuntoCrear) -> dict:
    pool = await get_pool()
    sal = generar_sal()
    pin_hash = hashear_pin(payload.pin, sal)
    try:
        row = await pool.fetchrow(
            """
            insert into usuarios_punto (nombre, punto_id, pin_hash, pin_salt)
            values ($1, $2::uuid, $3, $4)
            returning *
            """,
            payload.nombre,
            punto_id,
            pin_hash,
            sal,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _sin_pin(row)


@router.post("/puntos/auth/pin")
async def login_pin_punto(payload: PinLoginPunto) -> dict:
    """Mismo patron que POST /auth/pin de empleados (app/routers/auth.py) --
    el usuario de punto ya se eligio en el paso anterior del login movil, el
    PIN solo confirma esa identidad puntual."""
    pool = await get_pool()
    candidato = await pool.fetchrow(
        "select * from usuarios_punto where id = $1::uuid and estado = 'activo' and pin_hash is not null",
        payload.usuario_id,
    )
    if candidato and verificar_pin(payload.pin, candidato["pin_salt"], candidato["pin_hash"]):
        return {
            "id": str(candidato["id"]),
            "nombre": candidato["nombre"],
            "punto_id": str(candidato["punto_id"]),
        }
    raise HTTPException(status_code=401, detail="PIN incorrecto")


@router.get("/supervisores")
async def listar_supervisores() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("select id, nombre from supervisores where estado = 'activo' order by nombre")
    return [{"id": str(r["id"]), "nombre": r["nombre"]} for r in rows]


@router.post("/supervisores/auth/pin")
async def login_pin_supervisor(payload: PinLoginSupervisor) -> dict:
    """Mismo patron que POST /puntos/auth/pin -- el supervisor ya se eligio
    en el paso anterior del login movil (hoy solo Erika), el PIN solo
    confirma esa identidad."""
    pool = await get_pool()
    candidato = await pool.fetchrow(
        "select * from supervisores where id = $1::uuid and estado = 'activo' and pin_hash is not null",
        payload.supervisor_id,
    )
    if candidato and verificar_pin(payload.pin, candidato["pin_salt"], candidato["pin_hash"]):
        return {"id": str(candidato["id"]), "nombre": candidato["nombre"]}
    raise HTTPException(status_code=401, detail="PIN incorrecto")


_SELECT_TRASLADOS = """
    select t.*, po.nombre as punto_origen_nombre, pd.nombre as punto_destino_nombre,
        s.nombre as solucionado_por_nombre,
        (select count(*) from traslado_punto_items ti where ti.traslado_id = t.id) as cantidad_items
    from traslados_puntos t
    left join puntos po on po.id = t.punto_origen_id
    left join puntos pd on pd.id = t.punto_destino_id
    left join supervisores s on s.id = t.solucionado_por
"""

_CAMPOS_UUID_TRASLADO = (
    "id",
    "punto_origen_id",
    "punto_destino_id",
    "creado_por",
    "recibido_por",
    "solucionado_por",
)


def _serializar_traslado(fila: dict, items: list[dict] | None = None) -> dict:
    """uuid -> str en los campos del traslado (y de sus items, si vienen) --
    asyncpg devuelve uuid.UUID crudo, que json no sabe serializar solo."""
    resultado = dict(fila)
    for campo in _CAMPOS_UUID_TRASLADO:
        if resultado.get(campo) is not None:
            resultado[campo] = str(resultado[campo])
    if items is not None:
        resultado["items"] = [
            {**item, "id": str(item["id"]), "traslado_id": str(item["traslado_id"])} for item in items
        ]
    return resultado


@router.post("/traslados-puntos", status_code=201)
async def crear_traslado_endpoint(payload: TrasladoPuntoCrear) -> dict:
    try:
        resultado = await crear_traslado(payload)
    except TrasladoInvalido as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    items = resultado.pop("items")
    return _serializar_traslado(resultado, items)


@router.get("/traslados-puntos")
async def listar_traslados(
    # UUID (no str): un id mal formado responde 422 en vez de romper el
    # cast ::uuid de Postgres con un 500.
    destino_id: UUID | None = None, origen_id: UUID | None = None, estado: str | None = None
) -> list[dict]:
    """Bandeja por recibir (destino_id) o enviados (origen_id) -- devuelve el
    conteo de items, no la lista completa (ver GET /traslados-puntos/{id}
    para el detalle con items)."""
    pool = await get_pool()
    condiciones: list[str] = []
    parametros: list[object] = []
    if destino_id:
        parametros.append(str(destino_id))
        condiciones.append(f"t.punto_destino_id = ${len(parametros)}::uuid")
    if origen_id:
        parametros.append(str(origen_id))
        condiciones.append(f"t.punto_origen_id = ${len(parametros)}::uuid")
    if estado:
        parametros.append(estado)
        condiciones.append(f"t.estado = ${len(parametros)}")
    where = f" where {' and '.join(condiciones)}" if condiciones else ""
    rows = await pool.fetch(_SELECT_TRASLADOS + where + " order by t.created_at desc limit 100", *parametros)
    return [_serializar_traslado(dict(r)) for r in rows]


@router.get("/traslados-puntos/novedades")
async def listar_novedades(estado: str = "pendiente") -> list[dict]:
    """Bandeja de Supervision: traslados con novedad -- pendientes (el que
    lleva mas tiempo esperando, primero) o resueltas (la mas reciente,
    primero). OJO: esta ruta tiene que declararse ANTES que
    GET /traslados-puntos/{traslado_id} en este archivo -- FastAPI resuelve
    por orden de registro, y si quedara despues "novedades" caeria en el path
    param y Pydantic la rechazaria como un UUID invalido (422) en vez de
    listar."""
    pool = await get_pool()
    orden = "t.recibido_at asc" if estado == "pendiente" else "t.solucionado_at desc"
    rows = await pool.fetch(
        _SELECT_TRASLADOS + " where t.novedad_estado = $1 order by " + orden + " limit 200",
        estado,
    )
    return [_serializar_traslado(dict(r)) for r in rows]


@router.get("/traslados-puntos/buscar-consecutivo")
async def buscar_consecutivo_traslado(q: str = "") -> list[dict]:
    """Busqueda de Supervision por consecutivo (ej. "NPT-1234", ver
    resolver_novedad en app/services/traslados_puntos.py). OJO: mismo motivo
    que /novedades arriba -- esta ruta tiene que declararse ANTES que
    GET /traslados-puntos/{traslado_id} en este archivo, o el path param se
    la come primero."""
    texto = q.strip()
    if not texto:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        _SELECT_TRASLADOS
        + " where t.novedad_estado = 'resuelta' and t.consecutivo_solucion ilike $1"
        + " order by t.solucionado_at desc limit 50",
        f"%{texto}%",
    )
    return [_serializar_traslado(dict(r)) for r in rows]


@router.get("/traslados-puntos/{traslado_id}")
async def obtener_traslado(traslado_id: UUID) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(_SELECT_TRASLADOS + " where t.id = $1::uuid", str(traslado_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Traslado no encontrado")
    items = await pool.fetch(
        "select * from traslado_punto_items where traslado_id = $1::uuid order by id", str(traslado_id)
    )
    return _serializar_traslado(dict(row), [dict(i) for i in items])


@router.post("/traslados-puntos/{traslado_id}/recepcion")
async def recibir_traslado(traslado_id: UUID, payload: RecepcionTraslado) -> dict:
    try:
        resultado = await registrar_recepcion(str(traslado_id), payload)
    except TrasladoNoEncontrado as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TrasladoYaRecibido as exc:
        # 409 y no 422 -- es un conflicto de estado (ya lo recibio otro),
        # no un dato invalido (mismo criterio que EntregaDuplicada/
        # FacturaYaRegistrada en app/routers/entregas.py).
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TrasladoInvalido as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    items = resultado.pop("items")
    return _serializar_traslado(resultado, items)


@router.post("/traslados-puntos/{traslado_id}/solucion")
async def resolver_novedad_endpoint(traslado_id: UUID, payload: SolucionNovedad) -> dict:
    try:
        resultado = await resolver_novedad(str(traslado_id), payload)
    except NovedadNoEncontrada as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NovedadYaResuelta as exc:
        # 409 y no 422 -- mismo criterio que TrasladoYaRecibido: es un
        # conflicto de estado (alguien mas ya la resolvio), no un dato
        # invalido.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ConsecutivoDuplicado as exc:
        # 409 tambien, pero con un detail distinto del de NovedadYaResuelta
        # de arriba -- el movil necesita distinguir "alguien mas ya resolvio
        # esta novedad" (recargar y mostrar resuelta) de "el consecutivo que
        # tipeaste ya lo uso otra novedad" (quedarse en el formulario, ver
        # esErrorConsecutivoDuplicado en apps/mobile/errorMessages.ts).
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except NovedadInvalida as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    items = resultado.pop("items")
    return _serializar_traslado(resultado, items)
