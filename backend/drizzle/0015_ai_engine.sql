CREATE TABLE app.ai_runs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES auth.organization(id) ON DELETE CASCADE,
  initiating_user_id uuid NOT NULL REFERENCES auth."user"(id),
  profile_id text NOT NULL CHECK (octet_length(profile_id) BETWEEN 1 AND 128),
  profile_version integer NOT NULL CHECK (profile_version > 0),
  resolved_config jsonb NOT NULL CHECK (octet_length(resolved_config::text) <= 65536),
  model_id text NOT NULL CHECK (octet_length(model_id) BETWEEN 1 AND 256),
  input_text text NOT NULL CHECK (octet_length(input_text) <= 262144),
  status text NOT NULL CHECK (status IN ('queued','running','awaiting_approval','completed','failed','cancelling','cancelled')),
  run_version integer NOT NULL DEFAULT 1 CHECK (run_version > 0),
  next_sequence integer NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  model_iterations integer NOT NULL DEFAULT 0 CHECK (model_iterations >= 0),
  input_budget_tokens bigint NOT NULL CHECK (input_budget_tokens > 0),
  output_budget_tokens bigint NOT NULL CHECK (output_budget_tokens > 0),
  partial_output text NOT NULL DEFAULT '' CHECK (octet_length(partial_output) <= 262144),
  final_output text CHECK (final_output IS NULL OR octet_length(final_output) <= 262144),
  error_code text CHECK (error_code IS NULL OR error_code IN ('AI_BUDGET_EXCEEDED','AI_ATTEMPT_LIMIT','AI_ITERATION_LIMIT','AI_ACCESS_REVOKED','AI_MODEL_FORBIDDEN','AI_PROVIDER_UNAVAILABLE','AI_PROVIDER_AUTH','AI_INVALID_TOOL','AI_TOOL_TIMEOUT','AI_TOOL_OUTCOME_UNKNOWN','AI_CAPACITY_EXCEEDED','AI_INTERNAL')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (org_id,id)
);
CREATE INDEX ai_runs_org_created ON app.ai_runs(org_id,created_at DESC,id);
ALTER TABLE app.ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.ai_runs FOR ALL TO lexon_app
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_runs TO lexon_app;
--> statement-breakpoint

CREATE TABLE app.ai_steps (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  expected_version integer NOT NULL CHECK (expected_version > 0),
  state text NOT NULL CHECK (state IN ('pending','claimed','committed','awaiting_approval','failed')),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_until timestamptz,
  committed_text text CHECK (committed_text IS NULL OR octet_length(committed_text) <= 262144),
  commit_data jsonb CHECK (commit_data IS NULL OR octet_length(commit_data::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id,sequence),
  UNIQUE (org_id,id),
  UNIQUE (org_id,run_id,id),
  CONSTRAINT ai_steps_run_fk FOREIGN KEY (org_id,run_id) REFERENCES app.ai_runs(org_id,id) ON DELETE CASCADE
);
CREATE INDEX ai_steps_claimable ON app.ai_steps(org_id,run_id,sequence,state,lease_until);
ALTER TABLE app.ai_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.ai_steps FOR ALL TO lexon_app
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_steps TO lexon_app;
--> statement-breakpoint

CREATE TABLE app.ai_attempts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  model_id text NOT NULL CHECK (octet_length(model_id) BETWEEN 1 AND 256),
  provider text CHECK (provider IS NULL OR octet_length(provider) <= 128),
  estimator_version text NOT NULL CHECK (octet_length(estimator_version) BETWEEN 1 AND 64),
  estimated_input_tokens integer NOT NULL CHECK (estimated_input_tokens >= 0),
  reserved_input_tokens integer NOT NULL CHECK (reserved_input_tokens >= 0),
  reserved_output_tokens integer NOT NULL CHECK (reserved_output_tokens > 0),
  reported_input_tokens integer CHECK (reported_input_tokens IS NULL OR reported_input_tokens >= 0),
  reported_output_tokens integer CHECK (reported_output_tokens IS NULL OR reported_output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  reasoning_output_tokens integer CHECK (reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  cost_usd numeric(20,10) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  generation_id text CHECK (generation_id IS NULL OR octet_length(generation_id) <= 256),
  fence bigint NOT NULL CHECK (fence > 0),
  active boolean NOT NULL DEFAULT true,
  outcome text CHECK (outcome IS NULL OR outcome IN ('succeeded','failed','unknown')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  UNIQUE (run_id,step_id,ordinal),
  UNIQUE (org_id,id),
  UNIQUE (org_id,run_id,id),
  CONSTRAINT ai_attempts_run_fk FOREIGN KEY (org_id,run_id) REFERENCES app.ai_runs(org_id,id) ON DELETE CASCADE,
  CONSTRAINT ai_attempts_step_fk FOREIGN KEY (org_id,run_id,step_id) REFERENCES app.ai_steps(org_id,run_id,id) ON DELETE CASCADE,
  CONSTRAINT ai_attempts_lifecycle CHECK ((active AND outcome IS NULL AND settled_at IS NULL) OR (NOT active AND outcome IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX ai_attempts_run ON app.ai_attempts(org_id,run_id,created_at,id);
CREATE INDEX ai_attempts_active_fence ON app.ai_attempts(org_id,step_id,fence) WHERE active;
ALTER TABLE app.ai_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.ai_attempts FOR ALL TO lexon_app
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_attempts TO lexon_app;
--> statement-breakpoint

CREATE TABLE app.ai_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  fence bigint NOT NULL CHECK (fence > 0),
  text text NOT NULL CHECK (octet_length(text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (step_id,fence),
  CONSTRAINT ai_checkpoints_run_fk FOREIGN KEY (org_id,run_id) REFERENCES app.ai_runs(org_id,id) ON DELETE CASCADE,
  CONSTRAINT ai_checkpoints_step_fk FOREIGN KEY (org_id,run_id,step_id) REFERENCES app.ai_steps(org_id,run_id,id) ON DELETE CASCADE,
  CONSTRAINT ai_checkpoints_attempt_fk FOREIGN KEY (org_id,run_id,attempt_id) REFERENCES app.ai_attempts(org_id,run_id,id) ON DELETE CASCADE
);
ALTER TABLE app.ai_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.ai_checkpoints FOR ALL TO lexon_app
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_checkpoints TO lexon_app;
--> statement-breakpoint

CREATE TABLE ops.ai_engine_capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_active integer NOT NULL CHECK (max_active > 0),
  max_active_per_org integer NOT NULL CHECK (max_active_per_org > 0 AND max_active_per_org <= max_active),
  terminal_slots integer NOT NULL CHECK (terminal_slots >= 0),
  max_len integer NOT NULL CHECK (max_len BETWEEN 1 AND 1024),
  event_bytes integer NOT NULL CHECK (event_bytes BETWEEN 1 AND 4096),
  slot_bytes integer NOT NULL CHECK (slot_bytes = 6291456),
  memory_budget_bytes bigint NOT NULL CHECK (memory_budget_bytes > 0),
  config_fingerprint text NOT NULL CHECK (octet_length(config_fingerprint) <= 256),
  configured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ops.ai_engine_capacity FROM PUBLIC,lexon_app,lexon_auth;
GRANT SELECT, INSERT, UPDATE ON ops.ai_engine_capacity TO lexon_app;
CREATE TABLE ops.ai_run_slots (
  run_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_run_slots_run_fk FOREIGN KEY (org_id,run_id) REFERENCES app.ai_runs(org_id,id) ON DELETE CASCADE
);
REVOKE ALL ON ops.ai_run_slots FROM PUBLIC,lexon_app,lexon_auth;
--> statement-breakpoint

CREATE FUNCTION ops.ai_check_run_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,app,pg_temp AS $$
DECLARE capacity ops.ai_engine_capacity%ROWTYPE; prior_active boolean:=false; next_active boolean;
BEGIN
  IF TG_OP='UPDATE' AND OLD.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'AI run organization is immutable' USING ERRCODE='23514', CONSTRAINT='ai_run_org_immutable';
  END IF;
  next_active := NEW.status IN ('queued','running','awaiting_approval','cancelling');
  IF TG_OP='UPDATE' THEN
    prior_active := OLD.status IN ('queued','running','awaiting_approval','cancelling') AND OLD.org_id=NEW.org_id;
  END IF;
  IF next_active AND prior_active THEN RETURN NEW; END IF;
  IF next_active THEN
    SELECT * INTO capacity FROM ops.ai_engine_capacity WHERE singleton=true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI capacity unavailable' USING ERRCODE='23514', CONSTRAINT='ai_capacity_missing'; END IF;
    IF (SELECT count(*) FROM ops.ai_run_slots) >= capacity.max_active THEN
      RAISE EXCEPTION 'AI capacity exceeded' USING ERRCODE='23514', CONSTRAINT='ai_global_capacity';
    END IF;
    IF (SELECT count(*) FROM ops.ai_run_slots WHERE org_id=NEW.org_id) >= capacity.max_active_per_org THEN
      RAISE EXCEPTION 'AI organization capacity exceeded' USING ERRCODE='23514', CONSTRAINT='ai_org_capacity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops.ai_check_run_capacity() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER ai_run_admission BEFORE INSERT OR UPDATE OF status,org_id ON app.ai_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_check_run_capacity();
--> statement-breakpoint

CREATE FUNCTION ops.ai_sync_run_slot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,app,pg_temp AS $$
DECLARE prior_active boolean:=false; next_active boolean;
BEGIN
  next_active := NEW.status IN ('queued','running','awaiting_approval','cancelling');
  IF TG_OP='UPDATE' THEN
    prior_active := OLD.status IN ('queued','running','awaiting_approval','cancelling');
  END IF;
  IF next_active AND NOT prior_active THEN
    INSERT INTO ops.ai_run_slots(run_id,org_id) VALUES(NEW.id,NEW.org_id);
  ELSIF NOT next_active THEN
    DELETE FROM ops.ai_run_slots WHERE run_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION ops.ai_sync_run_slot() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER ai_run_slot_sync AFTER INSERT OR UPDATE OF status,org_id ON app.ai_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_sync_run_slot();
--> statement-breakpoint

ALTER TABLE ops.outbox ADD COLUMN queue_name text CHECK (queue_name IS NULL OR queue_name IN ('ai-interactive','ai-batch'));
ALTER TABLE ops.outbox ADD COLUMN priority smallint CHECK (priority IS NULL OR priority BETWEEN 1 AND 10);
