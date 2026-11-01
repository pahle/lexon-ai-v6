ALTER TABLE auth.organization
  ADD COLUMN policy_version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT organization_state_valid CHECK (state IN ('active','provisioning'));
ALTER TABLE auth.member
  ADD CONSTRAINT member_role_valid CHECK (role IN ('owner','admin','member')),
  ADD CONSTRAINT member_user_organization_unique UNIQUE (organization_id,user_id);
ALTER TABLE auth.invitation ALTER COLUMN role SET NOT NULL;
ALTER TABLE auth.invitation
  ADD CONSTRAINT invitation_purpose_role_valid CHECK (
    (purpose='team' AND role IN ('member','admin')) OR (purpose='first_owner' AND role='owner')),
  ADD CONSTRAINT invitation_status_valid CHECK (status IN ('pending','accepted','rejected','canceled'));
CREATE UNIQUE INDEX invitation_current_first_owner_unique ON auth.invitation(organization_id)
  WHERE purpose='first_owner' AND replaced_by_invitation_id IS NULL;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_lock_organization(org_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE organization_kind text;
BEGIN
  SELECT kind INTO organization_kind FROM auth.organization WHERE id=org_id FOR UPDATE;
  IF organization_kind='team' THEN
    -- A real row version change forces repeatable-read transactions to retry;
    -- a row lock alone would leave their owner-count snapshot stale.
    UPDATE auth.organization SET policy_version=policy_version+1 WHERE id=org_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_lock_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_lock_organization(uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_fence_organization_children() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE previous_id uuid; next_id uuid; locked_id uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN previous_id:=OLD.organization_id; END IF;
  IF TG_OP<>'DELETE' THEN next_id:=NEW.organization_id; END IF;
  FOR locked_id IN SELECT DISTINCT id FROM unnest(ARRAY[previous_id,next_id]) id WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM auth.lexon_lock_organization(locked_id);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_fence_organization_children() FROM PUBLIC;
CREATE TRIGGER lexon_fence_organization_children BEFORE INSERT OR UPDATE OR DELETE ON auth.member
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_fence_organization_children();
CREATE TRIGGER lexon_fence_organization_children BEFORE INSERT OR UPDATE OR DELETE ON auth.invitation
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_fence_organization_children();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_check_team(org_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE organization_state text;
BEGIN
  SELECT state INTO organization_state FROM auth.organization WHERE id=org_id AND kind='team';
  IF NOT FOUND THEN RETURN; END IF;
  IF organization_state='active' THEN
    IF NOT EXISTS(SELECT 1 FROM auth.member WHERE organization_id=org_id AND role='owner') THEN
      RAISE EXCEPTION 'Active team requires an owner' USING ERRCODE='23514',CONSTRAINT='lexon_team_owner';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM auth.member WHERE organization_id=org_id)
      OR (SELECT count(*) FROM auth.invitation WHERE organization_id=org_id AND purpose='first_owner' AND replaced_by_invitation_id IS NULL)<>1
      OR EXISTS(SELECT 1 FROM auth.invitation WHERE organization_id=org_id AND purpose='first_owner' AND replaced_by_invitation_id IS NULL AND status NOT IN ('pending','rejected')) THEN
      RAISE EXCEPTION 'Invalid provisioning organization' USING ERRCODE='23514',CONSTRAINT='lexon_team_provisioning';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_check_team(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_validate_team() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='organization' THEN
    IF TG_OP<>'DELETE' THEN PERFORM auth.lexon_check_team(NEW.id); END IF;
    IF TG_OP<>'INSERT' THEN PERFORM auth.lexon_check_team(OLD.id); END IF;
  ELSE
    IF TG_OP<>'DELETE' THEN PERFORM auth.lexon_check_team(NEW.organization_id); END IF;
    IF TG_OP<>'INSERT' THEN PERFORM auth.lexon_check_team(OLD.organization_id); END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_team() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER lexon_validate_team AFTER INSERT OR UPDATE OR DELETE ON auth.organization
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_team();
CREATE CONSTRAINT TRIGGER lexon_validate_team AFTER INSERT OR UPDATE OR DELETE ON auth.member
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_team();
CREATE CONSTRAINT TRIGGER lexon_validate_team AFTER INSERT OR UPDATE OR DELETE ON auth.invitation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_team();
--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION auth.lexon_protect_team_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,auth,pg_temp AS $$
BEGIN
  IF OLD.kind='team' AND (OLD.state<>'provisioning' OR current_user<>'lexon_migrator') THEN
    RAISE EXCEPTION 'Organization deletion unavailable' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_protect_team_delete() FROM PUBLIC;
CREATE TRIGGER lexon_protect_team_delete BEFORE DELETE ON auth.organization
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_team_delete();


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
