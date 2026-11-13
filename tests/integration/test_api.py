"""Integration tests for the FastAPI application."""
import pytest
from fastapi.testclient import TestClient

from apps.api.src.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestRepositoryEndpoints:
    def test_list_repositories_returns_empty(self, client):
        response = client.get("/v1/repositories")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_repository_not_found(self, client):
        import uuid
        response = client.get(f"/v1/repositories/{uuid.uuid4()}")
        assert response.status_code == 404

    def test_trigger_scan_not_found(self, client):
        import uuid
        response = client.post(
            f"/v1/repositories/{uuid.uuid4()}/scan",
            json={"branch": "main"},
        )
        assert response.status_code == 404


class TestTaskEndpoints:
    def test_create_task_invalid_task_type(self, client):
        import uuid
        response = client.post(
            "/v1/tasks",
            json={
                "repository_id": str(uuid.uuid4()),
                "task_type": "invalid_type",
                "prompt": "Do something",
            },
        )
        assert response.status_code == 422

    def test_create_task_valid_returns_202(self, client):
        import uuid
        response = client.post(
            "/v1/tasks",
            json={
                "repository_id": str(uuid.uuid4()),
                "task_type": "architecture_report",
                "prompt": "Produce an architecture report",
            },
        )
        assert response.status_code == 202
        data = response.json()
        assert data["task_type"] == "architecture_report"
        assert data["status"] == "queued"

    def test_get_task_not_found(self, client):
        import uuid
        response = client.get(f"/v1/tasks/{uuid.uuid4()}")
        assert response.status_code == 404

    def test_get_task_report_not_found(self, client):
        import uuid
        response = client.get(f"/v1/tasks/{uuid.uuid4()}/report")
        assert response.status_code == 404


class TestReportEndpoints:
    def test_list_reports_returns_empty(self, client):
        import uuid
        response = client.get(f"/v1/repositories/{uuid.uuid4()}/reports")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_report_not_found(self, client):
        import uuid
        response = client.get(f"/v1/reports/{uuid.uuid4()}")
        assert response.status_code == 404


class TestWebhookEndpoint:
    def test_webhook_missing_required_headers(self, client, monkeypatch):
        import secrets
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", secrets.token_hex(32))
        response = client.post(
            "/v1/webhooks/github",
            content=b"{}",
            headers={"Content-Type": "application/json"},
        )
        # Missing x-github-event and x-github-delivery headers
        assert response.status_code == 422

    def test_webhook_invalid_signature(self, client, monkeypatch):
        import secrets
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", secrets.token_hex(32))
        response = client.post(
            "/v1/webhooks/github",
            content=b'{"action":"ping"}',
            headers={
                "Content-Type": "application/json",
                "x-github-event": "ping",
                "x-github-delivery": "abc",
                "x-hub-signature-256": "sha256=invalidsignature",
            },
        )
        assert response.status_code == 401

    def test_webhook_no_secret_rejects_event(self, client, monkeypatch):
        monkeypatch.delenv("GITHUB_WEBHOOK_SECRET", raising=False)

        response = client.post(
            "/v1/webhooks/github",
            content=b'{"action":"ping"}',
            headers={
                "Content-Type": "application/json",
                "x-github-event": "ping",
                "x-github-delivery": "test-delivery-001",
            },
        )
        assert response.status_code == 503
