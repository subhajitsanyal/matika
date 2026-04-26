"""CareLog Health Aggregator Service — port 8000.

Polls each model service's /health endpoint every 5 seconds, caches results,
and returns aggregated status.  Advertises itself via mDNS/Bonjour so the
Android app can discover the Mac Mini on the LAN.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from shared.config import (
    HEALTH_POLL_INTERVAL_SECONDS,
    HEALTH_PORT,
    MDNS_SERVICE_NAME,
    MDNS_SERVICE_PORT,
    MDNS_SERVICE_TYPE,
    MDNS_TXT_RECORDS,
    SERVICE_PORTS,
)
from shared.models import HealthResponse, ServiceStatus

logger = logging.getLogger("carelog.health")

# ---------------------------------------------------------------------------
# Cached health state
# ---------------------------------------------------------------------------
_cached_services: dict[str, ServiceStatus] = {
    name: ServiceStatus(status="down", port=port)
    for name, port in SERVICE_PORTS.items()
}
_poll_task: asyncio.Task | None = None


# ---------------------------------------------------------------------------
# Polling logic
# ---------------------------------------------------------------------------
async def _poll_services() -> None:
    """Background loop that polls each service every HEALTH_POLL_INTERVAL_SECONDS."""
    async with httpx.AsyncClient(timeout=3.0) as client:
        while True:
            for name, port in SERVICE_PORTS.items():
                url = f"http://127.0.0.1:{port}/health"
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        data = resp.json()
                        _cached_services[name] = ServiceStatus(
                            status="up",
                            port=port,
                            model=data.get("model"),
                            uptime_seconds=data.get("uptime_seconds"),
                        )
                    else:
                        _cached_services[name] = ServiceStatus(status="down", port=port)
                except Exception:
                    _cached_services[name] = ServiceStatus(status="down", port=port)
            await asyncio.sleep(HEALTH_POLL_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# mDNS advertisement
# ---------------------------------------------------------------------------
_zeroconf = None
_service_info = None


def _start_mdns() -> None:
    """Register the CareLog health aggregator via Bonjour/mDNS."""
    global _zeroconf, _service_info
    try:
        from zeroconf import ServiceInfo, Zeroconf

        local_ip = socket.inet_aton(socket.gethostbyname(socket.gethostname()))
        txt_records = {k: v.encode() for k, v in MDNS_TXT_RECORDS.items()}

        _service_info = ServiceInfo(
            type_=MDNS_SERVICE_TYPE,
            name=MDNS_SERVICE_NAME,
            addresses=[local_ip],
            port=MDNS_SERVICE_PORT,
            properties=txt_records,
            server=f"{socket.gethostname()}.local.",
        )
        _zeroconf = Zeroconf()
        _zeroconf.register_service(_service_info)
        logger.info("mDNS service registered: %s on port %d", MDNS_SERVICE_NAME, MDNS_SERVICE_PORT)
    except ImportError:
        logger.warning("zeroconf package not installed — mDNS advertisement disabled")
    except Exception:
        logger.exception("Failed to register mDNS service")


def _stop_mdns() -> None:
    global _zeroconf, _service_info
    if _zeroconf and _service_info:
        try:
            _zeroconf.unregister_service(_service_info)
            _zeroconf.close()
        except Exception:
            logger.exception("Error unregistering mDNS service")
        finally:
            _zeroconf = None
            _service_info = None


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global _poll_task
    _start_mdns()
    _poll_task = asyncio.create_task(_poll_services())
    logger.info("Health aggregator started — polling every %ds", HEALTH_POLL_INTERVAL_SECONDS)
    yield
    if _poll_task:
        _poll_task.cancel()
        try:
            await _poll_task
        except asyncio.CancelledError:
            pass
    _stop_mdns()
    logger.info("Health aggregator stopped")


app = FastAPI(title="CareLog Health Aggregator", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
async def health() -> JSONResponse:
    all_up = all(s.status == "up" for s in _cached_services.values())
    status = "healthy" if all_up else "degraded"
    status_code = 200 if all_up else 503
    payload = HealthResponse(
        status=status,
        services=_cached_services,
    )
    return JSONResponse(content=payload.model_dump(), status_code=status_code)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT)
