ALTER TABLE app.ai_operations
  ADD COLUMN kind text NOT NULL DEFAULT 'approval' CHECK (kind IN ('approval','question')),
  ADD COLUMN expires_at timestamptz;
--> statement-breakpoint
-- lexon_migrator is NOBYPASSRLS and the table is FORCE-RLS: without an
-- explicit policy the backfill below would update zero rows (the same
-- internal-policy precedent as ai_run_chat_trigger_internal in 0027).
CREATE POLICY ai_operations_internal ON app.ai_operations FOR ALL
  TO lexon_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
UPDATE app.ai_operations
  SET expires_at = created_at + interval '24 hours'
  WHERE status = 'awaiting_approval';
--> statement-breakpoint
ALTER TABLE app.ai_operations
  DROP CONSTRAINT ai_operations_status_check,
  ADD CONSTRAINT ai_operations_status_check
    CHECK (status IN ('pending','awaiting_approval','approved','rejected','answered','dismissed','expired','succeeded','failed','outcome_unknown')),
  DROP CONSTRAINT ai_operations_decision_check,
  ADD CONSTRAINT ai_operations_decision_check
    CHECK (decision IS NULL OR decision IN ('approve','reject','answer','dismiss')),
  DROP CONSTRAINT ai_operations_decision_lifecycle,
  ADD CONSTRAINT ai_operations_decision_lifecycle CHECK (
    (decision IS NULL AND decided_at IS NULL AND decision_by_user_id IS NULL AND status NOT IN ('approved','rejected','answered','dismissed','expired'))
    OR (decision='approve' AND status IN ('approved','rejected','succeeded','failed','outcome_unknown') AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL)
    OR (decision='reject' AND status='rejected' AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL)
    OR (decision='answer' AND status='answered' AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL)
    OR (decision='dismiss' AND status='dismissed' AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL)
    OR (decision IS NULL AND status='expired' AND decided_at IS NOT NULL AND decision_by_user_id IS NULL)
  ),
  DROP CONSTRAINT ai_operations_lifecycle,
  ADD CONSTRAINT ai_operations_lifecycle CHECK (
    ((status IN ('pending','awaiting_approval','approved') AND result IS NULL AND completed_at IS NULL)
     OR (status IN ('succeeded','rejected','answered','dismissed','expired','failed','outcome_unknown') AND result IS NOT NULL AND completed_at IS NOT NULL))
    AND ((status='awaiting_approval' AND expires_at IS NOT NULL)
      OR (status<>'awaiting_approval' AND expires_at IS NULL))
  );
--> statement-breakpoint
CREATE INDEX ai_operations_expiry_idx ON app.ai_operations(expires_at)
  WHERE status='awaiting_approval';
--> statement-breakpoint
CREATE FUNCTION app.ai_expired_operations(batch int)
RETURNS TABLE (org_id uuid, id uuid, run_id uuid, initiating_user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  RETURN QUERY
    SELECT o.org_id, o.id, o.run_id, r.initiating_user_id
    FROM app.ai_operations o
    JOIN app.ai_runs r ON r.org_id=o.org_id AND r.id=o.run_id
    WHERE o.status='awaiting_approval' AND o.expires_at <= clock_timestamp()
    ORDER BY o.expires_at
    LIMIT batch;
END $$;
REVOKE ALL ON FUNCTION app.ai_expired_operations(int) FROM PUBLIC, lexon_auth;
GRANT EXECUTE ON FUNCTION app.ai_expired_operations(int) TO lexon_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.lexon_validate_ai_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE
  metadata jsonb := event->'metadata';
  field text;
  allowed_metadata text[];
  required_metadata text[];
  valid boolean := false;
  -- Expiry events are emitted by the sweep with a null actor; the trigger's
  -- jsonb_strip_nulls drops the key, so actorUserId is required for every
  -- shape except a decided event whose status is 'expired'.
  actor_required boolean := COALESCE(NOT (
    jsonb_typeof(event)='object'
    AND jsonb_typeof(event->'metadata')='object'
    AND event->>'type' IN ('chat.approval_decided.v1','chat.question_decided.v1')
    AND event->'metadata'->>'status'='expired'), true);
  id_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR NOT (event ?& ARRAY['version','eventId','type','occurredAt','outcome','orgId','metadata'])
    OR (actor_required AND NOT (event ? 'actorUserId'))
    OR (NOT actor_required AND (event ? 'actorUserId'))
    OR event->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR NOT COALESCE(event->>'eventId' ~* id_pattern, false)
    OR NOT COALESCE(event->>'orgId' ~* id_pattern, false)
    OR ((event ? 'actorUserId') AND NOT COALESCE(event->>'actorUserId' ~* id_pattern, false))
    OR NOT COALESCE(event->>'occurredAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$', false) THEN
    RAISE EXCEPTION 'Invalid AI audit event' USING ERRCODE = '23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(event) LOOP
    IF NOT (field = ANY(ARRAY['version','eventId','type','occurredAt','outcome','actorUserId','orgId','metadata'])) THEN
      RAISE EXCEPTION 'Invalid AI audit event' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  CASE event->>'type'
    WHEN 'chat.run_started.v1' THEN
      allowed_metadata := ARRAY['runId','model','provider','status'];
      required_metadata := ARRAY['runId','model','provider','status'];
      valid := event->>'outcome'='success' AND metadata->>'status'='started';
    WHEN 'chat.run_finished.v1' THEN
      allowed_metadata := ARRAY['runId','model','provider','status','safeCode'];
      required_metadata := ARRAY['runId','model','provider','status'];
      valid := event->>'outcome' IN ('success','failure') AND metadata->>'status' IN ('completed','failed','cancelled')
        AND ((metadata->>'status'='completed') = (event->>'outcome'='success'))
        AND (NOT (metadata ? 'safeCode') OR metadata->>'safeCode' IN ('AI_BUDGET_EXCEEDED','AI_ATTEMPT_LIMIT','AI_ITERATION_LIMIT','AI_ACCESS_REVOKED','AI_MODEL_FORBIDDEN','AI_PROVIDER_UNAVAILABLE','AI_PROVIDER_AUTH','AI_INVALID_TOOL','AI_TOOL_TIMEOUT','AI_TOOL_OUTCOME_UNKNOWN','AI_CAPACITY_EXCEEDED','AI_OUTPUT_LIMIT','AI_INTERNAL'));
    WHEN 'chat.tool_operation.v1' THEN
      allowed_metadata := ARRAY['runId','stepId','operationId','model','provider','status'];
      required_metadata := ARRAY['runId','stepId','operationId','model','provider','status'];
      valid := event->>'outcome' IN ('success','failure') AND metadata->>'status' IN ('proposed','pending','completed','failed','unknown','answered','dismissed','expired')
        AND ((metadata->>'status' IN ('proposed','pending','completed','answered','dismissed')) = (event->>'outcome'='success'));
    WHEN 'chat.approval_decided.v1' THEN
      allowed_metadata := ARRAY['runId','operationId','status','reason'];
      required_metadata := ARRAY['runId','operationId','status'];
      valid := event->>'outcome' IN ('success','failure') AND metadata->>'status' IN ('approved','rejected','expired')
        AND ((metadata->>'status'='expired') = (event->>'outcome'='failure'))
        AND (NOT (metadata ? 'reason') OR metadata->>'reason'='superseded_by_message');
    WHEN 'chat.question_decided.v1' THEN
      allowed_metadata := ARRAY['runId','operationId','status','reason'];
      required_metadata := ARRAY['runId','operationId','status'];
      valid := event->>'outcome' IN ('success','failure') AND metadata->>'status' IN ('answered','dismissed','expired')
        AND ((metadata->>'status'='expired') = (event->>'outcome'='failure'))
        AND (NOT (metadata ? 'reason') OR metadata->>'reason'='superseded_by_message');
    WHEN 'chat.message_feedback.v1' THEN
      allowed_metadata := ARRAY['chatId','messageId','runId','action'];
      required_metadata := ARRAY['chatId','messageId','runId','action'];
      valid := event->>'outcome'='success' AND metadata->>'action' IN ('set','changed','cleared');
    ELSE RAISE EXCEPTION 'Invalid AI audit type' USING ERRCODE = '23514';
  END CASE;
  IF valid IS DISTINCT FROM true
    OR NOT (metadata ?& required_metadata)
    OR EXISTS (SELECT 1 FROM unnest(required_metadata) AS required(key)
      WHERE jsonb_typeof(metadata->required.key) IS DISTINCT FROM 'string')
    OR EXISTS (SELECT 1 FROM jsonb_each_text(metadata) entry
      WHERE entry.key IN ('runId','stepId','operationId','chatId','messageId')
        AND NOT COALESCE(entry.value ~* id_pattern, false))
    OR (metadata ? 'model' AND NOT COALESCE(metadata->>'model' ~ '^[a-zA-Z0-9._/-]{1,160}$', false))
    OR (metadata ? 'provider' AND NOT COALESCE(metadata->>'provider' ~ '^[a-zA-Z0-9._/-]{1,80}$', false))
    OR (metadata ? 'safeCode' AND jsonb_typeof(metadata->'safeCode') IS DISTINCT FROM 'string')
    OR (metadata ? 'reason' AND jsonb_typeof(metadata->'reason') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'Invalid AI audit event' USING ERRCODE = '23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(metadata) LOOP
    IF NOT (field = ANY(allowed_metadata)) THEN
      RAISE EXCEPTION 'Invalid AI audit metadata' USING ERRCODE = '23514';
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Invalid AI audit event' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_ai_audit(jsonb) FROM PUBLIC,lexon_app,lexon_auth;
