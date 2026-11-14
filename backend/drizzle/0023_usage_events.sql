CREATE TABLE app.usage_events (
  attempt_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  model_id text NOT NULL CHECK (octet_length(model_id) BETWEEN 1 AND 256 AND model_id ~ '^[A-Za-z0-9._/-]+$'),
  requested_provider text NOT NULL CHECK (octet_length(requested_provider) BETWEEN 1 AND 128 AND requested_provider ~ '^[A-Za-z0-9._/-]+$'),
  observed_provider text CHECK (observed_provider IS NULL OR (octet_length(observed_provider) BETWEEN 1 AND 128 AND observed_provider ~ '^[A-Za-z0-9._/-]+$')),
  profile_id text NOT NULL CHECK (octet_length(profile_id) BETWEEN 1 AND 128 AND profile_id ~ '^[A-Za-z0-9._/-]+$'),
  resolved_effort text CHECK (resolved_effort IS NULL OR resolved_effort IN ('none','low','medium','high','xhigh','max')),
  estimated_input_tokens integer NOT NULL CHECK (estimated_input_tokens >= 0),
  reserved_input_tokens integer NOT NULL CHECK (reserved_input_tokens >= 0),
  reserved_output_tokens integer NOT NULL CHECK (reserved_output_tokens > 0),
  estimator_version text NOT NULL CHECK (octet_length(estimator_version) BETWEEN 1 AND 64),
  instruction_version text CHECK (instruction_version IS NULL OR (octet_length(instruction_version) BETWEEN 1 AND 128 AND instruction_version ~ '^[A-Za-z0-9._/-]+$')),
  reported_input_tokens integer CHECK (reported_input_tokens IS NULL OR reported_input_tokens >= 0),
  reported_output_tokens integer CHECK (reported_output_tokens IS NULL OR reported_output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  reasoning_output_tokens integer CHECK (reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  cost_usd numeric CHECK (cost_usd IS NULL OR (cost_usd >= 0 AND cost_usd < 'Infinity'::numeric)),
  generation_id text CHECK (generation_id IS NULL OR octet_length(generation_id) <= 256),
  outcome text NOT NULL CHECK (outcome IN ('reserved','succeeded','failed','unknown')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  CHECK ((outcome='reserved' AND settled_at IS NULL) OR (outcome<>'reserved' AND settled_at IS NOT NULL))
);
CREATE INDEX usage_events_org_created ON app.usage_events(org_id,created_at,attempt_id);
ALTER TABLE app.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usage_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.usage_events FOR ALL TO lexon_app
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON app.usage_events TO lexon_app;
