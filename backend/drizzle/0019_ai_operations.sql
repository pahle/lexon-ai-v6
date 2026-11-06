CREATE TABLE app.ai_operations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  call_occurrence integer NOT NULL CHECK (call_occurrence >= 0),
  tool_name text NOT NULL CHECK (octet_length(tool_name) BETWEEN 1 AND 128),
  tool_version integer NOT NULL CHECK (tool_version > 0),
  idempotency_mode text NOT NULL CHECK (idempotency_mode IN ('read','transactional','idempotency-key','reconcile')),
  args jsonb NOT NULL CHECK (octet_length(args::text) <= 16384),
  args_hash text NOT NULL CHECK (args_hash ~ '^[0-9a-f]{64}$'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  approval_required boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','awaiting_approval','succeeded','failed','outcome_unknown')),
  result jsonb CHECK (result IS NULL OR octet_length(result::text) <= 16384),
  error_code text CHECK (error_code IS NULL OR error_code IN ('AI_INVALID_TOOL','AI_TOOL_TIMEOUT','AI_TOOL_OUTCOME_UNKNOWN','AI_ACCESS_REVOKED','AI_INTERNAL')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (org_id,run_id,step_id,call_occurrence),
  UNIQUE (org_id,run_id,id),
  CONSTRAINT ai_operations_run_fk FOREIGN KEY (org_id,run_id) REFERENCES app.ai_runs(org_id,id) ON DELETE CASCADE,
  CONSTRAINT ai_operations_step_fk FOREIGN KEY (org_id,run_id,step_id) REFERENCES app.ai_steps(org_id,run_id,id) ON DELETE CASCADE,
  CONSTRAINT ai_operations_lifecycle CHECK (
    (status IN ('pending','awaiting_approval') AND result IS NULL AND completed_at IS NULL)
    OR (status IN ('succeeded','failed','outcome_unknown') AND result IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX ai_operations_run_status ON app.ai_operations(org_id,run_id,status,step_id,call_occurrence);
ALTER TABLE app.ai_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON app.ai_operations FOR ALL TO lexon_app
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_operations TO lexon_app;
