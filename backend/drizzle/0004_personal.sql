ALTER TABLE auth.organization
  ALTER COLUMN personal_owner_id TYPE uuid USING personal_owner_id::uuid,
  ADD CONSTRAINT organization_personal_owner_unique UNIQUE (personal_owner_id),
  ADD CONSTRAINT organization_personal_owner_fk FOREIGN KEY (personal_owner_id) REFERENCES auth."user"(id),
  ADD CONSTRAINT organization_personal_shape CHECK (
    (kind = 'personal' AND personal_owner_id IS NOT NULL AND state = 'active'
      AND name = 'Personal' AND require2fa = false)
    OR (kind = 'team' AND personal_owner_id IS NULL)
  );
--> statement-breakpoint
CREATE FUNCTION auth.lexon_create_personal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE personal_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.organization (id, name, slug, created_at, kind, state, require2fa, personal_owner_id)
    VALUES (personal_id, 'Personal', 'personal-' || NEW.id::text, CURRENT_TIMESTAMP, 'personal', 'active', false, NEW.id);
  INSERT INTO auth.member (id, organization_id, user_id, role, created_at)
    VALUES (pg_catalog.gen_random_uuid(), personal_id, NEW.id, 'owner', CURRENT_TIMESTAMP);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_create_personal() FROM PUBLIC;
CREATE TRIGGER lexon_create_personal AFTER INSERT ON auth."user"
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_create_personal();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_protect_personal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'organization' THEN
    IF OLD.kind = 'personal' AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Personal organization is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'member' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT personal_owner_id INTO owner_id FROM auth.organization WHERE id = OLD.organization_id;
      IF owner_id IS NOT NULL AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION 'Personal membership is immutable' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT personal_owner_id INTO owner_id FROM auth.organization WHERE id = NEW.organization_id;
      IF owner_id IS NOT NULL AND (NEW.user_id <> owner_id OR NEW.role <> 'owner') THEN
        RAISE EXCEPTION 'Personal membership must be its owner' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'invitation' THEN
    IF EXISTS (SELECT 1 FROM auth.organization WHERE id = NEW.organization_id AND kind = 'personal') THEN
      RAISE EXCEPTION 'Personal invitations are forbidden' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_protect_personal() FROM PUBLIC;
CREATE TRIGGER lexon_protect_personal BEFORE UPDATE OR DELETE ON auth.organization
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_personal();
CREATE TRIGGER lexon_protect_personal BEFORE INSERT OR UPDATE OR DELETE ON auth.member
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_personal();
CREATE TRIGGER lexon_protect_personal BEFORE INSERT OR UPDATE ON auth.invitation
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_personal();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_check_personal(owner_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE personal_id uuid;
BEGIN
  IF owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth."user" WHERE id = owner_id) THEN RETURN; END IF;
  SELECT id INTO personal_id FROM auth.organization WHERE personal_owner_id = owner_id AND kind = 'personal';
  IF personal_id IS NULL
    OR (SELECT count(*) FROM auth.member WHERE organization_id = personal_id) <> 1
    OR NOT EXISTS (SELECT 1 FROM auth.member WHERE organization_id = personal_id AND user_id = owner_id AND role = 'owner')
    OR EXISTS (SELECT 1 FROM auth.invitation WHERE organization_id = personal_id) THEN
    RAISE EXCEPTION 'Account requires exactly one Personal owner membership' USING ERRCODE = '23514';
  END IF;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_check_personal(uuid) FROM PUBLIC;
CREATE FUNCTION auth.lexon_validate_personal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'user' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM auth.lexon_check_personal(NEW.id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM auth.lexon_check_personal(OLD.id); END IF;
  ELSIF TG_TABLE_NAME = 'organization' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM auth.lexon_check_personal(NEW.personal_owner_id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM auth.lexon_check_personal(OLD.personal_owner_id); END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN
      SELECT personal_owner_id INTO owner_id FROM auth.organization WHERE id = NEW.organization_id;
      PERFORM auth.lexon_check_personal(owner_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      SELECT personal_owner_id INTO owner_id FROM auth.organization WHERE id = OLD.organization_id;
      PERFORM auth.lexon_check_personal(owner_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_validate_personal() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER lexon_validate_personal AFTER INSERT OR UPDATE OR DELETE ON auth."user"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_personal();
CREATE CONSTRAINT TRIGGER lexon_validate_personal AFTER INSERT OR UPDATE OR DELETE ON auth.organization
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_personal();
CREATE CONSTRAINT TRIGGER lexon_validate_personal AFTER INSERT OR UPDATE OR DELETE ON auth.member
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.lexon_validate_personal();
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO lexon_app;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM lexon_app;
GRANT SELECT (id, email_verified, two_factor_enabled, role, banned) ON auth."user" TO lexon_app;
GRANT SELECT (id, name, slug, kind, state, require2fa, personal_owner_id) ON auth.organization TO lexon_app;
GRANT SELECT (id, user_id, organization_id, role) ON auth.member TO lexon_app;
