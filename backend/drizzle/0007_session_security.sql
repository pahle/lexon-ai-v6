CREATE UNIQUE INDEX lexon_two_factor_user_unique ON auth.two_factor(user_id);
--> statement-breakpoint
CREATE FUNCTION auth.lexon_lock_security(target_user_id uuid, target_session_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, auth, pg_temp AS $$
BEGIN
  PERFORM u.id FROM auth."user" u WHERE u.id=target_user_id FOR UPDATE;
  PERFORM f.id FROM auth.two_factor f WHERE f.user_id=target_user_id FOR UPDATE;
  PERFORM s.id FROM auth.session s WHERE s.id=target_session_id AND s.user_id=target_user_id FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_lock_security(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_lock_security(uuid,uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_protect_session_security() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, auth, pg_temp AS $$
BEGIN
  IF current_user <> 'lexon_migrator' THEN
    IF TG_OP='INSERT' THEN
      -- Native replacement may copy custom fields. Evidence always starts
      -- empty; only the narrow writer can initialize it after verification.
      NEW.channel:='cookie'; NEW.hard_expires_at:=NULL;
      NEW.authenticated_at:=NULL; NEW.mfa_verified_at:=NULL; NEW.reauthenticated_at:=NULL;
    ELSIF ROW(NEW.id,NEW.user_id,NEW.created_at,NEW.token,NEW.channel,NEW.hard_expires_at,NEW.authenticated_at,NEW.mfa_verified_at,NEW.reauthenticated_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.created_at,OLD.token,OLD.channel,OLD.hard_expires_at,OLD.authenticated_at,OLD.mfa_verified_at,OLD.reauthenticated_at) THEN
      RAISE EXCEPTION 'Protected session fields' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.channel='bearer' THEN
    IF NEW.hard_expires_at IS NULL THEN RAISE EXCEPTION 'Invalid session security' USING ERRCODE='23514'; END IF;
    NEW.expires_at:=least(NEW.expires_at,NEW.hard_expires_at);
  ELSIF NEW.channel<>'cookie' OR NEW.hard_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid session security' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_protect_session_security() FROM PUBLIC;
CREATE TRIGGER lexon_protect_session_security BEFORE INSERT OR UPDATE ON auth.session
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_session_security();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_write_session_security(value jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE
  field text;
  stored auth.session%ROWTYPE;
  uid uuid:=(value->>'userId')::uuid;
  sid uuid:=(value->>'sessionId')::uuid;
  cap timestamp:=(value->>'hardExpiresAt')::timestamp;
  authenticated timestamp:=(value->>'authenticatedAt')::timestamp;
  mfa timestamp:=(value->>'mfaVerifiedAt')::timestamp;
  recent timestamp:=(value->>'reauthenticatedAt')::timestamp;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR NOT (value ?& ARRAY['userId','sessionId','expectedChannel','channel','hardExpiresAt','authenticatedAt','mfaVerifiedAt','reauthenticatedAt','activeOrganizationId','pendingOrganizationId']) THEN
    RAISE EXCEPTION 'Invalid session security';
  END IF;
  FOR field IN SELECT jsonb_object_keys(value) LOOP
    IF NOT (field=ANY(ARRAY['userId','sessionId','expectedChannel','channel','hardExpiresAt','authenticatedAt','mfaVerifiedAt','reauthenticatedAt','activeOrganizationId','pendingOrganizationId'])) THEN RAISE EXCEPTION 'Invalid session security'; END IF;
  END LOOP;
  PERFORM u.id FROM auth."user" u WHERE u.id=uid FOR UPDATE;
  SELECT * INTO stored FROM auth.session s WHERE s.id=sid AND s.user_id=uid FOR UPDATE;
  IF NOT FOUND OR stored.channel IS DISTINCT FROM value->>'expectedChannel' THEN RAISE EXCEPTION 'Session changed'; END IF;
  IF value->>'channel' NOT IN ('cookie','bearer') OR authenticated IS NULL
    OR authenticated>clock_timestamp()+interval '1 second' OR mfa>clock_timestamp()+interval '1 second' OR recent>clock_timestamp()+interval '1 second'
    OR (value->>'channel'='cookie' AND cap IS NOT NULL)
    OR (value->>'channel'='bearer' AND (cap IS NULL OR cap<=clock_timestamp()))
    OR (stored.channel='bearer' AND (value->>'channel'<>'bearer' OR cap IS DISTINCT FROM stored.hard_expires_at))
    OR (stored.channel='cookie' AND value->>'channel'='bearer' AND stored.authenticated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid session security';
  END IF;
  UPDATE auth.session SET channel=value->>'channel',hard_expires_at=cap,
    authenticated_at=authenticated,mfa_verified_at=mfa,reauthenticated_at=recent,
    active_organization_id=((value->>'activeOrganizationId')::uuid)::text,
    pending_organization_id=((value->>'pendingOrganizationId')::uuid)::text
    WHERE id=sid AND user_id=uid;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid session security' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION auth.lexon_write_session_security(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_write_session_security(jsonb) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_clear_disabled_mfa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
BEGIN
  IF OLD.two_factor_enabled AND NOT NEW.two_factor_enabled THEN
    UPDATE auth.session SET mfa_verified_at=NULL,reauthenticated_at=NULL WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_clear_disabled_mfa() FROM PUBLIC;
CREATE TRIGGER lexon_clear_disabled_mfa AFTER UPDATE OF two_factor_enabled ON auth."user"
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_clear_disabled_mfa();

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
    WHEN 'identity.security_changed.v1' THEN
      allowed_metadata := ARRAY['action'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['subjectUserId','actorUserId','sessionId']
        AND metadata->>'action' IN ('enrollment_started','disabled','recovery_regenerated','mfa_verified','reauthenticated');
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
