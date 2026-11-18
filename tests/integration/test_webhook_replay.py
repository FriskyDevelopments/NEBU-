"""Webhook admission checks, including an opt-in isolated PostgreSQL check."""
import asyncio
import hashlib
import hmac
import os
from pathlib import Path
import secrets
from unittest.mock import AsyncMock
import uuid

import asyncpg
from fastapi.testclient import TestClient
import pytest

from apps.api.src.main import app
from apps.api.src.routes.webhooks_github import _get_event_store, _get_queue
from infrastructure.db.webhook_store import WebhookEventStore
from integrations.github.webhook import GitHubWebhookHandler


@pytest.fixture
def webhook_client(monkeypatch):
    secret = secrets.token_hex(32)
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", secret)
    store = AsyncMock()
    store.store_webhook_event.return_value = True
    queue = AsyncMock()
    app.dependency_overrides[_get_event_store] = lambda: store
    app.dependency_overrides[_get_queue] = lambda: queue
    try:
        with TestClient(app) as client:
            yield client, secret, store, queue
    finally:
        app.dependency_overrides.pop(_get_event_store, None)
        app.dependency_overrides.pop(_get_queue, None)


def _headers(secret, body, delivery="delivery-1"):
    return {
        "x-github-event": "push",
        "x-github-delivery": delivery,
        "x-hub-signature-256": "sha256=" + hmac.new(
            secret.encode(), body, hashlib.sha256
        ).hexdigest(),
    }


def test_verified_delivery_is_stored_before_dispatch(webhook_client):
    client, secret, store, queue = webhook_client
    body = b'{"ref":"refs/heads/main"}'
    response = client.post(
        "/v1/webhooks/github", content=body, headers=_headers(secret, body)
    )
    assert response.status_code == 200
    store.store_webhook_event.assert_awaited_once()
    assert store.store_webhook_event.call_args.args[1] == body
    queue.enqueue.assert_awaited_once_with(
        "incremental_refresh", payload={"ref": "refs/heads/main"}
    )


@pytest.mark.parametrize("failure,expected", [(None, 409), (RuntimeError(), 503)])
def test_replay_or_storage_failure_never_dispatches(webhook_client, failure, expected):
    client, secret, store, queue = webhook_client
    store.store_webhook_event.return_value = False
    store.store_webhook_event.side_effect = failure
    body = b"{}"
    response = client.post(
        "/v1/webhooks/github", content=body, headers=_headers(secret, body)
    )
    assert response.status_code == expected
    queue.enqueue.assert_not_awaited()


@pytest.mark.parametrize("body,delivery,expected", [
    (b"{} ", "delivery-1", 401),
    (b"{", "delivery-1", 400),
    (b"{}", " ", 400),
])
def test_invalid_delivery_never_reaches_storage(webhook_client, body, delivery, expected):
    client, secret, store, queue = webhook_client
    signed_body = b"{}" if expected == 401 else body
    response = client.post(
        "/v1/webhooks/github", content=body,
        headers=_headers(secret, signed_body, delivery),
    )
    assert response.status_code == expected
    store.store_webhook_event.assert_not_awaited()
    queue.enqueue.assert_not_awaited()


def test_missing_database_fails_closed(webhook_client, monkeypatch):
    client, secret, _, queue = webhook_client
    app.dependency_overrides.pop(_get_event_store)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    body = b"{}"
    response = client.post(
        "/v1/webhooks/github", content=body, headers=_headers(secret, body)
    )
    assert response.status_code == 503
    queue.enqueue.assert_not_awaited()


@pytest.fixture
def postgres_store(monkeypatch):
    database_url = os.getenv("TEST_WEBHOOK_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_WEBHOOK_DATABASE_URL for the concrete PostgreSQL replay check")
    schema = "webhook_test_" + uuid.uuid4().hex
    connect = asyncpg.connect

    async def scoped_connect(*args, **kwargs):
        return await connect(*args, **kwargs, server_settings={"search_path": schema})

    async def setup():
        connection = await connect(database_url)
        try:
            await connection.execute(f'CREATE SCHEMA "{schema}"')
            await connection.execute(f'SET search_path TO "{schema}"')
            migrations = Path(__file__).resolve().parents[2] / "infrastructure/db/migrations"
            for name in ("001_initial.sql", "002_webhook_replay.sql"):
                await connection.execute((migrations / name).read_text())
        finally:
            await connection.close()

    async def cleanup():
        connection = await connect(database_url)
        try:
            await connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
        finally:
            await connection.close()

    try:
        asyncio.run(setup())
        monkeypatch.setattr(asyncpg, "connect", scoped_connect)
        monkeypatch.setenv("DATABASE_URL", database_url)
        yield WebhookEventStore(database_url)
    finally:
        asyncio.run(cleanup())


def test_postgres_rejects_replays_across_requests_and_changed_headers(
    webhook_client, postgres_store,
):
    client, secret, _, queue = webhook_client
    app.dependency_overrides.pop(_get_event_store)
    body = b'{"ref":"refs/heads/main"}'
    headers = _headers(secret, body)
    assert client.post("/v1/webhooks/github", content=body, headers=headers).status_code == 200
    assert client.post("/v1/webhooks/github", content=body, headers=headers).status_code == 409
    headers["x-github-delivery"] = "changed-unsigned-header"
    headers["x-github-event"] = "installation"
    assert client.post("/v1/webhooks/github", content=body, headers=headers).status_code == 409
    changed_body = b'{"ref":"refs/heads/other"}'
    assert client.post(
        "/v1/webhooks/github", content=changed_body,
        headers=_headers(secret, changed_body),
    ).status_code == 409
    assert client.post(
        "/v1/webhooks/github", content=changed_body,
        headers=_headers(secret, changed_body, "fresh-delivery"),
    ).status_code == 200
    assert queue.enqueue.await_count == 2


def test_postgres_admission_is_atomic_and_survives_new_store(postgres_store):
    body = b'{"ref":"refs/heads/concurrent"}'
    secret = secrets.token_hex(32)
    handler = GitHubWebhookHandler(secret)

    async def check():
        events = [
            handler.parse(_headers(secret, body, f"concurrent-{i}"), body)
            for i in range(4)
        ]
        results = await asyncio.gather(*(
            postgres_store.store_webhook_event(event, body) for event in events
        ))
        assert results.count(True) == 1
        fresh_store = WebhookEventStore(os.environ["DATABASE_URL"])
        assert not await fresh_store.store_webhook_event(events[0], body)

    asyncio.run(check())
