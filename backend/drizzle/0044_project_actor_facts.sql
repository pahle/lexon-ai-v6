-- F6 §9/§4.4: project access-loss machinery. The actor-facts definer gains a
-- four-argument overload that resolves the run row and the bound chat's
-- project standing as the definer role — the run row is invisible to lexon_app
-- once the owner loses project access, so the capability gate's inputs must
-- come from the definer side. The finalize/decide definers execute the F5
-- access-loss sequence (step+operation terminalization, run transition,
-- audit append, chat invalidation notify) under the same claims-binding and
-- advisory-lock family as the F4 deleted-chat finalizers; they return
-- ids/status only, never content.

CREATE FUNCTION auth.lexon_ai_actor_facts(
  input_org_id uuid, input_user_id uuid,
  input_run_id uuid, input_chat_id uuid
)
RETURNS TABLE (
  actor_user_id uuid,
  email_verified boolean,
  banned boolean,
  two_factor_enabled boolean,
  membership_role text,
  organization_kind text,
  organization_state text,
  require2fa boolean,
  initiating_user_id uuid,
  initiating_session_id uuid,
  initiating_mfa_verified_at timestamptz,
  project_id uuid,
  owner_project_role text,
  owner_denied boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,auth,ops,pg_temp AS $$
DECLARE
  base record;
  run_row app.ai_runs%ROWTYPE;
  chat_row record;
  chat_ref uuid;
  project_owner uuid;
BEGIN
  SELECT * INTO base FROM auth.lexon_ai_actor_facts(input_org_id,input_user_id);
  IF NOT FOUND THEN RETURN; END IF;
  initiating_user_id:=input_user_id;
  initiating_session_id:=NULL;
  initiating_mfa_verified_at:=NULL;
  project_id:=NULL;
  owner_project_role:=NULL;
  owner_denied:=false;
  chat_ref:=input_chat_id;
  IF input_run_id IS NOT NULL THEN
    SELECT * INTO run_row FROM app.ai_runs r
     WHERE r.org_id=input_org_id AND r.id=input_run_id;
    IF NOT FOUND THEN RETURN; END IF;
    initiating_user_id:=run_row.initiating_user_id;
    initiating_session_id:=run_row.initiating_session_id;
    initiating_mfa_verified_at:=run_row.initiating_mfa_verified_at;
    IF jsonb_typeof(run_row.resolved_config->'resourceIds')='array'
      AND jsonb_array_length(run_row.resolved_config->'resourceIds')=1
      AND (run_row.resolved_config->'resourceIds'->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      chat_ref:=(run_row.resolved_config->'resourceIds'->>0)::uuid;
    END IF;
  END IF;
  IF chat_ref IS NOT NULL THEN
    SELECT c.project_id,c.owner_user_id INTO chat_row FROM app.chats c
     WHERE c.org_id=input_org_id AND c.id=chat_ref;
    IF FOUND AND chat_row.project_id IS NOT NULL THEN
      project_id:=chat_row.project_id;
      -- The CHAT OWNER's standing, not the caller's: lexon_project_access
      -- binds the caller claim, so the probe is expanded inline (org member,
      -- deny beats standing, then owner/member rows — the §4.2 order).
      owner_denied:=ops.lexon_project_denied(input_org_id,chat_row.project_id,
        chat_row.owner_user_id);
      IF ops.lexon_org_member(input_org_id,chat_row.owner_user_id)
        AND NOT owner_denied THEN
        SELECT p.owner_user_id INTO project_owner FROM app.projects p
         WHERE p.org_id=input_org_id AND p.id=chat_row.project_id;
        IF FOUND AND project_owner=chat_row.owner_user_id THEN
          owner_project_role:='owner';
        ELSE
          SELECT m.role INTO owner_project_role FROM app.project_members m
           WHERE m.org_id=input_org_id AND m.project_id=chat_row.project_id
             AND m.user_id=chat_row.owner_user_id;
        END IF;
      END IF;
    END IF;
  END IF;
  actor_user_id:=base.actor_user_id;
  email_verified:=base.email_verified;
  banned:=base.banned;
  two_factor_enabled:=base.two_factor_enabled;
  membership_role:=base.membership_role;
  organization_kind:=base.organization_kind;
  organization_state:=base.organization_state;
  require2fa:=base.require2fa;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_ai_actor_facts(uuid,uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION auth.lexon_ai_actor_facts(uuid,uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- Probe for the access-loss family: returns the live run's status/version and
-- the pending-or-claimed step at next_sequence when the caller is the run
-- initiator — the run row itself is invisible to lexon_app, so this is the
-- only way a claim can learn that an invisible run exists at all.
CREATE FUNCTION ops.lexon_ai_access_loss_facts(
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
  -- Tombstoned-chat invisibility belongs to the F4 deletion family, not the
  -- access-loss settle: when the run's linked chat (the resourceIds->>0
  -- binding the read policy uses) is deleted, the deletion sweep owns the
  -- rows and the claim path keeps its fence-noop semantics.
  IF run_row.resolved_config->'resourceIds'->>0 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL) THEN
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
REVOKE ALL ON FUNCTION ops.lexon_ai_access_loss_facts(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_ai_access_loss_facts(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- The worker/claim access-loss finalizer: verifies the caller's step claim
-- coordinates against the locked run+step, fails the step, settles its active
-- attempts and reserved usage, settles every outstanding operation on earlier
-- steps (pending→failed, awaiting_approval→rejected, approved→rejected — the
-- #failRevokedResume arms verbatim), transitions the run to
-- failed/AI_ACCESS_REVOKED, appends the audit pair, and notifies each bound
-- chat's invalidation listeners. changed=false for every refused probe.
CREATE FUNCTION ops.lexon_ai_finalize_access_loss(
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
  -- A tombstoned bound chat means the deletion sweep owns the invisibility,
  -- not access loss — refuse the settle so the claim path fences as before.
  IF run_row.resolved_config->'resourceIds'->>0 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL) THEN
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
REVOKE ALL ON FUNCTION ops.lexon_ai_finalize_access_loss(uuid,uuid,uuid,integer,integer,uuid,bigint) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_ai_finalize_access_loss(uuid,uuid,uuid,integer,integer,uuid,bigint) TO lexon_app;
--> statement-breakpoint
-- The decision-side access-loss path: a paused (awaiting_approval) run whose
-- owner can no longer see it is settled entirely inside the definer — the
-- decided approval op rejects, every other outstanding op settles, the run
-- fails with AI_ACCESS_REVOKED, the audit pair appends, and the paused step's
-- coordinates come back for the terminal stream reference. An already-
-- terminal run returns the stored op outcome unchanged (the decide retry
-- shape). found=false distinguishes an absent/foreign run from a refused one.
CREATE FUNCTION ops.lexon_ai_access_loss_decide(
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
  -- Deletion owns tombstoned-chat invisibility: refuse before any outcome
  -- read so the caller gets the same refusal a foreign/absent run gets.
  IF run_row.resolved_config->'resourceIds'->>0 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL) THEN
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
REVOKE ALL ON FUNCTION ops.lexon_ai_access_loss_decide(uuid,uuid,uuid,uuid,text) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_ai_access_loss_decide(uuid,uuid,uuid,uuid,text) TO lexon_app;
--> statement-breakpoint
-- Terminal stream proof for initiator-invisible runs: after an access-loss
-- finalization the run row is RLS-invisible to the initiator's claim, so the
-- stream authority's app-role SELECT cannot validate the terminal reference.
-- This definer repeats the proof's step-shape rules (latest committed/
-- awaiting step, else the failed/cancelled anchor) as the definer role and
-- returns the same columns; the repository still enforces the caller's
-- coordinate match before the finish event is written.
CREATE FUNCTION ops.lexon_ai_terminal_stream_proof(
  input_org_id uuid, input_user_id uuid, input_run_id uuid
) RETURNS TABLE(
  status text, error_code text, run_version integer, next_sequence integer,
  step_id uuid, sequence integer, expected_version integer, fence bigint,
  stream_generation bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE
  context_org uuid; context_user uuid;
  run_row app.ai_runs%ROWTYPE; step_row record;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
    OR input_run_id IS NULL THEN RETURN; END IF;
  SELECT * INTO run_row FROM app.ai_runs r
   WHERE r.org_id=input_org_id AND r.id=input_run_id
     AND r.initiating_user_id=input_user_id
     AND r.status IN ('completed','failed','cancelled');
  IF NOT FOUND THEN RETURN; END IF;
  SELECT s.id,s.sequence,s.expected_version,s.fence INTO step_row
    FROM app.ai_steps s
   WHERE s.org_id=input_org_id AND s.run_id=input_run_id
     AND s.state IN ('committed','awaiting_approval')
   ORDER BY s.sequence DESC,s.updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT s.id,s.sequence,s.expected_version,s.fence INTO step_row
      FROM app.ai_steps s
     WHERE s.org_id=input_org_id AND s.run_id=input_run_id
       AND ((run_row.status='failed' AND s.state='failed'
             AND s.sequence=run_row.next_sequence-1
             AND s.expected_version<=run_row.run_version) OR
            (run_row.status='cancelled' AND s.state IN ('pending','claimed')
             AND s.sequence=run_row.next_sequence
             AND s.expected_version<=run_row.run_version))
       AND NOT EXISTS (
         SELECT 1 FROM app.ai_steps prior
          WHERE prior.org_id=s.org_id AND prior.run_id=s.run_id
            AND prior.state IN ('committed','awaiting_approval'))
     ORDER BY s.updated_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;
  status:=run_row.status; error_code:=run_row.error_code;
  run_version:=run_row.run_version; next_sequence:=run_row.next_sequence;
  step_id:=step_row.id; sequence:=step_row.sequence;
  expected_version:=step_row.expected_version; fence:=step_row.fence;
  stream_generation:=run_row.stream_generation;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION ops.lexon_ai_terminal_stream_proof(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_ai_terminal_stream_proof(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- The expiry-sweep access-loss arm: a paused run the sweep cannot see keeps
-- its awaiting_approval op listed forever, so the definer repeats the
-- expire CAS (awaiting_approval + undecided + expires_at past), appends the
-- actor-less decided audit, settles every other outstanding op, fails the
-- run with AI_ACCESS_REVOKED and notifies the bound chats — the paused step
-- stays 'awaiting_approval' as the terminal anchor like the decide arm.
CREATE FUNCTION ops.lexon_ai_expire_access_loss(
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
  -- Deletion owns tombstoned-chat invisibility: the sweep skips these ops
  -- exactly as it did before this definer existed.
  IF run_row.resolved_config->'resourceIds'->>0 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app.chats c
       WHERE c.org_id=input_org_id
         AND c.id::text=run_row.resolved_config->'resourceIds'->>0
         AND c.deleted_at IS NULL) THEN
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
REVOKE ALL ON FUNCTION ops.lexon_ai_expire_access_loss(uuid,uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_ai_expire_access_loss(uuid,uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- §4.4/§5 row 9: the tombstone definer gains the project-access clause — a
-- chat owner who lost project access (deny or member removal) cannot
-- tombstone a chat they can no longer see. Standalone chats are unchanged.
-- The 0026 body revoked EXECUTE from lexon_migrator itself, which makes
-- CREATE OR REPLACE fail the function-level ACL check under PG 17 — drop and
-- recreate instead of replacing.
DROP FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid);
--> statement-breakpoint
CREATE FUNCTION ops.ai_mark_chat_deleted(input_org_id uuid,input_user_id uuid,input_chat_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; locked_chat app.chats%ROWTYPE;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_chat_id IS NULL
    OR context_org IS DISTINCT FROM input_org_id OR context_user IS DISTINCT FROM input_user_id THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:' || context_org::text,0));
  SELECT * INTO locked_chat FROM app.chats
    WHERE org_id=context_org AND id=input_chat_id AND owner_user_id=context_user
      AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF locked_chat.project_id IS NOT NULL
    AND ops.lexon_project_access(context_org,locked_chat.project_id,context_user)='none' THEN
    RETURN false;
  END IF;
  UPDATE app.chats SET deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE org_id=context_org AND id=input_chat_id;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid) FROM PUBLIC,lexon_auth,lexon_migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid) TO lexon_app;
