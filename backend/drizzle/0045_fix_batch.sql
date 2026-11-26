-- Fix batch (F6 batch-1 review): four corrections in one migration.
-- 1. Settle-definer owner-access guard: finalize/decide/expire/facts now
--    refuse unless the run's bound chat is a live project chat whose
--    lexon_project_access for the initiator is 'none' — no false
--    AI_ACCESS_REVOKED on a healthy run. Subsumes the tombstone guard.
-- 2. chat_messages_project_activity stops touching the projects hot row on
--    every message: last_activity_at moves only when it is older than 60s.
-- 3. The lexon_app projects UPDATE grant narrows to the editable columns.
-- 4. ops.lexon_chat_notification_audience resolves a chat's read audience
--    once per notification (org-scoped service claims only), replacing the
--    per-connection readLive fan-out and backing notifyAccessChanged.

CREATE OR REPLACE FUNCTION ops.lexon_ai_access_loss_facts(
  input_org_id uuid, input_user_id uuid, input_run_id uuid
) RETURNS TABLE(
  run_status text, run_version integer, next_sequence integer,
  step_id uuid, step_sequence integer, step_expected_version integer,
  step_fence bigint, step_state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE
  context_org uuid; context_user uuid; run_row app.ai_runs%ROWTYPE; step_row record;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
    OR input_run_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT * INTO run_row FROM app.ai_runs r
   WHERE r.org_id=input_org_id AND r.id=input_run_id
     AND r.initiating_user_id=input_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- Fix-batch minor: settle requires the bound-chat owner access to be
  -- actually lost, the same fact lexon_ai_access_loss_facts probes — the
  -- resourceIds->>0 chat must be a live project-bound chat whose
  -- lexon_project_access for the initiator is 'none'. A live standalone
  -- bound chat is always owner-visible (the write fence proves
  -- chat_owner=initiator at bind time), so anything else means the
  -- invisibility has another cause (foreign run, tombstone, transient)
  -- and must never write a false AI_ACCESS_REVOKED audit.
  IF run_row.resolved_config->'resourceIds'->>0 IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL
         AND c.project_id IS NOT NULL
         AND ops.lexon_project_access(c.org_id,c.project_id,input_user_id)='none') THEN
    RETURN;
  END IF;
  run_status:=run_row.status;
  run_version:=run_row.run_version;
  next_sequence:=run_row.next_sequence;
  step_id:=NULL; step_sequence:=NULL; step_expected_version:=NULL;
  step_fence:=NULL; step_state:=NULL;
  SELECT s.id,s.sequence,s.expected_version,s.fence,s.state INTO step_row
    FROM app.ai_steps s
   WHERE s.org_id=input_org_id AND s.run_id=input_run_id
     AND s.sequence=run_row.next_sequence
     AND s.state IN ('pending','claimed')
   ORDER BY s.updated_at DESC LIMIT 1 FOR UPDATE OF s;
  IF FOUND THEN
    step_id:=step_row.id; step_sequence:=step_row.sequence;
    step_expected_version:=step_row.expected_version;
    step_fence:=step_row.fence; step_state:=step_row.state;
  END IF;
  RETURN NEXT;
END $$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION ops.lexon_ai_finalize_access_loss(
  input_org_id uuid, input_user_id uuid, input_run_id uuid,
  input_expected_version integer, input_sequence integer,
  input_step_id uuid, input_fence bigint
) RETURNS TABLE(changed boolean, run_version integer, run_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE
  context_org uuid; context_user uuid;
  run_row app.ai_runs%ROWTYPE;
  op_row record;
  chat_row record;
  active_ids uuid[];
  provider text;
BEGIN
  changed:=false; run_version:=NULL; run_status:=NULL;
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
    OR input_run_id IS NULL OR input_step_id IS NULL
    OR input_expected_version IS NULL OR input_expected_version<1
    OR input_sequence IS NULL OR input_sequence<1
    -- fence is a claim stamp, not liveness: a still-pending step legitimately
    -- carries fence=0 (insertInitial), so only negative values are refused.
    OR input_fence IS NULL OR input_fence<0 THEN
    RETURN NEXT; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT * INTO run_row FROM app.ai_runs r
   WHERE r.org_id=input_org_id AND r.id=input_run_id
     AND r.initiating_user_id=input_user_id
     AND r.status IN ('queued','running','awaiting_approval','cancelling')
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;
  -- Fix-batch minor: settle requires the bound-chat owner access to be
  -- actually lost, the same fact lexon_ai_access_loss_facts probes — the
  -- resourceIds->>0 chat must be a live project-bound chat whose
  -- lexon_project_access for the initiator is 'none'. A live standalone
  -- bound chat is always owner-visible (the write fence proves
  -- chat_owner=initiator at bind time), so anything else means the
  -- invisibility has another cause (foreign run, tombstone, transient)
  -- and must never write a false AI_ACCESS_REVOKED audit.
  IF run_row.resolved_config->'resourceIds'->>0 IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL
         AND c.project_id IS NOT NULL
         AND ops.lexon_project_access(c.org_id,c.project_id,input_user_id)='none') THEN
    RETURN NEXT; RETURN;
  END IF;
  -- The fence pair mirrors ai_chat_deleted_cancel_facts: a live run's step
  -- carries expected_version=run_version; a 'cancelling' run bumped
  -- run_version past the live claim's expected_version.
  IF NOT (
    (run_row.status='cancelling' AND run_row.run_version=input_expected_version+1)
    OR (run_row.status<>'cancelling' AND run_row.run_version=input_expected_version)
  ) THEN RETURN NEXT; RETURN; END IF;
  UPDATE app.ai_steps s SET state='failed',updated_at=clock_timestamp()
   WHERE s.org_id=input_org_id AND s.run_id=input_run_id AND s.id=input_step_id
     AND s.sequence=input_sequence AND s.expected_version=input_expected_version
     AND s.fence=input_fence AND s.state IN ('pending','claimed');
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;
  SELECT COALESCE(array_agg(a.id ORDER BY a.id),'{}'::uuid[]) INTO active_ids
    FROM app.ai_attempts a
   WHERE a.org_id=input_org_id AND a.run_id=input_run_id
     AND a.step_id=input_step_id AND a.fence=input_fence AND a.active;
  UPDATE app.ai_attempts SET active=false,outcome='unknown',settled_at=clock_timestamp()
   WHERE org_id=input_org_id AND run_id=input_run_id AND step_id=input_step_id
     AND fence=input_fence AND active;
  UPDATE app.usage_events SET outcome='unknown',settled_at=COALESCE(settled_at,clock_timestamp())
   WHERE attempt_id=ANY(active_ids) AND outcome='reserved';
  provider:=run_row.resolved_config->>'provider';
  IF provider IS NULL OR provider !~ '^[a-zA-Z0-9._/-]{1,80}$' THEN
    RAISE EXCEPTION 'AI run provider metadata invalid' USING ERRCODE='23514';
  END IF;
  FOR op_row IN
    SELECT o.id,o.step_id,o.status FROM app.ai_operations o
      JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
     WHERE o.org_id=input_org_id AND o.run_id=input_run_id AND s.sequence<input_sequence
       AND o.status IN ('pending','awaiting_approval','approved')
     ORDER BY s.sequence,o.call_occurrence FOR UPDATE OF o
  LOOP
    IF op_row.status='awaiting_approval' THEN
      UPDATE app.ai_operations
         SET status='rejected',decision='reject',decision_by_user_id=input_user_id,
             decided_at=clock_timestamp(),result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=input_org_id AND id=op_row.id AND status='awaiting_approval' AND decision IS NULL;
    ELSIF op_row.status='approved' THEN
      UPDATE app.ai_operations
         SET status='rejected',error_code='AI_ACCESS_REVOKED',
             result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=input_org_id AND id=op_row.id AND status='approved' AND decision='approve';
    ELSE
      UPDATE app.ai_operations
         SET status='failed',error_code='AI_ACCESS_REVOKED',
             result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             completed_at=clock_timestamp()
       WHERE org_id=input_org_id AND id=op_row.id AND status='pending' AND decision IS NULL;
    END IF;
    INSERT INTO ops.audit_events
      (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
    VALUES (gen_random_uuid(),1,'chat.tool_operation.v1',clock_timestamp(),'failure',
            input_user_id,input_org_id,
            jsonb_build_object('runId',input_run_id,'stepId',op_row.step_id,
              'operationId',op_row.id,'model',run_row.model_id,'provider',provider,
              'status','failed'));
  END LOOP;
  -- ai_runs.run_version is qualified everywhere: the OUT parameters shadow
  -- bare column names inside DML.
  UPDATE app.ai_runs SET status='failed',run_version=ai_runs.run_version+1,
    next_sequence=input_sequence+1,error_code='AI_ACCESS_REVOKED',
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE org_id=input_org_id AND id=input_run_id
     AND status=run_row.status AND ai_runs.run_version=run_row.run_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI access-loss state changed' USING ERRCODE='40001';
  END IF;
  INSERT INTO ops.audit_events
    (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
  VALUES (gen_random_uuid(),1,'chat.run_finished.v1',clock_timestamp(),'failure',
          input_user_id,input_org_id,
          jsonb_build_object('runId',input_run_id,'model',run_row.model_id,
            'provider',provider,'status','failed','safeCode','AI_ACCESS_REVOKED'));
  FOR chat_row IN
    SELECT cr.chat_id FROM app.chat_runs cr
     WHERE cr.org_id=input_org_id AND cr.run_id=input_run_id AND cr.kind='answer'
  LOOP
    PERFORM pg_notify('lexon_chat_title',
      jsonb_build_object('orgId',input_org_id,'chatId',chat_row.chat_id)::text);
  END LOOP;
  run_version:=run_row.run_version+1; run_status:='failed'; changed:=true;
  RETURN NEXT;
END $$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION ops.lexon_ai_access_loss_decide(
  input_org_id uuid, input_user_id uuid, input_run_id uuid,
  input_operation_id uuid, input_snapshot_hash text
) RETURNS TABLE(
  found boolean, changed boolean,
  operation_status text, operation_decision text,
  operation_decided_at timestamptz,
  step_id uuid, step_sequence integer, step_expected_version integer,
  step_fence bigint, run_version integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE
  context_org uuid; context_user uuid;
  run_row app.ai_runs%ROWTYPE;
  op_row record;
  step_row record;
  chat_row record;
  provider text;
  -- plpgsql's implicit FOUND variable shadows an OUT parameter named 'found',
  -- so the flag rides in op_found and every emit is a positional RETURN QUERY.
  op_found boolean:=false;
BEGIN
  changed:=false;
  operation_status:=NULL; operation_decision:=NULL; operation_decided_at:=NULL;
  step_id:=NULL; step_sequence:=NULL; step_expected_version:=NULL;
  step_fence:=NULL; run_version:=NULL;
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
    OR input_run_id IS NULL OR input_operation_id IS NULL THEN
    RETURN QUERY SELECT op_found,changed,operation_status,operation_decision,
      operation_decided_at,step_id,step_sequence,step_expected_version,
      step_fence,run_version; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT * INTO run_row FROM app.ai_runs r
   WHERE r.org_id=input_org_id AND r.id=input_run_id
     AND r.initiating_user_id=input_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT op_found,changed,operation_status,operation_decision,
      operation_decided_at,step_id,step_sequence,step_expected_version,
      step_fence,run_version; RETURN;
  END IF;
  op_found:=true;
  -- Fix-batch minor: settle requires the bound-chat owner access to be
  -- actually lost, the same fact lexon_ai_access_loss_facts probes — the
  -- resourceIds->>0 chat must be a live project-bound chat whose
  -- lexon_project_access for the initiator is 'none'. A live standalone
  -- bound chat is always owner-visible (the write fence proves
  -- chat_owner=initiator at bind time), so anything else means the
  -- invisibility has another cause (foreign run, tombstone, transient)
  -- and must never write a false AI_ACCESS_REVOKED audit.
  IF run_row.resolved_config->'resourceIds'->>0 IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL
         AND c.project_id IS NOT NULL
         AND ops.lexon_project_access(c.org_id,c.project_id,input_user_id)='none') THEN
    RETURN QUERY SELECT op_found,changed,operation_status,operation_decision,
      operation_decided_at,step_id,step_sequence,step_expected_version,
      step_fence,run_version; RETURN;
  END IF;
  SELECT o.id,o.step_id,o.status,o.decision,o.decided_at,o.kind,
         o.approval_required,o.snapshot_hash,s.sequence,s.expected_version,s.fence
    INTO op_row
    FROM app.ai_operations o
    JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
   WHERE o.org_id=input_org_id AND o.run_id=input_run_id AND o.id=input_operation_id
   FOR UPDATE OF o;
  -- Idempotent outcome: an already-decided (or expired) op returns its stored
  -- state before any live-shape validation, matching the claim-path decide.
  IF FOUND AND (op_row.decision IS NOT NULL OR op_row.status='expired') THEN
    operation_status:=op_row.status;
    operation_decision:=op_row.decision;
    operation_decided_at:=op_row.decided_at;
    RETURN QUERY SELECT op_found,changed,operation_status,operation_decision,
      operation_decided_at,step_id,step_sequence,step_expected_version,
      step_fence,run_version; RETURN;
  END IF;
  IF NOT FOUND
    OR run_row.status<>'awaiting_approval'
    OR op_row.kind<>'approval'
    OR op_row.status<>'awaiting_approval'
    OR op_row.approval_required IS DISTINCT FROM true
    OR (input_snapshot_hash IS NOT NULL
      AND op_row.snapshot_hash IS DISTINCT FROM input_snapshot_hash) THEN
    RETURN QUERY SELECT op_found,changed,operation_status,operation_decision,
      operation_decided_at,step_id,step_sequence,step_expected_version,
      step_fence,run_version; RETURN;
  END IF;
  provider:=run_row.resolved_config->>'provider';
  IF provider IS NULL OR provider !~ '^[a-zA-Z0-9._/-]{1,80}$' THEN
    RAISE EXCEPTION 'AI run provider metadata invalid' USING ERRCODE='23514';
  END IF;
  -- The decided op rejects first, then every other outstanding op on the run
  -- settles with the same arms as the worker-side failRevokedResume.
  UPDATE app.ai_operations
     SET status='rejected',decision='reject',decision_by_user_id=input_user_id,
         decided_at=clock_timestamp(),result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
         error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),expires_at=NULL
   WHERE org_id=input_org_id AND id=op_row.id
     AND status='awaiting_approval' AND decision IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI access-loss state changed' USING ERRCODE='40001';
  END IF;
  INSERT INTO ops.audit_events
    (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
  VALUES (gen_random_uuid(),1,'chat.tool_operation.v1',clock_timestamp(),'failure',
          input_user_id,input_org_id,
          jsonb_build_object('runId',input_run_id,'stepId',op_row.step_id,
            'operationId',op_row.id,'model',run_row.model_id,'provider',provider,
            'status','failed'));
  FOR step_row IN
    SELECT o.id AS operation_id,o.step_id,o.status FROM app.ai_operations o
      JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
     WHERE o.org_id=input_org_id AND o.run_id=input_run_id AND o.id<>op_row.id
       AND o.status IN ('pending','awaiting_approval','approved')
     ORDER BY s.sequence,o.call_occurrence FOR UPDATE OF o
  LOOP
    IF step_row.status='awaiting_approval' THEN
      UPDATE app.ai_operations
         SET status='rejected',decision='reject',decision_by_user_id=input_user_id,
             decided_at=clock_timestamp(),result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=input_org_id AND id=step_row.operation_id
         AND status='awaiting_approval' AND decision IS NULL;
    ELSIF step_row.status='approved' THEN
      UPDATE app.ai_operations
         SET status='rejected',error_code='AI_ACCESS_REVOKED',
             result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=input_org_id AND id=step_row.operation_id
         AND status='approved' AND decision='approve';
    ELSE
      UPDATE app.ai_operations
         SET status='failed',error_code='AI_ACCESS_REVOKED',
             result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             completed_at=clock_timestamp()
       WHERE org_id=input_org_id AND id=step_row.operation_id
         AND status='pending' AND decision IS NULL;
    END IF;
    INSERT INTO ops.audit_events
      (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
    VALUES (gen_random_uuid(),1,'chat.tool_operation.v1',clock_timestamp(),'failure',
            input_user_id,input_org_id,
            jsonb_build_object('runId',input_run_id,'stepId',step_row.step_id,
              'operationId',step_row.operation_id,'model',run_row.model_id,
              'provider',provider,'status','failed'));
  END LOOP;
  -- The paused run fails without advancing next_sequence — the paused step
  -- stays 'awaiting_approval' so it remains the terminal stream anchor.
  UPDATE app.ai_runs SET status='failed',run_version=ai_runs.run_version+1,
    error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE org_id=input_org_id AND id=input_run_id
     AND status='awaiting_approval' AND ai_runs.run_version=run_row.run_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI access-loss state changed' USING ERRCODE='40001';
  END IF;
  INSERT INTO ops.audit_events
    (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
  VALUES (gen_random_uuid(),1,'chat.run_finished.v1',clock_timestamp(),'failure',
          input_user_id,input_org_id,
          jsonb_build_object('runId',input_run_id,'model',run_row.model_id,
            'provider',provider,'status','failed','safeCode','AI_ACCESS_REVOKED'));
  FOR chat_row IN
    SELECT cr.chat_id FROM app.chat_runs cr
     WHERE cr.org_id=input_org_id AND cr.run_id=input_run_id AND cr.kind='answer'
  LOOP
    PERFORM pg_notify('lexon_chat_title',
      jsonb_build_object('orgId',input_org_id,'chatId',chat_row.chat_id)::text);
  END LOOP;
  changed:=true;
  operation_status:='rejected'; operation_decision:='reject';
  operation_decided_at:=clock_timestamp();
  step_id:=op_row.step_id; step_sequence:=op_row.sequence;
  step_expected_version:=op_row.expected_version; step_fence:=op_row.fence;
  run_version:=run_row.run_version+1;
  RETURN QUERY SELECT op_found,changed,operation_status,operation_decision,
    operation_decided_at,step_id,step_sequence,step_expected_version,
    step_fence,run_version; RETURN;
END $$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION ops.lexon_ai_expire_access_loss(
  input_org_id uuid, input_user_id uuid, input_run_id uuid,
  input_operation_id uuid
) RETURNS TABLE(
  found boolean, changed boolean, operation_kind text,
  step_id uuid, step_sequence integer, step_expected_version integer,
  step_fence bigint, run_version integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE
  context_org uuid; context_user uuid;
  run_row app.ai_runs%ROWTYPE;
  op_row record; step_row record; chat_row record;
  provider text;
  -- plpgsql's implicit FOUND variable shadows an OUT parameter named 'found',
  -- so the flag rides in op_found and every emit is a positional RETURN QUERY.
  op_found boolean:=false;
BEGIN
  changed:=false; operation_kind:=NULL;
  step_id:=NULL; step_sequence:=NULL; step_expected_version:=NULL;
  step_fence:=NULL; run_version:=NULL;
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
    OR input_run_id IS NULL OR input_operation_id IS NULL THEN
    RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
      step_expected_version,step_fence,run_version; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT * INTO run_row FROM app.ai_runs r
   WHERE r.org_id=input_org_id AND r.id=input_run_id
     AND r.initiating_user_id=input_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
      step_expected_version,step_fence,run_version; RETURN;
  END IF;
  op_found:=true;
  -- Fix-batch minor: settle requires the bound-chat owner access to be
  -- actually lost, the same fact lexon_ai_access_loss_facts probes — the
  -- resourceIds->>0 chat must be a live project-bound chat whose
  -- lexon_project_access for the initiator is 'none'. A live standalone
  -- bound chat is always owner-visible (the write fence proves
  -- chat_owner=initiator at bind time), so anything else means the
  -- invisibility has another cause (foreign run, tombstone, transient)
  -- and must never write a false AI_ACCESS_REVOKED audit.
  IF run_row.resolved_config->'resourceIds'->>0 IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL
         AND c.project_id IS NOT NULL
         AND ops.lexon_project_access(c.org_id,c.project_id,input_user_id)='none') THEN
    RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
      step_expected_version,step_fence,run_version; RETURN;
  END IF;
  SELECT o.id,o.step_id,o.status,o.decision,o.kind,o.expires_at,
         s.sequence,s.expected_version,s.fence INTO op_row
    FROM app.ai_operations o
    JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
   WHERE o.org_id=input_org_id AND o.run_id=input_run_id AND o.id=input_operation_id
   FOR UPDATE OF o;
  IF NOT FOUND THEN
    RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
      step_expected_version,step_fence,run_version; RETURN;
  END IF;
  operation_kind:=op_row.kind;
  IF op_row.decision IS NOT NULL OR op_row.status='expired' THEN
    RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
      step_expected_version,step_fence,run_version; RETURN;
  END IF;
  IF run_row.status<>'awaiting_approval' OR op_row.status<>'awaiting_approval'
    OR op_row.expires_at IS NULL OR op_row.expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
      step_expected_version,step_fence,run_version; RETURN;
  END IF;
  provider:=run_row.resolved_config->>'provider';
  IF provider IS NULL OR provider !~ '^[a-zA-Z0-9._/-]{1,80}$' THEN
    RAISE EXCEPTION 'AI run provider metadata invalid' USING ERRCODE='23514';
  END IF;
  UPDATE app.ai_operations
     SET status='expired',decided_at=clock_timestamp(),expires_at=NULL,
         result=CASE WHEN kind='approval' THEN '{"expired":"approval"}'::jsonb
          ELSE '{"unanswered":true}'::jsonb END,
         completed_at=clock_timestamp()
   WHERE org_id=input_org_id AND id=op_row.id
     AND status='awaiting_approval' AND decision IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI access-loss state changed' USING ERRCODE='40001';
  END IF;
  INSERT INTO ops.audit_events
    (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
  VALUES (gen_random_uuid(),1,
          CASE WHEN op_row.kind='question'
            THEN 'chat.question_decided.v1' ELSE 'chat.approval_decided.v1' END,
          clock_timestamp(),'failure',NULL,input_org_id,
          jsonb_build_object('runId',input_run_id,'operationId',op_row.id,
            'status','expired'));
  FOR step_row IN
    SELECT o.id AS operation_id,o.step_id,o.status FROM app.ai_operations o
      JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
     WHERE o.org_id=input_org_id AND o.run_id=input_run_id AND o.id<>op_row.id
       AND o.status IN ('pending','awaiting_approval','approved')
     ORDER BY s.sequence,o.call_occurrence FOR UPDATE OF o
  LOOP
    IF step_row.status='awaiting_approval' THEN
      UPDATE app.ai_operations
         SET status='rejected',decision='reject',decision_by_user_id=input_user_id,
             decided_at=clock_timestamp(),result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=input_org_id AND id=step_row.operation_id
         AND status='awaiting_approval' AND decision IS NULL;
    ELSIF step_row.status='approved' THEN
      UPDATE app.ai_operations
         SET status='rejected',error_code='AI_ACCESS_REVOKED',
             result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=input_org_id AND id=step_row.operation_id
         AND status='approved' AND decision='approve';
    ELSE
      UPDATE app.ai_operations
         SET status='failed',error_code='AI_ACCESS_REVOKED',
             result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
             completed_at=clock_timestamp()
       WHERE org_id=input_org_id AND id=step_row.operation_id
         AND status='pending' AND decision IS NULL;
    END IF;
    INSERT INTO ops.audit_events
      (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
    VALUES (gen_random_uuid(),1,'chat.tool_operation.v1',clock_timestamp(),'failure',
            input_user_id,input_org_id,
            jsonb_build_object('runId',input_run_id,'stepId',step_row.step_id,
              'operationId',step_row.operation_id,'model',run_row.model_id,
              'provider',provider,'status','failed'));
  END LOOP;
  UPDATE app.ai_runs SET status='failed',run_version=ai_runs.run_version+1,
    error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE org_id=input_org_id AND id=input_run_id
     AND status='awaiting_approval' AND ai_runs.run_version=run_row.run_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI access-loss state changed' USING ERRCODE='40001';
  END IF;
  INSERT INTO ops.audit_events
    (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
  VALUES (gen_random_uuid(),1,'chat.run_finished.v1',clock_timestamp(),'failure',
          input_user_id,input_org_id,
          jsonb_build_object('runId',input_run_id,'model',run_row.model_id,
            'provider',provider,'status','failed','safeCode','AI_ACCESS_REVOKED'));
  FOR chat_row IN
    SELECT cr.chat_id FROM app.chat_runs cr
     WHERE cr.org_id=input_org_id AND cr.run_id=input_run_id AND cr.kind='answer'
  LOOP
    PERFORM pg_notify('lexon_chat_title',
      jsonb_build_object('orgId',input_org_id,'chatId',chat_row.chat_id)::text);
  END LOOP;
  changed:=true;
  step_id:=op_row.step_id; step_sequence:=op_row.sequence;
  step_expected_version:=op_row.expected_version; step_fence:=op_row.fence;
  run_version:=run_row.run_version+1;
  RETURN QUERY SELECT op_found,changed,operation_kind,step_id,step_sequence,
    step_expected_version,step_fence,run_version; RETURN;
END $$;

--> statement-breakpoint

-- Hot-row guard: message activity only refreshes a project timestamp older
-- than 60 seconds; the per-message UPDATE on the project row disappears for
-- bursts, removing the chats->projects lock edge the decide/send deadlock
-- cycle could feed on inside project chats.
CREATE OR REPLACE FUNCTION ops.lexon_project_chat_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  UPDATE app.projects p SET last_activity_at=clock_timestamp()
    FROM app.chats c
    WHERE c.org_id=NEW.org_id AND c.id=NEW.chat_id AND c.project_id IS NOT NULL
      AND p.org_id=c.org_id AND p.id=c.project_id
      AND p.last_activity_at < clock_timestamp() - interval '60 seconds';
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Column-grant narrow: lexon_app may only update the editable project fields;
-- identity columns (id, org_id, owner_user_id), the trigger-owned counters
-- and timestamps (member_count, chat_count, last_activity_at) and created_at
-- are no longer writable by the application role.
REVOKE UPDATE ON app.projects FROM lexon_app;
GRANT UPDATE (name, matter_number, practice_area, updated_at)
  ON app.projects TO lexon_app;
--> statement-breakpoint
-- Notification audience definer: resolves the user ids that may read a chat
-- once per org notification — standalone: owner + share recipients; project:
-- project owner + members, minus denies, restricted to current org members.
-- Service-claims binding: an org-scoped context (app.user_id NULL) only.
CREATE FUNCTION ops.lexon_chat_notification_audience(
  input_org_id uuid, input_chat_id uuid
) RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NOT NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_chat_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.owner_user_id FROM app.chats c
     WHERE c.org_id=input_org_id AND c.id=input_chat_id AND c.deleted_at IS NULL
    UNION
    SELECT s.user_id FROM app.chat_shares s
      JOIN app.chats c ON c.org_id=s.org_id AND c.id=s.chat_id
     WHERE s.org_id=input_org_id AND s.chat_id=input_chat_id
       AND c.project_id IS NULL AND c.deleted_at IS NULL
       AND ops.lexon_org_member(s.org_id,s.user_id)
    UNION
    SELECT p.owner_user_id FROM app.projects p
      JOIN app.chats c ON c.org_id=p.org_id AND c.project_id=p.id
     WHERE c.org_id=input_org_id AND c.id=input_chat_id AND c.deleted_at IS NULL
       AND ops.lexon_org_member(p.org_id,p.owner_user_id)
       AND NOT EXISTS (SELECT 1 FROM app.project_denies d
         WHERE d.org_id=p.org_id AND d.project_id=p.id
           AND d.user_id=p.owner_user_id)
    UNION
    SELECT m.user_id FROM app.project_members m
      JOIN app.chats c ON c.org_id=m.org_id AND c.project_id=m.project_id
     WHERE c.org_id=input_org_id AND c.id=input_chat_id AND c.deleted_at IS NULL
       AND ops.lexon_org_member(m.org_id,m.user_id)
       AND NOT EXISTS (SELECT 1 FROM app.project_denies d
         WHERE d.org_id=m.org_id AND d.project_id=m.project_id
           AND d.user_id=m.user_id);
END $$;
REVOKE ALL ON FUNCTION ops.lexon_chat_notification_audience(uuid,uuid) FROM PUBLIC,lexon_auth,lexon_migrator;
GRANT EXECUTE ON FUNCTION ops.lexon_chat_notification_audience(uuid,uuid) TO lexon_app;
