"""Unit tests for the GitHub webhook handler."""
import hashlib
import hmac
import json
import secrets

import pytest

from integrations.github.webhook import (
    GitHubWebhookHandler,
    WebhookEvent,
    WebhookSignatureError,
)

_SECRET = secrets.token_hex(32)

PUSH_PAYLOAD = {
    "action": None,
    "ref": "refs/heads/main",
    "before": "abc123",
    "after": "def456",
    "installation": {"id": 99},
    "repository": {
        "id": 1,
        "name": "my-repo",
        "owner": {"login": "my-org"},
    },
}


def _make_headers(raw_body: bytes, secret: str = _SECRET) -> dict:
    sig = hmac.new(
        secret.encode("utf-8"), msg=raw_body, digestmod=hashlib.sha256
    ).hexdigest()
    return {
        "x-github-event": "push",
        "x-github-delivery": "delivery-001",
        "x-hub-signature-256": f"sha256={sig}",
        "content-type": "application/json",
    }


class TestWebhookSignatureVerification:
    def test_valid_signature_is_accepted(self):
        handler = GitHubWebhookHandler(webhook_secret=_SECRET)
        raw = json.dumps(PUSH_PAYLOAD).encode()
        headers = _make_headers(raw)
        event = handler.parse(headers, raw)
        assert event.event_name == "push"
        assert event.delivery_id == "delivery-001"

    def test_invalid_signature_raises(self):
        handler = GitHubWebhookHandler(webhook_secret=_SECRET)
        raw = json.dumps(PUSH_PAYLOAD).encode()
        headers = _make_headers(raw)
        headers["x-hub-signature-256"] = "sha256=badbadbadbad"
        with pytest.raises(WebhookSignatureError):
            handler.parse(headers, raw)

    def test_missing_signature_header_raises(self):
        handler = GitHubWebhookHandler(webhook_secret=_SECRET)
        raw = json.dumps(PUSH_PAYLOAD).encode()
        headers = {
            "x-github-event": "push",
            "x-github-delivery": "delivery-002",
        }
        with pytest.raises(WebhookSignatureError):
            handler.parse(headers, raw)

    @pytest.mark.parametrize("secret", [None, ""])
    def test_no_secret_rejects_delivery(self, secret):
        handler = GitHubWebhookHandler(webhook_secret=secret)
        raw = json.dumps(PUSH_PAYLOAD).encode()
        headers = {
            "x-github-event": "push",
            "x-github-delivery": "delivery-003",
        }
        with pytest.raises(WebhookSignatureError):
            handler.parse(headers, raw)

    @pytest.mark.parametrize("signature", ["sha1=abc", "sha256=", "sha256=" + "é" * 64])
    def test_malformed_signature_rejects_delivery(self, signature):
        handler = GitHubWebhookHandler(webhook_secret=_SECRET)
        raw = json.dumps(PUSH_PAYLOAD).encode()
        headers = _make_headers(raw)
        headers["x-hub-signature-256"] = signature
        with pytest.raises(WebhookSignatureError):
            handler.parse(headers, raw)

    def test_tampered_raw_body_rejects_delivery(self):
        handler = GitHubWebhookHandler(webhook_secret=_SECRET)
        raw = json.dumps(PUSH_PAYLOAD).encode()
        with pytest.raises(WebhookSignatureError):
            handler.parse(_make_headers(raw), raw + b" ")


class TestWebhookEventParsing:
    def _parse(self, payload: dict, event_name: str = "push") -> WebhookEvent:
        handler = GitHubWebhookHandler(webhook_secret=_SECRET)
        raw = json.dumps(payload).encode()
        headers = _make_headers(raw)
        headers["x-github-event"] = event_name
        return handler.parse(headers, raw)

    def test_installation_id_extracted(self):
        event = self._parse(PUSH_PAYLOAD)
        assert event.installation_id == 99

    def test_repository_info_extracted(self):
        event = self._parse(PUSH_PAYLOAD)
        assert event.repository_owner == "my-org"
        assert event.repository_name == "my-repo"
        assert event.full_name == "my-org/my-repo"

    def test_installation_event(self):
        payload = {
            "action": "created",
            "installation": {
                "id": 42,
                "account": {"login": "acme", "type": "Organization"},
            },
        }
        event = self._parse(payload, event_name="installation")
        assert event.event_name == "installation"
        assert event.action == "created"
        assert event.installation_id == 42

    def test_missing_installation_returns_none(self):
        payload = {"action": "created"}
        event = self._parse(payload)
        assert event.installation_id is None

    def test_full_name_none_when_no_repo(self):
        payload = {"action": "ping"}
        event = self._parse(payload)
        assert event.full_name is None
