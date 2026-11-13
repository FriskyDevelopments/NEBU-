-- Keep receipts indefinitely; deleting them re-enables replay of old signatures.
-- Historical JSONB cannot reconstruct the original signed bytes, so leave it null.
alter table webhook_events
  add column if not exists raw_body_sha256 text;

create unique index if not exists uq_webhook_raw_body_sha256
  on webhook_events(raw_body_sha256);
