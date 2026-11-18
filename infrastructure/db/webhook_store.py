"""Durable, atomic admission of verified GitHub webhook deliveries."""
from __future__ import annotations

import hashlib
import json

import asyncpg

from integrations.github.webhook import WebhookEvent


class WebhookEventStore:
    def __init__(self, database_url: str | None) -> None:
        self._database_url = database_url

    async def store_webhook_event(self, event: WebhookEvent, raw_body: bytes) -> bool:
        if not self._database_url:
            raise RuntimeError("Webhook database is not configured.")
        connection = await asyncpg.connect(self._database_url, timeout=5)
        try:
            # The delivery header is unsigned, so also deduplicate the signed body.
            admitted = await connection.fetchval(
                """
                INSERT INTO webhook_events
                    (event_name, delivery_id, payload, raw_body_sha256)
                VALUES ($1, $2, $3::jsonb, $4)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                event.event_name,
                event.delivery_id,
                json.dumps(event.payload),
                hashlib.sha256(raw_body).hexdigest(),
                timeout=5,
            )
            return admitted is not None
        finally:
            await connection.close()
