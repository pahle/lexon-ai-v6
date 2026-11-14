REVOKE DELETE, TRUNCATE ON app.chats, app.chat_runs, app.chat_messages
  FROM lexon_app, lexon_auth, PUBLIC;

DROP POLICY owner_chat_run ON app.chat_runs;
CREATE POLICY owner_chat_run_select ON app.chat_runs FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_runs.org_id
      AND c.id=chat_runs.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid));
CREATE POLICY owner_chat_run_insert ON app.chat_runs FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_runs.org_id
      AND c.id=chat_runs.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL));

CREATE POLICY ai_runs_owner_live_resource ON app.ai_runs AS RESTRICTIVE
  FOR ALL TO lexon_app
  USING (
      (CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
        THEN jsonb_array_length(resolved_config->'resourceIds')=0
        WHEN resolved_config->'resourceIds' IS NULL THEN true ELSE false END)
      OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND EXISTS (
        SELECT 1 FROM app.chat_runs cr JOIN app.chats c
          ON c.org_id=cr.org_id AND c.id=cr.chat_id
        WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id
          AND cr.chat_id::text=ai_runs.resolved_config->'resourceIds'->>0
          AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
            THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END
          AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
          AND c.deleted_at IS NULL))
      OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND status='queued'
        AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
          THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END
        AND NOT EXISTS (SELECT 1 FROM app.chat_runs cr
          WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id))
    )
  WITH CHECK (
      (CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
        THEN jsonb_array_length(resolved_config->'resourceIds')=0
        WHEN resolved_config->'resourceIds' IS NULL THEN true ELSE false END)
      OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND EXISTS (
        SELECT 1 FROM app.chat_runs cr JOIN app.chats c
          ON c.org_id=cr.org_id AND c.id=cr.chat_id
        WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id
          AND cr.chat_id::text=ai_runs.resolved_config->'resourceIds'->>0
          AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
            THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END
          AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
          AND c.deleted_at IS NULL))
      OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND status='queued'
        AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
          THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END
        AND NOT EXISTS (SELECT 1 FROM app.chat_runs cr
          WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id))
    );

CREATE POLICY ai_steps_owner_run ON app.ai_steps AS RESTRICTIVE
  FOR ALL TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_checkpoints_owner_run ON app.ai_checkpoints AS RESTRICTIVE
  FOR ALL TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_operations_owner_run ON app.ai_operations AS RESTRICTIVE
  FOR ALL TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));

-- The SECURITY DEFINER lifecycle pair is owned by lexon_migrator. Keep its
-- forced-RLS visibility limited to that non-runtime role; callers still pass
-- through the explicit org/user/owner/resource/expected-state checks below.
CREATE POLICY ai_steps_chat_lifecycle_read ON app.ai_steps FOR SELECT TO lexon_migrator
  USING (true);
CREATE POLICY ai_steps_chat_lifecycle_write ON app.ai_steps FOR UPDATE TO lexon_migrator
  USING (true) WITH CHECK (true);
CREATE POLICY ai_attempts_chat_lifecycle_read ON app.ai_attempts FOR SELECT TO lexon_migrator
  USING (true);
CREATE POLICY ai_attempts_chat_lifecycle_write ON app.ai_attempts FOR UPDATE TO lexon_migrator
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION ops.ai_chat_run_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE chat_owner uuid; run_owner uuid; run_status text; current_active uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Chat run association is immutable' USING ERRCODE='23514', CONSTRAINT='chat_run_link_immutable';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Chat run association is immutable' USING ERRCODE='23514', CONSTRAINT='chat_run_link_immutable';
  END IF;
  SELECT owner_user_id,active_answer_run_id INTO chat_owner,current_active
    FROM app.chats WHERE org_id=NEW.org_id AND id=NEW.chat_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat unavailable' USING ERRCODE='23514', CONSTRAINT='chat_run_chat_live';
  END IF;
  SELECT initiating_user_id,status INTO run_owner,run_status FROM app.ai_runs
    WHERE org_id=NEW.org_id AND id=NEW.run_id;
  IF NOT FOUND OR run_owner IS DISTINCT FROM chat_owner THEN
    RAISE EXCEPTION 'Chat run owner mismatch' USING ERRCODE='23514', CONSTRAINT='chat_run_owner';
  END IF;
  IF NEW.kind='answer' AND run_status IN ('queued','running','awaiting_approval','cancelling') THEN
    IF current_active IS NOT NULL THEN
      RAISE EXCEPTION 'Chat already has an active answer' USING ERRCODE='23505', CONSTRAINT='chat_one_active_answer';
    END IF;
    UPDATE app.chats SET active_answer_run_id=NEW.run_id
      WHERE org_id=NEW.org_id AND id=NEW.chat_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER chat_run_link_guard ON app.chat_runs;
CREATE TRIGGER chat_run_link_guard BEFORE INSERT OR UPDATE OR DELETE ON app.chat_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_run_link_guard();

CREATE OR REPLACE FUNCTION ops.ai_chat_resource_write_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  resource_run uuid; resource_org uuid; chat_id uuid; chat_live boolean;
  context_user uuid; run_owner uuid; run_status text; resource_ids jsonb; chat_owner uuid;
BEGIN
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF TG_TABLE_NAME='ai_runs' THEN
    IF TG_OP='DELETE' THEN resource_run:=OLD.id; resource_org:=OLD.org_id;
    ELSE resource_run:=NEW.id; resource_org:=NEW.org_id; END IF;
    run_owner:=NEW.initiating_user_id;
    resource_ids:=COALESCE(NEW.resolved_config->'resourceIds','[]'::jsonb);
    run_status:=NEW.status;
  ELSIF TG_OP='DELETE' THEN
    resource_run:=OLD.run_id; resource_org:=OLD.org_id;
  ELSE
    resource_run:=NEW.run_id; resource_org:=NEW.org_id;
  END IF;
  IF TG_TABLE_NAME<>'ai_runs' THEN
    SELECT initiating_user_id,COALESCE(resolved_config->'resourceIds','[]'::jsonb)
      INTO run_owner,resource_ids FROM app.ai_runs
      WHERE org_id=resource_org AND id=resource_run;
  END IF;
  SELECT cr.chat_id INTO chat_id FROM app.chat_runs cr
    WHERE cr.org_id=resource_org AND cr.run_id=resource_run;
  IF NOT FOUND THEN
    IF (CASE WHEN jsonb_typeof(resource_ids)='array'
      THEN jsonb_array_length(resource_ids)=0 ELSE false END) THEN
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    IF TG_TABLE_NAME='ai_runs' AND TG_OP='UPDATE' AND run_owner=context_user
      AND run_status='queued'
      AND (CASE WHEN jsonb_typeof(resource_ids)='array'
        THEN jsonb_array_length(resource_ids)=1 ELSE false END) THEN
      SELECT owner_user_id,(deleted_at IS NULL) INTO chat_owner,chat_live
        FROM app.chats WHERE org_id=resource_org AND id::text=resource_ids->>0 FOR UPDATE;
      IF chat_owner=context_user AND chat_live IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF TG_TABLE_NAME='ai_steps' THEN
      IF TG_OP='INSERT' AND NEW.state='pending'
        AND NEW.sequence=1 AND run_owner=context_user THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Chat resource binding unavailable' USING ERRCODE='23514', CONSTRAINT='chat_resource_binding';
  END IF;
  SELECT owner_user_id,(deleted_at IS NULL) INTO chat_owner,chat_live
    FROM app.chats WHERE org_id=resource_org AND id=chat_id FOR UPDATE;
  IF chat_owner IS DISTINCT FROM context_user OR run_owner IS DISTINCT FROM context_user
    OR jsonb_typeof(resource_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(resource_ids)<>1
    OR resource_ids->>0 IS DISTINCT FROM chat_id::text THEN
    RAISE EXCEPTION 'Chat resource owner or binding mismatch' USING ERRCODE='23514', CONSTRAINT='chat_resource_binding';
  END IF;
  IF chat_live IS DISTINCT FROM true THEN
    IF TG_TABLE_NAME='ai_steps' THEN
      IF TG_OP='UPDATE' AND NEW.state='failed'
        AND NEW.committed_text IS NOT DISTINCT FROM OLD.committed_text
        AND NEW.commit_data IS NOT DISTINCT FROM OLD.commit_data THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Chat content write fenced' USING ERRCODE='23514', CONSTRAINT='chat_content_write_fenced';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE FUNCTION ops.ai_chat_deleted_cancel_facts(
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
   WHERE r.org_id=input_org_id AND r.id=input_run_id AND r.initiating_user_id=input_user_id
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

CREATE FUNCTION ops.ai_chat_finalize_deleted_cancel(
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
     WHERE org_id=input_org_id AND id=input_run_id AND initiating_user_id=input_user_id
       AND status='cancelling' AND run_version=input_expected_version+1
       AND next_sequence=input_sequence;
    IF NOT FOUND THEN RAISE EXCEPTION 'Deleted chat cancellation state changed' USING ERRCODE='40001'; END IF;
  END IF;
  changed:=true; RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint) FROM PUBLIC,lexon_auth;
REVOKE ALL ON FUNCTION ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint) TO lexon_app;
GRANT EXECUTE ON FUNCTION ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint) TO lexon_app;
