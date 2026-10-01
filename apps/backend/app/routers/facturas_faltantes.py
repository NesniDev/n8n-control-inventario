"""Endpoints del reporte de facturas faltantes -- ver
app/services/facturas_faltantes.py. Bodega reporta, el mostrador de la sede
duena del tipo las ve pendientes; se cierran solas al subirse la factura.
"""

from fastapi import APIRouter, HTTPException, Query

from app.models.factura_faltante import (
    DescartarFacturaFaltante,
    EstadoFacturaFaltante,
    FacturaFaltante,
    ReportarFacturaFaltante,
)
from app.services.facturas_faltantes import (
    FacturaNoRegistrada,
    FacturaYaReportada,
    FacturaYaSubida,
    ReporteNoAutorizado,
    ReporteNoEncontrado,
    ReporteYaCerrado,
    descartar,
    listar,
    marcar_subida,
    reportar,
)

router = APIRouter(prefix="/facturas-faltantes", tags=["facturas-faltantes"])


@router.post("", status_code=201, response_model=FacturaFaltante)
async def reportar_factura_faltante(payload: ReportarFacturaFaltante) -> dict:
    try:
        return await reportar(
            tipo=payload.tipo,
            indicativo_numero=payload.indicativo_numero,
            empleado_id=payload.empleado_id,
            sede_id=payload.sede_id,
        )
    except ReporteNoAutorizado as exc:
        raise HTTPException(status_code=403, detail="No tienes permiso para reportar facturas de esta sede") from exc
    except FacturaYaSubida as exc:
        raise HTTPException(status_code=409, detail="Esta factura ya fue subida por punto de venta") from exc
    except FacturaYaReportada as exc:
        raise HTTPException(status_code=409, detail="Esta factura ya fue reportada y sigue pendiente") from exc


@router.get("", response_model=list[FacturaFaltante])
async def listar_facturas_faltantes(
    sede_id: str,
    estado: EstadoFacturaFaltante = EstadoFacturaFaltante.PENDIENTE,
    vista: str = "destino",
    horas: int | None = Query(default=None, ge=1, le=720),
) -> list[dict]:
    # 'destino' = mostrador (dirigidas a la sede); 'sede' = bodega (dirigidas o reportadas por la sede).
    if vista not in ("destino", "sede"):
        raise HTTPException(status_code=422, detail="vista debe ser 'destino' o 'sede'")
    return await listar(sede_id, estado.value, vista, horas)


@router.post("/{reporte_id}/descartar", response_model=FacturaFaltante)
async def descartar_factura_faltante(reporte_id: str, payload: DescartarFacturaFaltante) -> dict:
    try:
        return await descartar(reporte_id, payload.empleado_id)
    except ReporteNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="El reporte no existe") from exc
    except ReporteNoAutorizado as exc:
        raise HTTPException(status_code=403, detail="No tienes permiso para descartar este reporte") from exc
    except ReporteYaCerrado as exc:
        raise HTTPException(status_code=409, detail="Este reporte ya estaba cerrado") from exc


@router.post("/{reporte_id}/marcar-subida", response_model=FacturaFaltante)
async def marcar_factura_subida(reporte_id: str, payload: DescartarFacturaFaltante) -> dict:
    # Mismo cuerpo que descartar ({empleado_id}); verifica que la factura exista en entregas.
    try:
        return await marcar_subida(reporte_id, payload.empleado_id)
    except ReporteNoEncontrado as exc:
        raise HTTPException(status_code=404, detail="El reporte no existe") from exc
    except ReporteNoAutorizado as exc:
        raise HTTPException(status_code=403, detail="No tienes permiso para marcar este reporte") from exc
    except ReporteYaCerrado as exc:
        raise HTTPException(status_code=409, detail="Este reporte ya estaba cerrado") from exc
    except FacturaNoRegistrada as exc:
        raise HTTPException(
            status_code=409,
            detail="Esta factura todavía no aparece en el sistema. Sube la foto de la factura primero.",
        ) from exc
