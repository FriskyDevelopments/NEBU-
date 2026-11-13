"""
GitHub webhook validation and event parsing.

Validates the HMAC-SHA256 signature that GitHub attaches to every webhook
delivery, then parses the event payload into a typed dataclass.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional


class WebhookSignatureError(Exception):
    """Raised when the webhook signature cannot be verified."""


@dataclass
class WebhookEvent:
    """Parsed representation of an inbound GitHub webhook event."""

    event_name: str          # e.g. "push", "pull_request", "installation"
    delivery_id: str
    payload: dict[str, Any]
    installation_id: Optional[int] = field(default=None)
    action: Optional[str] = field(default=None)
    repository_owner: Optional[str] = field(default=None)
    repository_name: Optional[str] = field(default=None)

    # ------------------------------------------------------------------
    # Convenience accessors
    # ------------------------------------------------------------------

    @property
    def full_name(self) -> Optional[str]:
        if self.repository_owner and self.repository_name:
            return f"{self.repository_owner}/{self.repository_name}"
        return None


class GitHubWebhookHandler:
    """
    Validates and parses GitHub webhook deliveries.

    Parameters
    ----------
    webhook_secret:
        The shared secret configured in the GitHub App settings.
        Required for every delivery; missing configuration fails closed.
    """

    _SIGNATURE_HEADER = "x-hub-signature-256"
    _EVENT_HEADER = "x-github-event"
    _DELIVERY_HEADER = "x-github-delivery"

    def __init__(self, webhook_secret: Optional[str] = None) -> None:
        self._secret = webhook_secret

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def parse(
        self,
        headers: dict[str, str],
        raw_body: bytes,
    ) -> WebhookEvent:
        """
        Validate the signature and return a parsed ``WebhookEvent``.

        Parameters
        ----------
        headers:
            HTTP request headers (case-insensitive lookup is performed).
        raw_body:
            Raw request body bytes, as received before any decoding.

        Raises
        ------
        WebhookSignatureError
            If the signature header is missing or does not match.
        """
        # Normalise header keys to lowercase
        lower_headers = {k.lower(): v for k, v in headers.items()}

        self._verify_signature(lower_headers, raw_body)

        event_name = lower_headers.get(self._EVENT_HEADER, "unknown")
        delivery_id = lower_headers.get(self._DELIVERY_HEADER, "")

        payload: dict[str, Any] = json.loads(raw_body)
        installation_id = self._extract_installation_id(payload)
        action = payload.get("action")

        repo_info = payload.get("repository") or {}
        owner_info = repo_info.get("owner") or {}
        repo_owner = owner_info.get("login")
        repo_name = repo_info.get("name")

        return WebhookEvent(
            event_name=event_name,
            delivery_id=delivery_id,
            payload=payload,
            installation_id=installation_id,
            action=action,
            repository_owner=repo_owner,
            repository_name=repo_name,
        )

    # ------------------------------------------------------------------
    # Signature verification
    # ------------------------------------------------------------------

    def _verify_signature(
        self, lower_headers: dict[str, str], raw_body: bytes
    ) -> None:
        if not self._secret:
            raise WebhookSignatureError("Webhook secret is not configured.")

        signature_header = lower_headers.get(self._SIGNATURE_HEADER, "")
        if not re.fullmatch(r"sha256=[0-9a-f]{64}", signature_header):
            raise WebhookSignatureError(
                f"Missing or malformed {self._SIGNATURE_HEADER} header."
            )

        expected_sig = signature_header[len("sha256="):]
        computed_sig = hmac.new(
            self._secret.encode("utf-8"),
            msg=raw_body,
            digestmod=hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected_sig, computed_sig):
            raise WebhookSignatureError("Webhook signature verification failed.")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_installation_id(payload: dict) -> Optional[int]:
        installation = payload.get("installation")
        if isinstance(installation, dict):
            return installation.get("id")
        return None
