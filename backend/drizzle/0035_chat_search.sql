CREATE TABLE app.message_feedback (
  org_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  message_id uuid NOT NULL,
  rating text NOT NULL CHECK (rating IN ('good','bad')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,owner_user_id,chat_id,message_id),
  CONSTRAINT message_feedback_message_fk FOREIGN KEY (org_id,chat_id,message_id)
    REFERENCES app.chat_messages(org_id,chat_id,id) ON DELETE CASCADE
);
ALTER TABLE app.message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY message_feedback_owner ON app.message_feedback FOR ALL TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=message_feedback.org_id
      AND c.id=message_feedback.chat_id AND c.owner_user_id=message_feedback.owner_user_id
      AND c.deleted_at IS NULL))
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=message_feedback.org_id
      AND c.id=message_feedback.chat_id AND c.owner_user_id=message_feedback.owner_user_id
      AND c.deleted_at IS NULL));
CREATE POLICY message_feedback_internal ON app.message_feedback FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.message_feedback TO lexon_app;
REVOKE TRUNCATE ON app.message_feedback FROM lexon_app,lexon_auth,PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.lexon_validate_ai_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE
  metadata jsonb := event->'metadata';
  field text;
  allowed_metadata text[];
  required_metadata text[];
  valid boolean := false;
  id_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR NOT (event ?& ARRAY['version','eventId','type','occurredAt','outcome','orgId','actorUserId','metadata'])
    OR event->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR NOT COALESCE(event->>'eventId' ~* id_pattern, false)
    OR NOT COALESCE(event->>'orgId' ~* id_pattern, false)
    OR NOT COALESCE(event->>'actorUserId' ~* id_pattern, false)
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
      valid := event->>'outcome' IN ('success','failure') AND metadata->>'status' IN ('proposed','pending','completed','failed','unknown')
        AND ((metadata->>'status' IN ('proposed','pending','completed')) = (event->>'outcome'='success'));
    WHEN 'chat.approval_decided.v1' THEN
      allowed_metadata := ARRAY['runId','operationId','status'];
      required_metadata := ARRAY['runId','operationId','status'];
      valid := event->>'outcome'='success' AND metadata->>'status' IN ('approved','rejected');
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
    OR (metadata ? 'safeCode' AND jsonb_typeof(metadata->'safeCode') IS DISTINCT FROM 'string') THEN
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
