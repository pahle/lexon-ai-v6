DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lexon_setup') THEN
  CREATE ROLE lexon_setup LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO lexon_setup;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_admin_setup_operator_facts(target_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE grant_row auth.verification%ROWTYPE; uid uuid; initial_email text;
BEGIN
 PERFORM pg_advisory_xact_lock(1976301,16);
 SELECT id INTO uid FROM auth."user" WHERE email=target_email FOR UPDATE;
 SELECT * INTO grant_row FROM auth.verification WHERE identifier LIKE 'lexon.admin-setup.v1:%'
  AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'email'=target_email AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'status'='pending' ORDER BY expires_at DESC LIMIT 1;
 SELECT (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'email' INTO initial_email FROM auth.verification
  WHERE identifier LIKE 'lexon.admin-setup.v1:%' AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'status'='pending'
  AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'additional'='false' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1;
 RETURN jsonb_build_object('adminExists',EXISTS(SELECT 1 FROM auth."user" WHERE role='admin'),'userId',uid,'pendingInitialEmail',initial_email,
  'grant',CASE WHEN grant_row.id IS NULL THEN NULL ELSE jsonb_build_object('id',grant_row.id,'identifier',grant_row.identifier,'value',grant_row.value,'expiresAt',grant_row.expires_at AT TIME ZONE 'UTC') END);
END $$;
REVOKE ALL ON FUNCTION auth.lexon_admin_setup_operator_facts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_admin_setup_operator_facts(text) TO lexon_setup;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_begin_admin_setup(input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE actual jsonb; grant_data jsonb:=input->'grant'; body jsonb; grant_id uuid;
BEGIN
 IF jsonb_typeof(input)<>'object' OR input->>'email' IS DISTINCT FROM lower(btrim(input->>'email')) OR input->'event'->>'type'<>'platform.admin_setup_invoked.v1' THEN RAISE EXCEPTION 'Invalid setup command'; END IF;
 actual:=auth.lexon_admin_setup_operator_facts(input->>'email');
 IF actual IS DISTINCT FROM input->'expected' THEN RAISE EXCEPTION 'Setup state changed' USING ERRCODE='40001'; END IF;
 IF grant_data<>'null'::jsonb THEN
  UPDATE auth.verification SET value=(value::jsonb||jsonb_build_object('status','expired'))::text WHERE identifier LIKE 'lexon.admin-setup.v1:%' AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'status'='pending' AND expires_at<=now() AND id IS DISTINCT FROM (actual->'grant'->>'id')::uuid;
  body:=(grant_data->>'value')::jsonb;grant_id:=(grant_data->>'id')::uuid;
  IF (SELECT count(*) FROM jsonb_object_keys(grant_data))<>4 OR NOT(grant_data ?& ARRAY['id','identifier','value','expiresAt']) OR (SELECT count(*) FROM jsonb_object_keys(body))<>5 OR NOT(body ?& ARRAY['version','email','status','additional','boundUserId']) THEN RAISE EXCEPTION 'Invalid setup grant'; END IF;
  IF grant_data->>'identifier' !~ '^lexon[.]admin-setup[.]v1:[a-f0-9]{64}$' OR body->>'email' IS DISTINCT FROM input->>'email'
   OR body->>'status'<>'pending' OR body->'version'<>'1'::jsonb OR jsonb_typeof(body->'additional')<>'boolean'
   OR body->'boundUserId' IS DISTINCT FROM actual->'userId' OR (grant_data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Invalid setup grant'; END IF;
  IF actual->'grant'<>'null'::jsonb THEN
   UPDATE auth.verification SET identifier=grant_data->>'identifier',value=grant_data->>'value',expires_at=(grant_data->>'expiresAt')::timestamptz AT TIME ZONE 'UTC',updated_at=now()
    WHERE id=grant_id AND id=(actual->'grant'->>'id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Setup state changed'; END IF;
  ELSE
   INSERT INTO auth.verification(id,identifier,value,expires_at,created_at,updated_at)
    VALUES(grant_id,grant_data->>'identifier',grant_data->>'value',(grant_data->>'expiresAt')::timestamptz AT TIME ZONE 'UTC',now(),now());
  END IF;
 END IF;
 PERFORM auth.lexon_append_audit(input->'event');
END $$;
REVOKE ALL ON FUNCTION auth.lexon_begin_admin_setup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_begin_admin_setup(jsonb) TO lexon_setup;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_lock_admin_setup(digest text,uid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,auth,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1976301,16);
 PERFORM id FROM auth."user" WHERE id=uid FOR UPDATE;
 PERFORM id FROM auth.verification WHERE identifier='lexon.admin-setup.v1:'||digest FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_lock_admin_setup(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_lock_admin_setup(text,uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_consume_admin_setup(digest text,uid uuid,expected_value text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE record auth.verification%ROWTYPE; email_value text;
BEGIN
 PERFORM auth.lexon_lock_admin_setup(digest,uid);
 SELECT email INTO email_value FROM auth."user" WHERE id=uid;
 SELECT * INTO record FROM auth.verification WHERE identifier='lexon.admin-setup.v1:'||digest;
 IF NOT FOUND OR record.value IS DISTINCT FROM expected_value THEN RETURN false; END IF;
 UPDATE auth.verification SET value=(record.value::jsonb||jsonb_build_object('status','complete','boundUserId',uid))::text,updated_at=now() WHERE id=record.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_consume_admin_setup(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_consume_admin_setup(text,uuid,text) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_protect_setup_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,auth,pg_temp AS $$
BEGIN
 IF current_user<>'lexon_migrator' AND (NEW.identifier LIKE 'lexon.admin-setup.v1:%' OR (TG_OP='UPDATE' AND OLD.identifier LIKE 'lexon.admin-setup.v1:%')) THEN
  RAISE EXCEPTION 'Protected setup grant' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_protect_setup_grant() FROM PUBLIC;
CREATE TRIGGER lexon_protect_setup_grant BEFORE INSERT OR UPDATE ON auth.verification
 FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_setup_grant();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_setup_has_team(uid uuid) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog,auth,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM auth.member m JOIN auth.organization o ON o.id=m.organization_id WHERE m.user_id=uid AND o.kind='team')
$$;
REVOKE ALL ON FUNCTION auth.lexon_setup_has_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_setup_has_team(uuid) TO lexon_auth;

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
    WHEN 'platform.admin_activated.v1' THEN
      allowed_metadata:=ARRAY['additional'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['actorUserId','subjectUserId','sessionId'] AND jsonb_typeof(metadata->'additional')='boolean';
    WHEN 'platform.provisioning_changed.v1' THEN
      allowed_metadata:=ARRAY['action'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['actorUserId','orgId','invitationId'] AND metadata->>'action' IN ('created','resent','owner_replaced','cancelled');
    WHEN 'platform.user_disabled_changed.v1' THEN
      allowed_metadata:=ARRAY['disabled'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['actorUserId','subjectUserId'] AND jsonb_typeof(metadata->'disabled')='boolean';
    WHEN 'identity.session_changed.v1' THEN
      allowed_metadata:=ARRAY['action'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['actorUserId','subjectUserId','sessionId'] AND metadata->>'action' IN ('bearer_issued','revoked');
    WHEN 'organization.member_departed.v1' THEN
      allowed_metadata:=ARRAY['reason'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId','memberId'] AND metadata->>'reason' IN ('leave','remove');
    WHEN 'organization.member_role_changed.v1' THEN
      allowed_metadata:=ARRAY['previousRole','role'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId','memberId'] AND metadata->>'previousRole' IN ('member','admin','owner') AND metadata->>'role' IN ('member','admin','owner');
    WHEN 'organization.invitation_changed.v1' THEN
      allowed_metadata:=ARRAY['action'];
      valid:=event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','invitationId']
        AND metadata->>'action' IN ('created','resent','cancelled','declined','accepted','expired_replaced');
    WHEN 'organization.settings_changed.v1' THEN
      allowed_metadata := ARRAY['fields'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId']
        AND jsonb_typeof(metadata->'fields')='array' AND jsonb_array_length(metadata->'fields') BETWEEN 1 AND 3
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(metadata->'fields') AS entries(value) WHERE entries.value NOT IN ('"name"'::jsonb,'"slug"'::jsonb,'"require2fa"'::jsonb))
        AND (SELECT count(DISTINCT entries.value) FROM jsonb_array_elements(metadata->'fields') AS entries(value))=jsonb_array_length(metadata->'fields');
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


--> statement-breakpoint
CREATE UNIQUE INDEX lexon_single_pending_initial_setup ON auth.verification((true))
 WHERE identifier LIKE 'lexon.admin-setup.v1:%' AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'status'='pending'
 AND (CASE WHEN identifier LIKE 'lexon.admin-setup.v1:%' THEN value::jsonb ELSE '{}'::jsonb END)->>'additional'='false';
