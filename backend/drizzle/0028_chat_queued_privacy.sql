CREATE FUNCTION ops.ai_chat_run_is_associated(
  input_org_id uuid,input_user_id uuid,input_run_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; associated boolean;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  -- Fail closed when arguments are not bound to the active tenant actor.
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user THEN RETURN true; END IF;
  SELECT EXISTS (
    SELECT 1 FROM app.chat_runs cr
    JOIN app.chats c ON c.org_id=cr.org_id AND c.id=cr.chat_id
    WHERE cr.org_id=input_org_id AND cr.run_id=input_run_id
  ) INTO associated;
  RETURN associated;
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_run_is_associated(uuid,uuid,uuid)
  FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.ai_chat_run_is_associated(uuid,uuid,uuid)
  TO lexon_app;

DROP POLICY ai_runs_owner_live_resource ON app.ai_runs;
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
          THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')<=32 ELSE false END
        AND NOT ops.ai_chat_run_is_associated(ai_runs.org_id,
          NULLIF(current_setting('app.user_id',true),'')::uuid,ai_runs.id))
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
        AND CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
          THEN jsonb_array_length(resolved_config->'resourceIds')<=32 ELSE false END
        AND NOT ops.ai_chat_run_is_associated(ai_runs.org_id,
          NULLIF(current_setting('app.user_id',true),'')::uuid,ai_runs.id))
    );
