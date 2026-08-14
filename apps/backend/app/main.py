from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import close_pool, ensure_schema
from app.routers import auth, empleados, entregas, logs, sedes, shifts


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_schema()
    yield
    await close_pool()


app = FastAPI(
    title="Control Logistico Multi-Sede API",
    description="Backend del pipeline de despacho: extraccion por IA, "
    "bloqueo de duplicados entre sedes y analitica de turnos.",
    version="0.1.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.dashboard_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(entregas.router)
app.include_router(sedes.router)
app.include_router(logs.router)
app.include_router(shifts.router)
app.include_router(empleados.router)
app.include_router(auth.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
