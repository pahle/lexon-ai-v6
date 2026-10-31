ALTER TABLE ops.outbox ADD COLUMN claimed_at timestamptz;
ALTER TABLE ops.outbox ADD COLUMN claim_token uuid;
ALTER TABLE ops.outbox ADD COLUMN claim_expires_at timestamptz;
ALTER TABLE ops.outbox ADD COLUMN last_error_code text CHECK (last_error_code IN ('invalid_job', 'enqueue_failed'));
CREATE INDEX outbox_dispatch_eligible ON ops.outbox (next_attempt_at, created_at) WHERE sent_at IS NULL;
