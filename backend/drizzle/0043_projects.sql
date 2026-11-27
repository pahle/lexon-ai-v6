-- F6 — projects ("Matters"), the ethical wall and the shared chat access
-- predicate. All five new tables live in `app` with ENABLE + FORCE RLS, a
-- lexon_migrator internal bypass policy and explicit lexon_app grants. No
-- policy reads project_denies, project_members, projects or auth.member
-- directly — every project/membership question goes through the §4.2
-- SECURITY DEFINER family, which is what keeps the policy DAG acyclic.
CREATE TABLE app.projects (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  matter_number text CHECK (matter_number IS NULL OR char_length(matter_number) <= 64),
  practice_area text CHECK (practice_area IS NULL OR char_length(practice_area) <= 120),
  member_count integer NOT NULL DEFAULT 0,
  chat_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX projects_org_id_id ON app.projects(org_id,id);
CREATE INDEX projects_org_activity ON app.projects(org_id,last_activity_at,id);
CREATE INDEX projects_org_name ON app.projects(org_id,name,id);
CREATE INDEX projects_name_trgm ON app.projects USING gin (name gin_trgm_ops);
CREATE INDEX projects_matter_number_trgm ON app.projects USING gin (matter_number gin_trgm_ops);
ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE app.project_members (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer','editor')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,project_id,user_id),
  CONSTRAINT project_members_project_fk FOREIGN KEY (org_id,project_id)
    REFERENCES app.projects(org_id,id) ON DELETE CASCADE
);
CREATE INDEX project_members_user ON app.project_members(org_id,user_id);
ALTER TABLE app.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE app.project_denies (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  set_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,project_id,user_id),
  CONSTRAINT project_denies_project_fk FOREIGN KEY (org_id,project_id)
    REFERENCES app.projects(org_id,id) ON DELETE CASCADE
);
ALTER TABLE app.project_denies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_denies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Instructions live in their own table because RLS cannot restrict columns:
-- an org owner/admin reads projects rows for the metadata list and must
-- never reach the instruction text.
CREATE TABLE app.project_instructions (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  "text" text NOT NULL CHECK (char_length("text") <= 8000),
  updated_by_user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,project_id),
  CONSTRAINT project_instructions_project_fk FOREIGN KEY (org_id,project_id)
    REFERENCES app.projects(org_id,id) ON DELETE CASCADE
);
ALTER TABLE app.project_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_instructions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE app.chat_shares (
  org_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,chat_id,user_id),
  CONSTRAINT chat_shares_chat_fk FOREIGN KEY (org_id,chat_id)
    REFERENCES app.chats(org_id,id) ON DELETE CASCADE
);
CREATE INDEX chat_shares_user ON app.chat_shares(org_id,user_id,created_at,chat_id);
ALTER TABLE app.chat_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_shares FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The chat/project binding is a nullable column set once at creation. The
-- composite FK uses the PG15+ column-list form so project deletion nulls
-- project_id but leaves org_id (NOT NULL) intact; tombstoned chats then
-- decay to standalone rows for the existing cleanup sweep.
ALTER TABLE app.chats ADD COLUMN project_id uuid;
ALTER TABLE app.chats ADD CONSTRAINT chats_project_fk
  FOREIGN KEY (org_id,project_id) REFERENCES app.projects(org_id,id)
  ON DELETE SET NULL (project_id);
CREATE INDEX chats_org_project ON app.chats(org_id,project_id,last_activity_at,id);
ALTER TABLE app.chat_create_requests ADD COLUMN project_id uuid;
--> statement-breakpoint
-- §4.2 access definers. lexon_project_access binds both claims (it can never
-- probe another user's standing); the companion definers verify only the
-- org context so they can evaluate targets other than the caller.
CREATE FUNCTION ops.lexon_org_member(input_org_id uuid, input_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  IF context_org IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM auth.member m
    WHERE m.organization_id=input_org_id AND m.user_id=input_user_id);
END $$;
REVOKE ALL ON FUNCTION ops.lexon_org_member(uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_org_member(uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.lexon_org_owner_admin(input_org_id uuid, input_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  IF context_org IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM auth.member m
    WHERE m.organization_id=input_org_id AND m.user_id=input_user_id
      AND m.role IN ('owner','admin'));
END $$;
REVOKE ALL ON FUNCTION ops.lexon_org_owner_admin(uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_org_owner_admin(uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.lexon_project_denied(input_org_id uuid, input_project_id uuid, input_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  IF context_org IS NULL OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM app.project_denies d
    WHERE d.org_id=input_org_id AND d.project_id=input_project_id
      AND d.user_id=input_user_id);
END $$;
REVOKE ALL ON FUNCTION ops.lexon_project_denied(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_project_denied(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- Level order inside the function: claims binding, then org membership,
-- then deny (deny is checked BEFORE owner so it beats ownership), then the
-- owner/member rows. Output is the level only — ids never leave.
CREATE FUNCTION ops.lexon_project_access(input_org_id uuid, input_project_id uuid, input_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; owner_id uuid; member_role text;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_user_id IS DISTINCT FROM context_user
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
REVOKE ALL ON FUNCTION ops.lexon_project_access(uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_project_access(uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- Deny writes exist only as definers — project_denies has no lexon_app write
-- policy at all. The definer re-verifies the actor bound to the claims, the
-- org owner/admin gate and the owner-target refusal, then upserts the deny
-- and removes any member row in one statement block.
CREATE FUNCTION ops.lexon_project_deny_add(input_org_id uuid, input_project_id uuid, input_actor uuid, input_target uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid; context_user uuid; owner_id uuid;
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
    ON CONFLICT (org_id,project_id,user_id)
    DO UPDATE SET set_by_user_id=EXCLUDED.set_by_user_id,
      created_at=clock_timestamp();
  DELETE FROM app.project_members
    WHERE org_id=input_org_id AND project_id=input_project_id
      AND user_id=input_target;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION ops.lexon_project_deny_add(uuid,uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_project_deny_add(uuid,uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION ops.lexon_project_deny_lift(input_org_id uuid, input_project_id uuid, input_actor uuid, input_target uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE context_org uuid; context_user uuid;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL
    OR input_org_id IS DISTINCT FROM context_org
    OR input_actor IS DISTINCT FROM context_user
    OR input_project_id IS NULL OR input_target IS NULL THEN
    RAISE EXCEPTION 'Project deny lift unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT ops.lexon_org_owner_admin(input_org_id,input_actor) THEN
    RAISE EXCEPTION 'Project deny lift requires an organization owner or admin'
      USING ERRCODE='42501';
  END IF;
  IF input_actor=input_target THEN
    RAISE EXCEPTION 'An organization admin cannot lift their own deny'
      USING ERRCODE='42501', CONSTRAINT='project_deny_self_lift';
  END IF;
  DELETE FROM app.project_denies
    WHERE org_id=input_org_id AND project_id=input_project_id
      AND user_id=input_target;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION ops.lexon_project_deny_lift(uuid,uuid,uuid,uuid) FROM PUBLIC,lexon_auth;
GRANT EXECUTE ON FUNCTION ops.lexon_project_deny_lift(uuid,uuid,uuid,uuid) TO lexon_app;
--> statement-breakpoint
-- Denormalized counters are trigger-maintained (lexon_migrator owns the
-- trigger functions; the internal policies admit the writes). member_count
-- feeds the org-admin metadata list, chat_count the delete confirmation,
-- and last_activity_at tracks chat binding plus message activity.
CREATE FUNCTION ops.lexon_project_member_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE app.projects SET member_count=member_count+1,updated_at=clock_timestamp()
      WHERE org_id=NEW.org_id AND id=NEW.project_id;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    UPDATE app.projects SET member_count=member_count-1,updated_at=clock_timestamp()
      WHERE org_id=OLD.org_id AND id=OLD.project_id;
    RETURN OLD;
  ELSE
    IF NEW.org_id IS DISTINCT FROM OLD.org_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      UPDATE app.projects SET member_count=member_count-1,updated_at=clock_timestamp()
        WHERE org_id=OLD.org_id AND id=OLD.project_id;
      UPDATE app.projects SET member_count=member_count+1,updated_at=clock_timestamp()
        WHERE org_id=NEW.org_id AND id=NEW.project_id;
    END IF;
    RETURN NEW;
  END IF;
END $$;
REVOKE ALL ON FUNCTION ops.lexon_project_member_count() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER project_members_count AFTER INSERT OR UPDATE OR DELETE
  ON app.project_members FOR EACH ROW
  EXECUTE FUNCTION ops.lexon_project_member_count();
--> statement-breakpoint
CREATE FUNCTION ops.lexon_project_chat_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE app.projects SET chat_count=chat_count+1,
        last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE org_id=NEW.org_id AND id=NEW.project_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF OLD.project_id IS NOT NULL THEN
      UPDATE app.projects SET chat_count=chat_count-1,updated_at=clock_timestamp()
        WHERE org_id=OLD.org_id AND id=OLD.project_id;
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      IF OLD.project_id IS NOT NULL THEN
        UPDATE app.projects SET chat_count=chat_count-1,updated_at=clock_timestamp()
          WHERE org_id=OLD.org_id AND id=OLD.project_id;
      END IF;
      IF NEW.project_id IS NOT NULL THEN
        UPDATE app.projects SET chat_count=chat_count+1,
          last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE org_id=NEW.org_id AND id=NEW.project_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END $$;
REVOKE ALL ON FUNCTION ops.lexon_project_chat_stats() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER chats_project_stats AFTER INSERT OR UPDATE OF project_id OR DELETE
  ON app.chats FOR EACH ROW
  EXECUTE FUNCTION ops.lexon_project_chat_stats();
--> statement-breakpoint
CREATE FUNCTION ops.lexon_project_chat_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  UPDATE app.projects p SET last_activity_at=clock_timestamp()
    FROM app.chats c
    WHERE c.org_id=NEW.org_id AND c.id=NEW.chat_id AND c.project_id IS NOT NULL
      AND p.org_id=c.org_id AND p.id=c.project_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops.lexon_project_chat_activity() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER chat_messages_project_activity AFTER INSERT
  ON app.chat_messages FOR EACH ROW
  EXECUTE FUNCTION ops.lexon_project_chat_activity();
--> statement-breakpoint
-- The create-request receipt carries the project binding; this trigger
-- copies it onto the materialized chat row (bind-once, mismatch raises).
CREATE FUNCTION ops.chat_create_request_project_bind() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  UPDATE app.chats c SET project_id=NEW.project_id
    WHERE c.org_id=NEW.org_id AND c.id=NEW.chat_id AND c.project_id IS NULL;
  IF FOUND THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM app.chats c
    WHERE c.org_id=NEW.org_id AND c.id=NEW.chat_id
      AND c.project_id=NEW.project_id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Chat project binding conflict'
    USING ERRCODE='23514', CONSTRAINT='chat_project_binding';
END $$;
REVOKE ALL ON FUNCTION ops.chat_create_request_project_bind() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER chat_create_request_project_bind BEFORE INSERT
  ON app.chat_create_requests FOR EACH ROW
  EXECUTE FUNCTION ops.chat_create_request_project_bind();
--> statement-breakpoint
-- §4.3 policy changes on the existing tree. The chats read arm is disjoint
-- by project_id: standalone rows grant owner-or-share, project-bound rows
-- grant only lexon_project_access <> 'none' — ownership of a project chat
-- conveys no read rights by itself.
DROP POLICY owner_live_chat_select ON app.chats;
CREATE POLICY chats_access_select ON app.chats FOR SELECT TO lexon_app
USING (
  org_id = NULLIF(current_setting('app.org_id',true),'')::uuid
  AND deleted_at IS NULL
  AND ops.lexon_org_member(org_id, NULLIF(current_setting('app.user_id',true),'')::uuid)
  AND ( (project_id IS NULL AND (
           owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
           OR EXISTS (SELECT 1 FROM app.chat_shares s
                WHERE s.org_id=chats.org_id AND s.chat_id=chats.id
                  AND s.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
     OR (project_id IS NOT NULL
          AND ops.lexon_project_access(org_id, project_id,
               NULLIF(current_setting('app.user_id',true),'')::uuid) <> 'none')));
DROP POLICY owner_live_chat_insert ON app.chats;
CREATE POLICY owner_live_chat_insert ON app.chats FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND deleted_at IS NULL
    AND (project_id IS NULL
      OR ops.lexon_project_access(org_id, project_id,
        NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor')));
-- The binding is immutable at the privilege layer: lexon_app keeps table
-- grants minus the UPDATE column, which is granted column-by-column.
REVOKE UPDATE ON app.chats FROM lexon_app;
GRANT UPDATE (id,org_id,owner_user_id,title,title_source,title_version,
  viewed_leaf_id,active_answer_run_id,deleted_at,created_at,updated_at,
  last_activity_at) ON app.chats TO lexon_app;
--> statement-breakpoint
DROP POLICY owner_chat_run_select ON app.chat_runs;
CREATE POLICY chat_run_access_select ON app.chat_runs FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_runs.org_id
      AND c.id=chat_runs.chat_id));
--> statement-breakpoint
DROP POLICY owner_chat_message ON app.chat_messages;
CREATE POLICY chat_message_access_select ON app.chat_messages FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id));
CREATE POLICY owner_chat_message_insert ON app.chat_messages FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL));
CREATE POLICY owner_chat_message_update ON app.chat_messages FOR UPDATE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL))
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL));
CREATE POLICY owner_chat_message_delete ON app.chat_messages FOR DELETE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL));
--> statement-breakpoint
-- ai_runs splits its single RESTRICTIVE policy: reads inherit the whole
-- rule through an RLS-filtered chat_runs link, writes keep the
-- owner/initiator arms verbatim from 0028.
DROP POLICY ai_runs_owner_live_resource ON app.ai_runs;
CREATE POLICY ai_runs_access_read ON app.ai_runs AS RESTRICTIVE
  FOR SELECT TO lexon_app
  USING (
      (CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
        THEN jsonb_array_length(resolved_config->'resourceIds')=0
        WHEN resolved_config->'resourceIds' IS NULL THEN true ELSE false END)
      OR EXISTS (
        SELECT 1 FROM app.chat_runs cr
        WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id
          AND cr.chat_id::text=ai_runs.resolved_config->'resourceIds'->>0
          AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
            THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END)
      OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND status='queued'
        AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
          THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')<=32 ELSE false END
        AND NOT ops.ai_chat_run_is_associated(ai_runs.org_id,
          NULLIF(current_setting('app.user_id',true),'')::uuid,ai_runs.id))
    );
CREATE POLICY ai_runs_owner_live_insert ON app.ai_runs AS RESTRICTIVE
  FOR INSERT TO lexon_app
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
CREATE POLICY ai_runs_owner_live_update ON app.ai_runs AS RESTRICTIVE
  FOR UPDATE TO lexon_app
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
CREATE POLICY ai_runs_owner_live_delete ON app.ai_runs AS RESTRICTIVE
  FOR DELETE TO lexon_app
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
    );
--> statement-breakpoint
-- The ai_steps/ai_checkpoints/ai_operations read arms keep the zero-resource
-- arm and gain an RLS-filtered chat_runs link; write arms are the 0027
-- owner-run checks verbatim. ai_attempts has no owner-run restrictive
-- policy (0027's lifecycle policies are lexon_migrator-only), so it is not
-- split here.
DROP POLICY ai_steps_owner_run ON app.ai_steps;
CREATE POLICY ai_steps_access_read ON app.ai_steps AS RESTRICTIVE
  FOR SELECT TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb)
    OR EXISTS (SELECT 1 FROM app.chat_runs cr
      WHERE cr.org_id=ai_steps.org_id AND cr.run_id=ai_steps.run_id));
CREATE POLICY ai_steps_owner_run_insert ON app.ai_steps AS RESTRICTIVE
  FOR INSERT TO lexon_app
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_steps_owner_run_update ON app.ai_steps AS RESTRICTIVE
  FOR UPDATE TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_steps_owner_run_delete ON app.ai_steps AS RESTRICTIVE
  FOR DELETE TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
DROP POLICY ai_checkpoints_owner_run ON app.ai_checkpoints;
CREATE POLICY ai_checkpoints_access_read ON app.ai_checkpoints AS RESTRICTIVE
  FOR SELECT TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb)
    OR EXISTS (SELECT 1 FROM app.chat_runs cr
      WHERE cr.org_id=ai_checkpoints.org_id AND cr.run_id=ai_checkpoints.run_id));
CREATE POLICY ai_checkpoints_owner_run_insert ON app.ai_checkpoints AS RESTRICTIVE
  FOR INSERT TO lexon_app
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_checkpoints_owner_run_update ON app.ai_checkpoints AS RESTRICTIVE
  FOR UPDATE TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_checkpoints_owner_run_delete ON app.ai_checkpoints AS RESTRICTIVE
  FOR DELETE TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
DROP POLICY ai_operations_owner_run ON app.ai_operations;
CREATE POLICY ai_operations_access_read ON app.ai_operations AS RESTRICTIVE
  FOR SELECT TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb)
    OR EXISTS (SELECT 1 FROM app.chat_runs cr
      WHERE cr.org_id=ai_operations.org_id AND cr.run_id=ai_operations.run_id));
CREATE POLICY ai_operations_owner_run_insert ON app.ai_operations AS RESTRICTIVE
  FOR INSERT TO lexon_app
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_operations_owner_run_update ON app.ai_operations AS RESTRICTIVE
  FOR UPDATE TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY ai_operations_owner_run_delete ON app.ai_operations AS RESTRICTIVE
  FOR DELETE TO lexon_app
  USING (EXISTS (SELECT 1 FROM app.ai_runs r
    WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
      AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
        OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
--> statement-breakpoint
-- The create-request gate mirrors chats INSERT: owner/editor on the
-- receipt's project only.
DROP POLICY owner_live_chat_create_request_insert ON app.chat_create_requests;
CREATE POLICY owner_live_chat_create_request_insert ON app.chat_create_requests
  FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_create_requests.org_id
      AND c.id=chat_create_requests.chat_id AND c.owner_user_id=chat_create_requests.owner_user_id
      AND c.deleted_at IS NULL)
    AND (project_id IS NULL
      OR ops.lexon_project_access(org_id, project_id,
        NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor')));
--> statement-breakpoint
-- New-table policies. projects carries the metadata-only admin arm (deny
-- still beats admin); instructions never open to that arm; project_denies
-- has no lexon_app write policy at all — deny writes are definer-only.
CREATE POLICY projects_access_select ON app.projects FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_org_member(org_id,NULLIF(current_setting('app.user_id',true),'')::uuid)
    AND (ops.lexon_project_access(org_id,id,
           NULLIF(current_setting('app.user_id',true),'')::uuid)<>'none'
      OR (ops.lexon_org_owner_admin(org_id,NULLIF(current_setting('app.user_id',true),'')::uuid)
        AND NOT ops.lexon_project_denied(org_id,id,
          NULLIF(current_setting('app.user_id',true),'')::uuid))));
CREATE POLICY projects_owner_insert ON app.projects FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND ops.lexon_org_member(org_id,NULLIF(current_setting('app.user_id',true),'')::uuid));
CREATE POLICY projects_owner_update ON app.projects FOR UPDATE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner')
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner');
CREATE POLICY projects_owner_delete ON app.projects FOR DELETE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner');
CREATE POLICY projects_internal ON app.projects FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY project_members_access_select ON app.project_members FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)<>'none');
CREATE POLICY project_members_owner_insert ON app.project_members FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner'
    AND ops.lexon_org_member(org_id,user_id)
    AND NOT ops.lexon_project_denied(org_id,project_id,user_id));
CREATE POLICY project_members_owner_update ON app.project_members FOR UPDATE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner')
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner'
    AND ops.lexon_org_member(org_id,user_id)
    AND NOT ops.lexon_project_denied(org_id,project_id,user_id));
CREATE POLICY project_members_owner_delete ON app.project_members FOR DELETE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)='owner');
CREATE POLICY project_members_internal ON app.project_members FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY project_instructions_access_select ON app.project_instructions FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid)<>'none');
CREATE POLICY project_instructions_write_insert ON app.project_instructions FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor'));
CREATE POLICY project_instructions_write_update ON app.project_instructions FOR UPDATE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor'))
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor'));
CREATE POLICY project_instructions_write_delete ON app.project_instructions FOR DELETE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_project_access(org_id,project_id,
      NULLIF(current_setting('app.user_id',true),'')::uuid) IN ('owner','editor'));
CREATE POLICY project_instructions_internal ON app.project_instructions FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY project_denies_admin_select ON app.project_denies FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND ops.lexon_org_owner_admin(org_id,NULLIF(current_setting('app.user_id',true),'')::uuid));
CREATE POLICY project_denies_internal ON app.project_denies FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
--> statement-breakpoint
-- chat_shares reads deliberately avoid chats entirely — that is what keeps
-- the chats <-> chat_shares pair acyclic.
CREATE POLICY chat_shares_access_select ON app.chat_shares FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND (user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      OR granted_by_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid));
CREATE POLICY chat_shares_owner_insert ON app.chat_shares FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND granted_by_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND ops.lexon_org_member(org_id,user_id)
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_shares.org_id
      AND c.id=chat_shares.chat_id
      AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.project_id IS NULL));
CREATE POLICY chat_shares_access_delete ON app.chat_shares FOR DELETE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND (granted_by_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      OR user_id=NULLIF(current_setting('app.user_id',true),'')::uuid));
CREATE POLICY chat_shares_internal ON app.chat_shares FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Grants. projects write access is column-scoped so trigger-maintained
-- counters and the activity timestamp can never be written by lexon_app;
-- project_denies stays read-only (definer writes only).
GRANT SELECT ON app.projects,app.project_members,app.project_denies,app.project_instructions,app.chat_shares TO lexon_app;
GRANT INSERT (id,org_id,owner_user_id,name,matter_number,practice_area,created_at,updated_at) ON app.projects TO lexon_app;
GRANT UPDATE (id,org_id,owner_user_id,name,matter_number,practice_area,created_at,updated_at) ON app.projects TO lexon_app;
GRANT DELETE ON app.projects TO lexon_app;
GRANT INSERT,UPDATE,DELETE ON app.project_members,app.project_instructions,app.chat_shares TO lexon_app;
REVOKE TRUNCATE ON app.projects,app.project_members,app.project_denies,app.project_instructions,app.chat_shares
  FROM lexon_app,lexon_auth,PUBLIC;
