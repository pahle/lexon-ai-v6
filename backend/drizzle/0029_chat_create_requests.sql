CREATE TABLE app.chat_create_requests (
  org_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  user_message_id uuid NOT NULL,
  assistant_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, owner_user_id, request_id),
  FOREIGN KEY (org_id, chat_id) REFERENCES app.chats(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, chat_id, user_message_id)
    REFERENCES app.chat_messages(org_id, chat_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, chat_id, assistant_message_id)
    REFERENCES app.chat_messages(org_id, chat_id, id) ON DELETE CASCADE
);
ALTER TABLE app.chat_create_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_create_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_live_chat_create_request_select ON app.chat_create_requests
  FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY owner_live_chat_create_request_insert ON app.chat_create_requests
  FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_create_requests.org_id
      AND c.id=chat_create_requests.chat_id AND c.owner_user_id=chat_create_requests.owner_user_id
      AND c.deleted_at IS NULL));
CREATE POLICY chat_create_request_internal ON app.chat_create_requests
  FOR ALL TO lexon_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON app.chat_create_requests TO lexon_app;
REVOKE UPDATE, DELETE, TRUNCATE ON app.chat_create_requests FROM lexon_app, lexon_auth, PUBLIC;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_validate_chat_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  metadata jsonb := event->'metadata';
  field text;
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR NOT (event ?& ARRAY['version','eventId','occurredAt','type','outcome','orgId','actorUserId','metadata'])
    OR event->'version' IS DISTINCT FROM '1'::jsonb
    OR event->>'type' NOT IN ('chat.created.v1','chat.message_sent.v1')
    OR event->>'outcome' IS DISTINCT FROM 'success'
    OR NOT COALESCE(event->>'orgId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    OR NOT COALESCE(event->>'actorUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR NOT COALESCE(metadata->>'chatId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    OR (event->>'type'='chat.message_sent.v1'
      AND NOT COALESCE(metadata->>'messageId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false))
    OR (event->>'type'='chat.created.v1' AND metadata ? 'messageId') THEN
    RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(event) LOOP
    IF NOT (field = ANY(ARRAY['version','eventId','type','occurredAt','outcome','actorUserId','orgId','metadata'])) THEN
      RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR field IN SELECT jsonb_object_keys(metadata) LOOP
    IF NOT (field = ANY(CASE WHEN event->>'type'='chat.created.v1'
      THEN ARRAY['chatId'] ELSE ARRAY['chatId','messageId'] END)) THEN
      RAISE EXCEPTION 'Invalid chat audit metadata' USING ERRCODE = '23514';
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_chat_audit(jsonb) FROM PUBLIC, lexon_app, lexon_auth;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.lexon_validate_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE
  event jsonb;
BEGIN
  event := jsonb_strip_nulls(jsonb_build_object(
    'version',NEW.version,'eventId',NEW.event_id,'type',NEW.type,
    'occurredAt',to_char(NEW.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'outcome',NEW.outcome,'actorUserId',NEW.actor_user_id,'subjectUserId',NEW.subject_user_id,
    'sessionId',NEW.session_id,'orgId',NEW.org_id,'invitationId',NEW.invitation_id,
    'memberId',NEW.member_id,'requestId',NEW.request_id)) || jsonb_build_object('metadata',NEW.metadata);
  IF NEW.type IN ('chat.created.v1','chat.message_sent.v1') THEN
    PERFORM auth.lexon_validate_chat_audit(event);
  ELSIF NEW.type LIKE 'chat.%' THEN
    PERFORM auth.lexon_validate_ai_audit(event);
  ELSE
    PERFORM auth.lexon_validate_audit(event);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_audit_row() FROM PUBLIC;
