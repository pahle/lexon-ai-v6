-- F6 batch-2 review: the chat notification audience arm for project chats
-- re-implemented the deny check (raw project_denies NOT EXISTS) and the
-- owner arm ignored denies entirely, so a denied or project-removed chat
-- owner still received that chat's notifications.
--
-- ops.lexon_project_access_for is the service-claims sibling of
-- ops.lexon_project_access — the same level order (org member, deny, owner,
-- member row) evaluated under org-scoped claims, where the claims-bound
-- original is uncallable: its input_user_id = context_user binding fails
-- for every candidate the audience fan-out must evaluate. The audience
-- function now filters every project-chat candidate (project owner and
-- members alike) through the oracle instead of duplicating its rules, and
-- includes the chat owner only for standalone chats whose owner is still
-- an org member.
CREATE FUNCTION ops.lexon_project_access_for(
  input_org_id uuid, input_project_id uuid, input_user_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid; owner_id uuid; member_role text;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  IF context_org IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS NULL OR input_project_id IS NULL THEN RETURN 'none'; END IF;
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
REVOKE ALL ON FUNCTION ops.lexon_project_access_for(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_project_access_for(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- 0045 revoked lexon_migrator's EXECUTE on the audience function, and
-- PostgreSQL 17 requires EXECUTE on the existing function for
-- CREATE OR REPLACE — grant it for the replace, then restore the 0045 acl.
GRANT EXECUTE ON FUNCTION ops.lexon_chat_notification_audience(uuid,uuid) TO lexon_migrator;
CREATE OR REPLACE FUNCTION ops.lexon_chat_notification_audience(
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
    -- The owner arm covers standalone chats only, and only while the owner
    -- is still an org member; project-chat owners reach the audience
    -- through the candidate arm below (deny beats ownership there).
    SELECT c.owner_user_id FROM app.chats c
     WHERE c.org_id=input_org_id AND c.id=input_chat_id AND c.deleted_at IS NULL
       AND c.project_id IS NULL
       AND ops.lexon_org_member(c.org_id,c.owner_user_id)
    UNION
    SELECT s.user_id FROM app.chat_shares s
      JOIN app.chats c ON c.org_id=s.org_id AND c.id=s.chat_id
     WHERE s.org_id=input_org_id AND s.chat_id=input_chat_id
       AND c.project_id IS NULL AND c.deleted_at IS NULL
       AND ops.lexon_org_member(s.org_id,s.user_id)
    UNION
    -- Every project-chat candidate — the project owner and each member —
    -- filtered through the shared access oracle: deny, member removal and
    -- org removal all resolve to 'none' in one place instead of a
    -- re-implemented deny check per arm.
    SELECT candidate.user_id FROM app.chats c
      JOIN app.projects p ON p.org_id=c.org_id AND p.id=c.project_id
      JOIN LATERAL (
        SELECT p.owner_user_id AS user_id
        UNION
        SELECT m.user_id FROM app.project_members m
         WHERE m.org_id=p.org_id AND m.project_id=p.id
      ) candidate ON true
     WHERE c.org_id=input_org_id AND c.id=input_chat_id AND c.deleted_at IS NULL
       AND ops.lexon_project_access_for(c.org_id,c.project_id,candidate.user_id)<>'none';
END $$;
REVOKE ALL ON FUNCTION ops.lexon_chat_notification_audience(uuid,uuid) FROM PUBLIC,lexon_auth,lexon_migrator;
