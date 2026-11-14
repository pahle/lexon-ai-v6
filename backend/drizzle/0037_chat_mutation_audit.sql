CREATE OR REPLACE FUNCTION auth.lexon_validate_chat_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  metadata jsonb := event->'metadata';
  field text;
  event_type text := event->>'type';
  id_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR NOT (event ?& ARRAY['version','eventId','occurredAt','type','outcome','orgId','actorUserId','metadata'])
    OR event->'version' IS DISTINCT FROM '1'::jsonb
    OR event_type NOT IN (
      'chat.created.v1','chat.message_sent.v1','chat.renamed.v1',
      'chat.message_edited.v1','chat.message_regenerated.v1',
      'chat.deletion_requested.v1','chat.deletion_completed.v1'
    )
    OR event->>'outcome' IS DISTINCT FROM 'success'
    OR NOT COALESCE(event->>'orgId' ~* id_pattern, false)
    OR NOT COALESCE(event->>'actorUserId' ~* id_pattern, false)
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR NOT COALESCE(metadata->>'chatId' ~* id_pattern, false)
    OR (event_type IN ('chat.message_sent.v1','chat.message_edited.v1','chat.message_regenerated.v1')
      AND NOT COALESCE(metadata->>'messageId' ~* id_pattern, false))
    OR (event_type IN ('chat.created.v1','chat.renamed.v1','chat.deletion_requested.v1','chat.deletion_completed.v1')
      AND metadata ? 'messageId') THEN
    RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(event) LOOP
    IF NOT (field = ANY(ARRAY['version','eventId','occurredAt','type','outcome','actorUserId','orgId','metadata'])) THEN
      RAISE EXCEPTION 'Invalid chat audit event' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR field IN SELECT jsonb_object_keys(metadata) LOOP
    IF NOT (field = ANY(CASE
      WHEN event_type IN ('chat.message_sent.v1','chat.message_edited.v1','chat.message_regenerated.v1')
        THEN ARRAY['chatId','messageId']
      ELSE ARRAY['chatId']
    END)) THEN
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
  IF NEW.type IN (
    'chat.created.v1','chat.message_sent.v1','chat.renamed.v1',
    'chat.message_edited.v1','chat.message_regenerated.v1',
    'chat.deletion_requested.v1','chat.deletion_completed.v1'
  ) THEN
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
