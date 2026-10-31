CREATE TABLE ops.outbox (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  org_id uuid NOT NULL,
  user_id uuid,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ops.processed_jobs (
  outbox_id uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
