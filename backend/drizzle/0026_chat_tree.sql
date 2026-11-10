CREATE TABLE app.chats (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES auth.organization(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth."user"(id),
  title text NOT NULL DEFAULT '' CHECK (octet_length(title) <= 1024),
  title_source text NOT NULL DEFAULT 'excerpt' CHECK (title_source IN ('excerpt','ai','user')),
  title_version integer NOT NULL DEFAULT 1 CHECK (title_version > 0),
  viewed_leaf_id uuid,
  active_answer_run_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id,id)
);
CREATE INDEX chats_owner_activity ON app.chats(org_id,owner_user_id,last_activity_at DESC,id)
  WHERE deleted_at IS NULL;
ALTER TABLE app.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chats FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_live_chat_select ON app.chats FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND deleted_at IS NULL);
CREATE POLICY owner_live_chat_insert ON app.chats FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND deleted_at IS NULL);
CREATE POLICY owner_live_chat_update ON app.chats FOR UPDATE TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND deleted_at IS NULL)
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY chat_trigger_internal ON app.chats FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON app.chats TO lexon_app;
CREATE POLICY ai_run_chat_trigger_internal ON app.ai_runs FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);

CREATE TABLE app.chat_runs (
  org_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('answer','title')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,chat_id,run_id),
  UNIQUE (org_id,run_id),
  CONSTRAINT chat_runs_chat_fk FOREIGN KEY (org_id,chat_id)
    REFERENCES app.chats(org_id,id) ON DELETE CASCADE,
  CONSTRAINT chat_runs_run_fk FOREIGN KEY (org_id,run_id)
    REFERENCES app.ai_runs(org_id,id) ON DELETE CASCADE
);
ALTER TABLE app.chat_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_chat_run ON app.chat_runs FOR ALL TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_runs.org_id
      AND c.id=chat_runs.chat_id AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL))
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_runs.org_id
      AND c.id=chat_runs.chat_id AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL));
CREATE POLICY chat_run_trigger_internal ON app.chat_runs FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON app.chat_runs TO lexon_app;
ALTER TABLE app.chats ADD CONSTRAINT chats_active_answer_fk
  FOREIGN KEY (org_id,id,active_answer_run_id)
  REFERENCES app.chat_runs(org_id,chat_id,run_id)
  ON DELETE SET NULL (active_answer_run_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE app.chat_messages (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  parent_message_id uuid,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  user_text text,
  effort text CHECK (effort IS NULL OR effort IN ('high','max')),
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id,chat_id,id),
  UNIQUE (org_id,run_id),
  CONSTRAINT chat_messages_chat_fk FOREIGN KEY (org_id,chat_id)
    REFERENCES app.chats(org_id,id) ON DELETE CASCADE,
  CONSTRAINT chat_messages_parent_fk FOREIGN KEY (org_id,chat_id,parent_message_id)
    REFERENCES app.chat_messages(org_id,chat_id,id) ON DELETE CASCADE,
  CONSTRAINT chat_messages_run_fk FOREIGN KEY (org_id,chat_id,run_id)
    REFERENCES app.chat_runs(org_id,chat_id,run_id) ON DELETE CASCADE,
  CONSTRAINT chat_messages_content_shape CHECK (
    (role='user' AND user_text IS NOT NULL AND run_id IS NULL AND effort IS NOT NULL)
    OR (role='assistant' AND user_text IS NULL AND run_id IS NOT NULL AND effort IS NULL)
  )
);
CREATE INDEX chat_messages_tree ON app.chat_messages(org_id,chat_id,created_at,id);
ALTER TABLE app.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_chat_message ON app.chat_messages FOR ALL TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL))
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
      AND c.id=chat_messages.chat_id AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND c.deleted_at IS NULL));
CREATE POLICY chat_message_trigger_internal ON app.chat_messages FOR ALL TO lexon_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.chat_messages TO lexon_app;
ALTER TABLE app.chats ADD CONSTRAINT chats_viewed_leaf_fk
  FOREIGN KEY (org_id,id,viewed_leaf_id) REFERENCES app.chat_messages(org_id,chat_id,id)
  ON DELETE SET NULL (viewed_leaf_id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION ops.ai_chat_run_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,auth,pg_temp AS $$
DECLARE chat_owner uuid; run_owner uuid; run_status text; current_active uuid;
BEGIN
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
REVOKE ALL ON FUNCTION ops.ai_chat_run_link_guard() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER chat_run_link_guard BEFORE INSERT OR UPDATE ON app.chat_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_run_link_guard();

CREATE FUNCTION ops.ai_chat_resource_write_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE resource_run uuid; resource_org uuid; chat_id uuid; chat_live boolean;
BEGIN
  IF TG_TABLE_NAME='ai_runs' THEN
    IF TG_OP='DELETE' THEN resource_run:=OLD.id; resource_org:=OLD.org_id;
    ELSE resource_run:=NEW.id; resource_org:=NEW.org_id; END IF;
  ELSIF TG_OP='DELETE' THEN
    resource_run:=OLD.run_id; resource_org:=OLD.org_id;
  ELSE
    resource_run:=NEW.run_id; resource_org:=NEW.org_id;
  END IF;
  SELECT cr.chat_id INTO chat_id FROM app.chat_runs cr
    WHERE cr.org_id=resource_org AND cr.run_id=resource_run;
  IF NOT FOUND THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT (c.deleted_at IS NULL) INTO chat_live FROM app.chats c
    WHERE c.org_id=resource_org AND c.id=chat_id FOR UPDATE;
  IF chat_live IS DISTINCT FROM true THEN
    IF TG_TABLE_NAME='ai_steps' AND TG_OP='UPDATE' AND NEW.state='failed'
      AND NEW.committed_text IS NOT DISTINCT FROM OLD.committed_text
      AND NEW.commit_data IS NOT DISTINCT FROM OLD.commit_data THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Chat content write fenced' USING ERRCODE='23514', CONSTRAINT='chat_content_write_fenced';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_resource_write_fence() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER ai_runs_chat_write_fence BEFORE UPDATE OF input_text,resolved_config,partial_output,final_output ON app.ai_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
CREATE TRIGGER ai_steps_chat_write_fence BEFORE INSERT OR UPDATE OF state,committed_text,commit_data ON app.ai_steps
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
CREATE TRIGGER ai_attempts_chat_write_fence BEFORE INSERT ON app.ai_attempts
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
CREATE TRIGGER ai_checkpoints_chat_write_fence BEFORE INSERT OR UPDATE OF attempt_id,fence,text ON app.ai_checkpoints
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();
CREATE TRIGGER ai_operations_chat_write_fence BEFORE INSERT OR UPDATE OF idempotency_mode,args,result,error_code ON app.ai_operations
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_resource_write_fence();

CREATE FUNCTION ops.ai_chat_terminal_pointer_clear() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NEW.status IN ('completed','failed','cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE app.chats c SET active_answer_run_id=NULL,updated_at=clock_timestamp()
      FROM app.chat_runs cr
      WHERE cr.org_id=NEW.org_id AND cr.run_id=NEW.id AND cr.kind='answer'
        AND c.org_id=cr.org_id AND c.id=cr.chat_id AND c.active_answer_run_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_terminal_pointer_clear() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER ai_runs_chat_terminal_pointer AFTER UPDATE OF status ON app.ai_runs
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_terminal_pointer_clear();

CREATE FUNCTION ops.ai_chat_message_tree_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE parent_role text; current_parent uuid; seen uuid[]; ancestor uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Chat messages are immutable' USING ERRCODE='23514', CONSTRAINT='chat_message_immutable';
  END IF;
  IF NEW.parent_message_id IS NULL THEN
    IF NEW.role <> 'user' THEN
      RAISE EXCEPTION 'Chat roots must be user messages' USING ERRCODE='23514', CONSTRAINT='chat_message_root_role';
    END IF;
    RETURN NEW;
  END IF;
  SELECT role INTO parent_role FROM app.chat_messages
    WHERE org_id=NEW.org_id AND chat_id=NEW.chat_id AND id=NEW.parent_message_id;
  IF NOT FOUND OR parent_role=NEW.role THEN
    RAISE EXCEPTION 'Invalid chat message parent' USING ERRCODE='23514', CONSTRAINT='chat_message_parent_role';
  END IF;
  current_parent:=NEW.parent_message_id;
  seen:=ARRAY[NEW.id];
  WHILE current_parent IS NOT NULL LOOP
    IF current_parent=ANY(seen) THEN
      RAISE EXCEPTION 'Chat message cycle' USING ERRCODE='23514', CONSTRAINT='chat_message_cycle';
    END IF;
    seen:=array_append(seen,current_parent);
    SELECT parent_message_id INTO ancestor FROM app.chat_messages
      WHERE org_id=NEW.org_id AND chat_id=NEW.chat_id AND id=current_parent;
    current_parent:=ancestor;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops.ai_chat_message_tree_guard() FROM PUBLIC,lexon_app,lexon_auth;
CREATE TRIGGER chat_message_tree_guard BEFORE INSERT OR UPDATE ON app.chat_messages
  FOR EACH ROW EXECUTE FUNCTION ops.ai_chat_message_tree_guard();

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
  UPDATE app.chats SET deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE org_id=context_org AND id=input_chat_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid) FROM PUBLIC,lexon_auth,lexon_migrator;
GRANT EXECUTE ON FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid) TO lexon_app;
