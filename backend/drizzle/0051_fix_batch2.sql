-- F6 fix-batch2 review: ops.lexon_project_access_for was an unbound
-- oracle — any lexon_app caller holding org claims could resolve any
-- user's level on any project, bypassing the input_user_id = context_user
-- binding that lexon_project_access enforces. The level rule now lives
-- once in ops.lexon_project_access_level, an internal evaluator with no
-- lexon_app grant; lexon_project_access (claims-bound) and
-- lexon_project_access_for (service claims — the audience fan-out runs
-- under org-scoped claims where app.user_id is empty by design) are thin
-- claim-gate wrappers over it.
CREATE FUNCTION ops.lexon_project_access_level(
  input_org_id uuid, input_project_id uuid, input_user_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,ops,pg_temp AS $$
DECLARE owner_id uuid; member_role text;
BEGIN
  IF input_org_id IS NULL OR input_user_id IS NULL
    OR input_project_id IS NULL THEN RETURN 'none'; END IF;
  IF NOT ops.lexon_org_member(input_org_id,input_user_id) THEN RETURN 'none'; END IF;
  IF ops.lexon_project_denied(input_org_id,input_project_id,input_user_id)
    THEN RETURN 'none'; END IF;
  SELECT p.owner_user_id INTO owner_id FROM app.projects p
    WHERE p.org_id=input_org_id AND p.id=input_project_id;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF owner_id=input_user_id THEN RETURN 'owner'; END IF;
  SELECT m.role INTO member_role FROM app.project_members m
    WHERE m.org_id=input_org_id AND m.project_id=input_project_id
      AND m.user_id=input_user_id;
  RETURN COALESCE(member_role,'none');
END $$;
-- Internal evaluator: callers reach it only through the wrappers' definer
-- rights — lexon_app gets no grant of its own.
REVOKE ALL ON FUNCTION ops.lexon_project_access_level(uuid,uuid,uuid)
  FROM PUBLIC,lexon_auth,lexon_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.lexon_project_access(
  input_org_id uuid, input_project_id uuid, input_user_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
    OR input_project_id IS NULL THEN RETURN 'none'; END IF;
  RETURN ops.lexon_project_access_level(
    input_org_id,input_project_id,input_user_id);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.lexon_project_access_for(
  input_org_id uuid, input_project_id uuid, input_user_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,ops,pg_temp AS $$
DECLARE context_org uuid; context_user uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  -- Service claims only: the oracle resolves other users' levels, so a
  -- user-bound caller gets 'none' rather than an authority upgrade.
  IF context_org IS NULL OR context_user IS NOT NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS NULL OR input_project_id IS NULL THEN RETURN 'none'; END IF;
  RETURN ops.lexon_project_access_level(
    input_org_id,input_project_id,input_user_id);
END $$;
--> statement-breakpoint
-- F6 fix-batch2 review: deny_add upserted (ON CONFLICT DO UPDATE) so
-- denied always reported true and the service appended deny_added.v1 on
-- every repeat. INSERT ... DO NOTHING makes the repeat a reported no-op:
-- denied=false, and the member-delete + access-change notify run only
-- when the row actually went in.
CREATE OR REPLACE FUNCTION ops.lexon_project_deny_add(
  input_org_id uuid, input_project_id uuid,
  input_actor uuid, input_target uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; owner_id uuid;
  inserted_count integer; removed_count integer;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_actor IS DISTINCT FROM context_user
    OR input_project_id IS NULL OR input_target IS NULL THEN
    RAISE EXCEPTION 'Project deny unavailable' USING ERRCODE='42501';
  END IF;
  SELECT p.owner_user_id INTO owner_id FROM app.projects p
    WHERE p.org_id=input_org_id AND p.id=input_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project deny unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT ops.lexon_org_owner_admin(input_org_id,input_actor) THEN
    RAISE EXCEPTION 'Project deny requires an organization owner or admin'
      USING ERRCODE='42501';
  END IF;
  IF input_target=owner_id THEN
    RAISE EXCEPTION 'The project owner cannot be denied'
      USING ERRCODE='42501', CONSTRAINT='project_owner_deny';
  END IF;
  INSERT INTO app.project_denies(org_id,project_id,user_id,set_by_user_id)
    VALUES(input_org_id,input_project_id,input_target,input_actor)
    ON CONFLICT (org_id,project_id,user_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 0 THEN
    RETURN jsonb_build_object('denied',false,'removedMember',false);
  END IF;
  DELETE FROM app.project_members
    WHERE org_id=input_org_id AND project_id=input_project_id
      AND user_id=input_target;
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  PERFORM pg_notify('lexon_chat_title',
    jsonb_build_object('orgId',input_org_id,'chatId',NULL,'userIds',
      jsonb_build_array(input_target))::text);
  RETURN jsonb_build_object('denied',true,'removedMember',removed_count>0);
END $$;
