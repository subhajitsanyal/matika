"""Tests for the Health Aggregator service."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from health_aggregator import _cached_services, app
from shared.models import ServiceStatus


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Aggregation logic
# ---------------------------------------------------------------------------

class TestHealthAggregation:
    """Test the /health endpoint aggregation logic."""

    def test_healthy_when_all_services_up(self, client: TestClient) -> None:
        """When all services report 'up', status should be 'healthy' with 200."""
        # Set all cached services to "up"
        for name in _cached_services:
            _cached_services[name] = ServiceStatus(
                status="up", port=_cached_services[name].port, model="test"
            )

        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "healthy"
        assert set(body["services"].keys()) == {"stt", "llm", "tts", "vision"}
        for svc in body["services"].values():
            assert svc["status"] == "up"

    def test_degraded_when_one_service_down(self, client: TestClient) -> None:
        """When any service is 'down', status should be 'degraded' with 503."""
        for name in _cached_services:
            _cached_services[name] = ServiceStatus(
                status="up", port=_cached_services[name].port
            )
        # Bring one service down
        _cached_services["llm"] = ServiceStatus(status="down", port=8002)

        resp = client.get("/health")
        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["services"]["llm"]["status"] == "down"
        assert body["services"]["stt"]["status"] == "up"

    def test_degraded_when_all_services_down(self, client: TestClient) -> None:
        """When all services are 'down', status should be 'degraded' with 503."""
        for name in _cached_services:
            _cached_services[name] = ServiceStatus(
                status="down", port=_cached_services[name].port
            )

        resp = client.get("/health")
        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "degraded"

    def test_response_contains_port_for_each_service(self, client: TestClient) -> None:
        """Each service entry should include the correct port number."""
        for name in _cached_services:
            _cached_services[name] = ServiceStatus(
                status="up", port=_cached_services[name].port
            )

        resp = client.get("/health")
        body = resp.json()
        assert body["services"]["stt"]["port"] == 8001
        assert body["services"]["llm"]["port"] == 8002
        assert body["services"]["tts"]["port"] == 8003
        assert body["services"]["vision"]["port"] == 8004

    def test_response_schema_matches_spec(self, client: TestClient) -> None:
        """Validate the response matches HealthResponse model."""
        for name in _cached_services:
            _cached_services[name] = ServiceStatus(
                status="up", port=_cached_services[name].port
            )

        resp = client.get("/health")
        body = resp.json()

        assert "status" in body
        assert "services" in body
        assert isinstance(body["services"], dict)
        for svc in body["services"].values():
            assert "status" in svc
            assert "port" in svc
