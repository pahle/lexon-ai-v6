ALTER TABLE app.chat_create_requests
  DROP CONSTRAINT chat_create_requests_org_id_chat_id_fkey,
  DROP CONSTRAINT chat_create_requests_org_id_chat_id_user_message_id_fkey,
  DROP CONSTRAINT chat_create_requests_org_id_chat_id_assistant_message_id_fkey;
--> statement-breakpoint
CREATE TABLE app.chat_deleted_ids (
  org_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('chat','message')),
  entity_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,owner_user_id,entity_kind,entity_id)
);
ALTER TABLE app.chat_deleted_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_deleted_ids FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_deleted_ids_owner ON app.chat_deleted_ids
  FOR ALL TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY chat_deleted_ids_internal ON app.chat_deleted_ids
  FOR ALL TO lexon_migrator USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON app.chat_deleted_ids TO lexon_app;
REVOKE UPDATE,DELETE,TRUNCATE ON app.chat_deleted_ids FROM lexon_app,lexon_auth,PUBLIC;
--> statement-breakpoint
CREATE TABLE app.ai_step_permit_references (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  run_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  expected_version integer NOT NULL CHECK (expected_version > 0),
  step_id uuid NOT NULL,
  fence bigint NOT NULL CHECK (fence > 0),
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 1),
  owner_token uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,run_id,sequence)
);
ALTER TABLE app.ai_step_permit_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_step_permit_references FORCE ROW LEVEL SECURITY;
CREATE POLICY step_permit_reference_owner ON app.ai_step_permit_references
  FOR ALL TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY step_permit_reference_internal ON app.ai_step_permit_references
  FOR ALL TO lexon_migrator USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,DELETE ON app.ai_step_permit_references TO lexon_app;
REVOKE UPDATE,TRUNCATE ON app.ai_step_permit_references FROM lexon_app,lexon_auth,PUBLIC;
--> statement-breakpoint
CREATE TABLE app.chat_deletion_work (
  org_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('grace','purge_db','purge_valkey','complete')),
  run_ids uuid[] NOT NULL DEFAULT '{}',
  permit_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permit_refs)='array'),
  late_attempt_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(late_attempt_refs)='array'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  grace_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (org_id,chat_id)
);
ALTER TABLE app.chat_deletion_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_deletion_work FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_deletion_work_owner ON app.chat_deletion_work
  FOR ALL TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY chat_deletion_work_internal ON app.chat_deletion_work
  FOR ALL TO lexon_migrator USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON app.chat_deletion_work TO lexon_app;
REVOKE DELETE,TRUNCATE ON app.chat_deletion_work FROM lexon_app,lexon_auth,PUBLIC;
--> statement-breakpoint
CREATE POLICY chat_usage_event_internal ON app.usage_events
  FOR ALL TO lexon_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION ops.ai_chat_was_deleted(input_org_id uuid,input_user_id uuid,input_chat_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE context_org uuid; context_user uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user OR input_chat_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM app.chats c WHERE c.org_id=input_org_id AND c.id=input_chat_id
      AND c.owner_user_id=input_user_id AND c.deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM app.chat_deleted_ids d WHERE d.org_id=input_org_id
      AND d.owner_user_id=input_user_id AND d.entity_kind='chat' AND d.entity_id=input_chat_id);
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_was_deleted(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_was_deleted(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.ai_chat_begin_delete_cancel(input_org_id uuid,input_user_id uuid,input_chat_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user OR input_chat_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:' || input_org_id::text,0));
  IF NOT EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=input_org_id AND c.id=input_chat_id
      AND c.owner_user_id=input_user_id AND c.deleted_at IS NOT NULL) THEN RETURN; END IF;
  UPDATE app.ai_runs r SET status='cancelling',run_version=run_version+1,
    updated_at=clock_timestamp()
   WHERE r.org_id=input_org_id AND r.initiating_user_id=input_user_id
     AND r.status IN ('queued','running','awaiting_approval')
     AND EXISTS (SELECT 1 FROM app.chat_runs cr WHERE cr.org_id=input_org_id
       AND cr.chat_id=input_chat_id AND cr.run_id=r.id AND cr.kind='answer');
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_begin_delete_cancel(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_begin_delete_cancel(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.ai_chat_deleted_run_facts(
  input_org_id uuid,input_user_id uuid,input_run_id uuid,input_expected_version integer,
  input_sequence integer,input_step_id uuid,input_fence bigint
) RETURNS TABLE(active_attempt_ids uuid[],purged boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; work_row app.chat_deletion_work%ROWTYPE;
BEGIN
  active_attempt_ids:='{}'::uuid[]; purged:=false;
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user OR input_run_id IS NULL
    OR input_step_id IS NULL OR input_expected_version<1 OR input_sequence<1 OR input_fence<1 THEN
    RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO work_row FROM app.chat_deletion_work
   WHERE org_id=input_org_id AND owner_user_id=input_user_id
     AND input_run_id=ANY(run_ids) AND phase IN ('purge_valkey','complete') LIMIT 1;
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;
  purged:=true;
  SELECT COALESCE(array_agg((reference->>'attemptId')::uuid ORDER BY reference->>'attemptId'),'{}'::uuid[])
    INTO active_attempt_ids
    FROM jsonb_array_elements(work_row.late_attempt_refs) reference
   WHERE reference->>'runId'=input_run_id::text
     AND reference->>'stepId'=input_step_id::text
     AND reference->>'sequence'=input_sequence::text
     AND reference->>'expectedVersion'=input_expected_version::text
     AND reference->>'fence'=input_fence::text;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_deleted_run_facts(uuid,uuid,uuid,integer,integer,uuid,bigint) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_deleted_run_facts(uuid,uuid,uuid,integer,integer,uuid,bigint) TO lexon_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.ai_chat_deleted_cancel_facts(
  input_org_id uuid,input_user_id uuid,input_run_id uuid,input_expected_version integer,
  input_sequence integer,input_step_id uuid,input_fence bigint
) RETURNS TABLE(run_status text,run_version integer,next_sequence integer,lease_until timestamptz,active_attempt_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; chat_id uuid; resource_ids jsonb;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT cr.chat_id INTO chat_id FROM app.chat_runs cr JOIN app.chats c
    ON c.org_id=cr.org_id AND c.id=cr.chat_id
   WHERE cr.org_id=input_org_id AND cr.run_id=input_run_id
     AND c.owner_user_id=input_user_id AND c.deleted_at IS NOT NULL FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT r.status,r.run_version,r.next_sequence,r.resolved_config->'resourceIds'
    INTO run_status,run_version,next_sequence,resource_ids FROM app.ai_runs r
   WHERE r.org_id=input_org_id AND r.id=input_run_id
     AND ((r.status='cancelling' AND r.run_version=input_expected_version+1)
       OR (r.status='cancelled' AND r.run_version=input_expected_version+2))
     AND r.next_sequence=input_sequence FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(resource_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(resource_ids)<>1 OR resource_ids->>0 IS DISTINCT FROM chat_id::text THEN RETURN; END IF;
  SELECT s.lease_until INTO lease_until FROM app.ai_steps s
   WHERE s.org_id=input_org_id AND s.run_id=input_run_id AND s.id=input_step_id
     AND s.sequence=input_sequence AND s.expected_version=input_expected_version
     AND s.fence=input_fence AND s.state='claimed' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(array_agg(a.id ORDER BY a.id),'{}'::uuid[]) INTO active_attempt_ids
    FROM app.ai_attempts a WHERE a.org_id=input_org_id AND a.run_id=input_run_id
      AND a.step_id=input_step_id AND a.fence=input_fence AND a.active;
  RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.ai_chat_finalize_deleted_cancel(
  input_org_id uuid,input_user_id uuid,input_run_id uuid,input_expected_version integer,
  input_sequence integer,input_step_id uuid,input_fence bigint
) RETURNS TABLE(changed boolean,active_attempt_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; facts record;
BEGIN
  changed:=false; active_attempt_ids:='{}'::uuid[];
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user THEN RETURN NEXT; RETURN; END IF;
  SELECT * INTO facts FROM ops.ai_chat_deleted_cancel_facts(input_org_id,input_user_id,input_run_id,
    input_expected_version,input_sequence,input_step_id,input_fence);
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;
  active_attempt_ids:=facts.active_attempt_ids;
  UPDATE app.ai_steps SET state='failed',updated_at=clock_timestamp()
   WHERE org_id=input_org_id AND run_id=input_run_id AND id=input_step_id
     AND sequence=input_sequence AND expected_version=input_expected_version
     AND fence=input_fence AND state='claimed';
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;
  UPDATE app.ai_attempts SET active=false,outcome='unknown',settled_at=clock_timestamp()
   WHERE org_id=input_org_id AND run_id=input_run_id AND step_id=input_step_id
     AND fence=input_fence AND active;
  IF facts.run_status='cancelling' THEN
    UPDATE app.ai_runs SET status='cancelled',run_version=run_version+1,
      next_sequence=next_sequence+1,error_code=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE org_id=input_org_id AND id=input_run_id
       AND status='cancelling' AND run_version=input_expected_version+1
       AND next_sequence=input_sequence;
    IF NOT FOUND THEN RAISE EXCEPTION 'Deleted chat cancellation state changed' USING ERRCODE='40001'; END IF;
  END IF;
  UPDATE app.usage_events SET outcome='unknown',settled_at=COALESCE(settled_at,clock_timestamp())
   WHERE attempt_id=ANY(active_attempt_ids) AND outcome='reserved';
  changed:=true; RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint) FROM PUBLIC,lexon_auth;
REVOKE ALL ON FUNCTION ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint) TO lexon_app;
GRANT EXECUTE ON FUNCTION ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.ai_chat_terminalize_deleted_runs(input_org_id uuid,input_user_id uuid,input_chat_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; owner_id uuid; work_phase text; run_row record; step_row record; final record; expected integer;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user OR input_chat_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT c.owner_user_id INTO owner_id FROM app.chats c
   WHERE c.org_id=input_org_id AND c.id=input_chat_id AND c.deleted_at IS NOT NULL FOR UPDATE;
  SELECT d.phase INTO work_phase FROM app.chat_deletion_work d
   WHERE d.org_id=input_org_id AND d.owner_user_id=input_user_id AND d.chat_id=input_chat_id FOR UPDATE;
  IF owner_id IS DISTINCT FROM input_user_id OR work_phase IS DISTINCT FROM 'purge_db' THEN RETURN false; END IF;
  UPDATE app.chat_deletion_work d SET late_attempt_refs=COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'attemptId',a.id,'runId',a.run_id,'stepId',a.step_id,'sequence',s.sequence,
      'expectedVersion',s.expected_version,'fence',a.fence) ORDER BY a.id)
    FROM app.ai_attempts a JOIN app.ai_steps s
      ON s.org_id=a.org_id AND s.run_id=a.run_id AND s.id=a.step_id
    JOIN app.chat_runs cr ON cr.org_id=a.org_id AND cr.run_id=a.run_id
    WHERE cr.org_id=input_org_id AND cr.chat_id=input_chat_id AND a.active
      AND s.state='claimed'), d.late_attempt_refs, '[]'::jsonb)
   WHERE d.org_id=input_org_id AND d.owner_user_id=input_user_id
     AND d.chat_id=input_chat_id AND d.phase='purge_db';
  FOR run_row IN
    SELECT r.id,r.status,r.run_version,r.next_sequence FROM app.ai_runs r
    JOIN app.chat_runs cr ON cr.org_id=r.org_id AND cr.run_id=r.id
    WHERE cr.org_id=input_org_id AND cr.chat_id=input_chat_id
      AND r.status IN ('queued','running','awaiting_approval','cancelling')
    ORDER BY r.id FOR UPDATE OF r
  LOOP
    expected:=run_row.run_version;
    IF run_row.status<>'cancelling' THEN
      UPDATE app.ai_runs SET status='cancelling',run_version=run_version+1,updated_at=clock_timestamp()
       WHERE org_id=input_org_id AND id=run_row.id AND status=run_row.status AND run_version=expected;
      IF NOT FOUND THEN RETURN false; END IF;
      expected:=expected+1;
    END IF;
    SELECT s.id,s.sequence,s.expected_version,s.fence INTO step_row
      FROM app.ai_steps s WHERE s.org_id=input_org_id AND s.run_id=run_row.id
        AND s.sequence=run_row.next_sequence AND s.state='claimed' FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO final FROM ops.ai_chat_finalize_deleted_cancel(input_org_id,input_user_id,
        run_row.id,step_row.expected_version,step_row.sequence,step_row.id,step_row.fence);
      IF NOT COALESCE(final.changed,false) THEN RETURN false; END IF;
    ELSE
      UPDATE app.ai_runs SET status='cancelled',run_version=run_version+1,
        error_code=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp()
       WHERE org_id=input_org_id AND id=run_row.id AND status='cancelling' AND run_version=expected;
      IF NOT FOUND THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN NOT EXISTS(SELECT 1 FROM app.ai_runs r JOIN app.chat_runs cr
    ON cr.org_id=r.org_id AND cr.run_id=r.id
    WHERE cr.org_id=input_org_id AND cr.chat_id=input_chat_id
      AND r.status IN ('queued','running','awaiting_approval','cancelling'));
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_terminalize_deleted_runs(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_terminalize_deleted_runs(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.ai_purge_deleted_chat(input_org_id uuid,input_user_id uuid,input_chat_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; related_runs uuid[]; owner_id uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user OR input_chat_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:'||input_org_id::text,0));
  SELECT owner_user_id INTO owner_id FROM app.chats
   WHERE org_id=input_org_id AND id=input_chat_id AND deleted_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR owner_id IS DISTINCT FROM input_user_id THEN RETURN false; END IF;
  SELECT COALESCE(array_agg(run_id ORDER BY run_id),'{}'::uuid[]) INTO related_runs
   FROM app.chat_runs WHERE org_id=input_org_id AND chat_id=input_chat_id;

  IF EXISTS(SELECT 1 FROM app.ai_runs r WHERE r.org_id=input_org_id
    AND r.id=ANY(related_runs) AND r.status IN ('queued','running','awaiting_approval','cancelling')) THEN
    RETURN false;
  END IF;

  UPDATE app.chat_deletion_work d SET late_attempt_refs=CASE
    WHEN d.late_attempt_refs<>'[]'::jsonb THEN d.late_attempt_refs
    ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'attemptId',a.id,'runId',a.run_id,'stepId',a.step_id,'sequence',s.sequence,
      'expectedVersion',s.expected_version,'fence',a.fence) ORDER BY a.id)
    FROM app.ai_attempts a JOIN app.ai_steps s
      ON s.org_id=a.org_id AND s.run_id=a.run_id AND s.id=a.step_id
    WHERE a.org_id=input_org_id AND a.run_id=ANY(related_runs) AND a.active
      AND s.state='claimed'), '[]'::jsonb) END
   WHERE d.org_id=input_org_id AND d.owner_user_id=input_user_id
     AND d.chat_id=input_chat_id AND d.phase='purge_db';

  INSERT INTO app.usage_events
    (attempt_id,org_id,actor_user_id,run_id,step_id,model_id,requested_provider,
     observed_provider,profile_id,resolved_effort,estimated_input_tokens,
     reserved_input_tokens,reserved_output_tokens,estimator_version,instruction_version,
     reported_input_tokens,reported_output_tokens,cached_input_tokens,
     reasoning_output_tokens,cost_usd,generation_id,outcome,created_at,settled_at)
  SELECT a.id,a.org_id,r.initiating_user_id,a.run_id,a.step_id,a.model_id,
    COALESCE(a.provider,r.resolved_config->>'provider','openrouter'),a.provider,r.profile_id,
    COALESCE(r.resolved_config->>'resolvedEffort',r.resolved_config#>>'{profileSnapshot,reasoning,default}'),
    a.estimated_input_tokens,a.reserved_input_tokens,a.reserved_output_tokens,
    a.estimator_version,r.resolved_config->>'instructionVersion',a.reported_input_tokens,
    a.reported_output_tokens,a.cached_input_tokens,a.reasoning_output_tokens,a.cost_usd,
    a.generation_id,COALESCE(a.outcome,'unknown'),a.created_at,
    COALESCE(a.settled_at,clock_timestamp())
  FROM app.ai_attempts a JOIN app.ai_runs r ON r.org_id=a.org_id AND r.id=a.run_id
  WHERE a.org_id=input_org_id AND a.run_id=ANY(related_runs)
  ON CONFLICT (attempt_id) DO UPDATE SET
    outcome=CASE WHEN app.usage_events.outcome='reserved' THEN EXCLUDED.outcome ELSE app.usage_events.outcome END,
    settled_at=COALESCE(app.usage_events.settled_at,EXCLUDED.settled_at),
    reported_input_tokens=COALESCE(app.usage_events.reported_input_tokens,EXCLUDED.reported_input_tokens),
    reported_output_tokens=COALESCE(app.usage_events.reported_output_tokens,EXCLUDED.reported_output_tokens),
    cached_input_tokens=COALESCE(app.usage_events.cached_input_tokens,EXCLUDED.cached_input_tokens),
    reasoning_output_tokens=COALESCE(app.usage_events.reasoning_output_tokens,EXCLUDED.reasoning_output_tokens),
    cost_usd=COALESCE(app.usage_events.cost_usd,EXCLUDED.cost_usd),
    generation_id=COALESCE(app.usage_events.generation_id,EXCLUDED.generation_id);

  INSERT INTO app.chat_deleted_ids(org_id,owner_user_id,entity_kind,entity_id,chat_id)
  SELECT input_org_id,input_user_id,'chat',input_chat_id,input_chat_id
  UNION ALL
  SELECT m.org_id,input_user_id,'message',m.id,input_chat_id
    FROM app.chat_messages m WHERE m.org_id=input_org_id AND m.chat_id=input_chat_id
  ON CONFLICT DO NOTHING;
  DELETE FROM app.ai_runs WHERE org_id=input_org_id AND id=ANY(related_runs);
  DELETE FROM app.ai_step_permit_references WHERE org_id=input_org_id AND run_id=ANY(related_runs);
  DELETE FROM app.chats WHERE org_id=input_org_id AND id=input_chat_id
    AND owner_user_id=input_user_id AND deleted_at IS NOT NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION ops.ai_purge_deleted_chat(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_purge_deleted_chat(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.lexon_validate_chat_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE metadata jsonb := event->'metadata'; field text; event_type text := event->>'type';
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR NOT (event ?& ARRAY['version','eventId','occurredAt','type','outcome','orgId','actorUserId','metadata'])
    OR event->'version' IS DISTINCT FROM '1'::jsonb
    OR event_type NOT IN ('chat.created.v1','chat.message_sent.v1','chat.deletion_requested.v1','chat.deletion_completed.v1')
    OR event->>'outcome' IS DISTINCT FROM 'success'
    OR NOT COALESCE(event->>'orgId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    OR NOT COALESCE(event->>'actorUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR NOT COALESCE(metadata->>'chatId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    OR (event_type='chat.message_sent.v1' AND NOT COALESCE(metadata->>'messageId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false))
    OR (event_type IN ('chat.created.v1','chat.deletion_requested.v1','chat.deletion_completed.v1') AND metadata ? 'messageId') THEN
    RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(event) LOOP
    IF NOT (field = ANY(ARRAY['version','eventId','type','occurredAt','outcome','actorUserId','orgId','metadata'])) THEN
      RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR field IN SELECT jsonb_object_keys(metadata) LOOP
    IF NOT (field = ANY(CASE WHEN event_type='chat.message_sent.v1' THEN ARRAY['chatId','messageId'] ELSE ARRAY['chatId'] END)) THEN
      RAISE EXCEPTION 'Invalid chat audit metadata' USING ERRCODE = '23514';
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.lexon_validate_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE event jsonb;
BEGIN
  event := jsonb_strip_nulls(jsonb_build_object(
    'version',NEW.version,'eventId',NEW.event_id,'type',NEW.type,
    'occurredAt',to_char(NEW.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'outcome',NEW.outcome,'actorUserId',NEW.actor_user_id,'subjectUserId',NEW.subject_user_id,
    'sessionId',NEW.session_id,'orgId',NEW.org_id,'invitationId',NEW.invitation_id,
    'memberId',NEW.member_id,'requestId',NEW.request_id)) || jsonb_build_object('metadata',NEW.metadata);
  IF NEW.type IN ('chat.created.v1','chat.message_sent.v1','chat.deletion_requested.v1','chat.deletion_completed.v1') THEN
    PERFORM auth.lexon_validate_chat_audit(event);
  ELSIF NEW.type LIKE 'chat.%' THEN
    PERFORM auth.lexon_validate_ai_audit(event);
  ELSE
    PERFORM auth.lexon_validate_audit(event);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_validate_audit_row() FROM PUBLIC;
