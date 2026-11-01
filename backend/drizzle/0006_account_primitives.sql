-- Invoker functions expose only named locking operations. They cannot elevate
-- lexon_auth's privileges or assign policy decisions to infrastructure.
CREATE FUNCTION auth.lexon_lock_signup_grants(invitation_id uuid, setup_digest text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE organization_id uuid;
BEGIN
  IF invitation_id IS NOT NULL THEN
    SELECT i.organization_id INTO organization_id FROM auth.invitation i WHERE i.id = invitation_id;
    PERFORM o.id FROM auth.organization o WHERE o.id = organization_id FOR UPDATE;
    PERFORM i.id FROM auth.invitation i WHERE i.id = invitation_id FOR UPDATE;
  END IF;
  IF setup_digest IS NOT NULL THEN
    IF setup_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid grant identifier'; END IF;
    PERFORM v.id FROM auth.verification v WHERE v.identifier = 'lexon.admin-setup.v1:' || setup_digest FOR UPDATE;
  END IF;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_lock_signup_grants(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_lock_signup_grants(uuid,text) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_lock_account(user_id uuid) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, auth, pg_temp AS $$
  SELECT u.id FROM auth."user" u WHERE u.id = user_id FOR UPDATE;
$$;
REVOKE ALL ON FUNCTION auth.lexon_lock_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_lock_account(uuid) TO lexon_auth;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.lexon_validate_audit(event jsonb) RETURNS void
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
    WHEN 'identity.account_changed.v1' THEN
      allowed_metadata := ARRAY['action'];
      valid := event->>'outcome' = 'success' AND event ? 'subjectUserId'
        AND metadata->>'action' IN ('password_changed','password_reset','email_change_requested','email_changed','sessions_revoked','signed_out');
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
