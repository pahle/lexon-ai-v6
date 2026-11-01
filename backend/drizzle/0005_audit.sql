CREATE TABLE ops.audit_events (
  event_id uuid PRIMARY KEY,
  version integer NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  outcome text NOT NULL,
  actor_user_id uuid,
  subject_user_id uuid,
  session_id uuid,
  org_id uuid,
  invitation_id uuid,
  member_id uuid,
  request_id uuid,
  metadata jsonb NOT NULL
);
REVOKE ALL ON ops.audit_events FROM PUBLIC, lexon_app, lexon_auth;
GRANT INSERT ON ops.audit_events TO lexon_app;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_validate_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE
  field text;
  metadata jsonb := event->'metadata';
  allowed_metadata text[];
  valid boolean := false;
  correlated boolean;
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR NOT (event ?& ARRAY['version','eventId','type','occurredAt','outcome','metadata'])
    OR event->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid audit event' USING ERRCODE = '23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(event) LOOP
    IF NOT (field = ANY(ARRAY['version','eventId','type','occurredAt','outcome','actorUserId','subjectUserId','sessionId','orgId','invitationId','memberId','requestId','metadata'])) THEN
      RAISE EXCEPTION 'Invalid audit event' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['eventId','actorUserId','subjectUserId','sessionId','orgId','invitationId','memberId','requestId'] LOOP
    IF event ? field AND (jsonb_typeof(event->field) IS DISTINCT FROM 'string'
      OR event->>field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'Invalid audit identifier' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF jsonb_typeof(event->'occurredAt') IS DISTINCT FROM 'string'
    OR event->>'occurredAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$' THEN
    RAISE EXCEPTION 'Invalid audit timestamp' USING ERRCODE = '23514';
  END IF;
  PERFORM (event->>'occurredAt')::timestamptz;
  correlated := CASE WHEN event ? 'subjectUserId' THEN
    NOT (metadata ? 'subjectHmac' OR metadata ? 'keyId')
  ELSE
    jsonb_typeof(metadata->'subjectHmac') = 'string' AND metadata->>'subjectHmac' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(metadata->'keyId') = 'string' AND metadata->>'keyId' ~ '^[a-z0-9_-]{1,32}$'
  END;
  CASE event->>'type'
    WHEN 'identity.sign_in_failed.v1' THEN
      allowed_metadata := ARRAY['reason','subjectHmac','keyId'];
      valid := event->>'outcome' = 'failure' AND correlated
        AND metadata->>'reason' IN ('invalid_credentials','disabled','invalid_factor','rate_limited');
    WHEN 'identity.sign_in_succeeded.v1' THEN
      allowed_metadata := ARRAY['channel'];
      valid := event->>'outcome' = 'success' AND event ? 'subjectUserId'
        AND metadata->>'channel' IN ('cookie','bearer');
    WHEN 'organization.created.v1' THEN
      allowed_metadata := ARRAY['kind','source'];
      valid := event->>'outcome' = 'success' AND event ?& ARRAY['orgId','actorUserId']
        AND metadata->>'kind' IN ('personal','team') AND metadata->>'source' IN ('user','platform');
    WHEN 'platform.admin_setup_invoked.v1' THEN
      allowed_metadata := ARRAY['additional','status','subjectHmac','keyId'];
      valid := correlated AND jsonb_typeof(metadata->'additional') = 'boolean'
        AND ((metadata->>'status' IN ('created','pending') AND event->>'outcome' = 'success')
          OR (metadata->>'status' = 'refused' AND event->>'outcome' = 'refused'));
    ELSE RAISE EXCEPTION 'Invalid audit type' USING ERRCODE = '23514';
  END CASE;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid audit event' USING ERRCODE = '23514'; END IF;
  FOR field IN SELECT jsonb_object_keys(metadata) LOOP
    IF NOT (field = ANY(allowed_metadata)) THEN
      RAISE EXCEPTION 'Invalid audit metadata' USING ERRCODE = '23514';
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Invalid audit event' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_audit(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_validate_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
BEGIN
  PERFORM auth.lexon_validate_audit(jsonb_strip_nulls(jsonb_build_object(
    'version',NEW.version,'eventId',NEW.event_id,'type',NEW.type,
    'occurredAt',to_char(NEW.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'outcome',NEW.outcome,'actorUserId',NEW.actor_user_id,'subjectUserId',NEW.subject_user_id,
    'sessionId',NEW.session_id,'orgId',NEW.org_id,'invitationId',NEW.invitation_id,
    'memberId',NEW.member_id,'requestId',NEW.request_id)) || jsonb_build_object('metadata',NEW.metadata));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_audit_row() FROM PUBLIC;
CREATE TRIGGER lexon_validate_audit_row BEFORE INSERT ON ops.audit_events
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_audit_row();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_append_audit(event jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
BEGIN
  PERFORM auth.lexon_validate_audit(event);
  INSERT INTO ops.audit_events
    (event_id,version,type,occurred_at,outcome,actor_user_id,subject_user_id,session_id,org_id,invitation_id,member_id,request_id,metadata)
  VALUES ((event->>'eventId')::uuid,1,event->>'type',(event->>'occurredAt')::timestamptz,event->>'outcome',
    (event->>'actorUserId')::uuid,(event->>'subjectUserId')::uuid,(event->>'sessionId')::uuid,
    (event->>'orgId')::uuid,(event->>'invitationId')::uuid,(event->>'memberId')::uuid,(event->>'requestId')::uuid,event->'metadata');
END $$;
REVOKE ALL ON FUNCTION auth.lexon_append_audit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_append_audit(jsonb) TO lexon_app, lexon_auth;
