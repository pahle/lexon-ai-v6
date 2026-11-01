ALTER TABLE auth.session
  ADD COLUMN selection_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN active_organization_name text;
UPDATE auth.session s SET active_organization_id=o.id::text
  FROM auth.organization o WHERE o.personal_owner_id=s.user_id AND o.kind='personal' AND s.active_organization_id IS NULL;
UPDATE auth.session s SET active_organization_name=(
  SELECT o.name FROM auth.organization o JOIN auth.member m ON m.organization_id=o.id
  WHERE o.id::text=s.active_organization_id AND m.user_id=s.user_id AND o.state='active');
ALTER TABLE auth.session ALTER COLUMN active_organization_id SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_protect_session_selection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE selected_name text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.active_organization_id IS NULL THEN
      SELECT id::text INTO NEW.active_organization_id FROM auth.organization
        WHERE personal_owner_id=NEW.user_id AND kind='personal';
    END IF;
    NEW.selection_version:=0;
    IF current_user<>'lexon_migrator' THEN NEW.pending_organization_id:=NULL; END IF;
  ELSE
    -- Native leave clears its selection. Keep the former pointer until the
    -- next verified request repairs it, preserving the safe fallback reason.
    IF NEW.active_organization_id IS NULL THEN NEW.active_organization_id:=OLD.active_organization_id; END IF;
    IF current_user<>'lexon_migrator' AND ROW(NEW.selection_version,NEW.active_organization_name,NEW.pending_organization_id)
      IS DISTINCT FROM ROW(OLD.selection_version,OLD.active_organization_name,OLD.pending_organization_id) THEN
      RAISE EXCEPTION 'Protected selection fields' USING ERRCODE='23514';
    END IF;
    IF NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
      OR NEW.pending_organization_id IS DISTINCT FROM OLD.pending_organization_id THEN NEW.selection_version:=OLD.selection_version+1; END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id THEN
    SELECT o.name INTO selected_name FROM auth.organization o JOIN auth.member m ON m.organization_id=o.id
      WHERE o.id::text=NEW.active_organization_id AND m.user_id=NEW.user_id AND o.state='active';
    IF selected_name IS NULL THEN RAISE EXCEPTION 'Invalid active organization' USING ERRCODE='23514'; END IF;
    NEW.active_organization_name:=selected_name;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_protect_session_selection() FROM PUBLIC;
CREATE TRIGGER lexon_protect_session_selection BEFORE INSERT OR UPDATE ON auth.session
  FOR EACH ROW EXECUTE FUNCTION auth.lexon_protect_session_selection();
--> statement-breakpoint
CREATE FUNCTION auth.lexon_lock_selection(target_user_id uuid,target_session_id uuid,target_org_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE current_org text; pending_org text; locked_id uuid;
BEGIN
  PERFORM id FROM auth."user" WHERE id=target_user_id FOR UPDATE;
  SELECT active_organization_id,pending_organization_id INTO current_org,pending_org FROM auth.session
    WHERE id=target_session_id AND user_id=target_user_id FOR UPDATE;
  -- Shared parent locks protect the membership snapshot while allowing other
  -- readers and session switches. Membership writers use the exclusive fence.
  FOR locked_id IN SELECT id FROM auth.organization WHERE id=target_org_id OR id::text=current_org
    OR id::text=pending_org OR personal_owner_id=target_user_id ORDER BY id FOR SHARE LOOP
    NULL;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_lock_selection(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_lock_selection(uuid,uuid,uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_write_selection(target_user_id uuid,target_session_id uuid,expected_org text,expected_version bigint,
  selected_org uuid,pending_org uuid,expected_member uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE stored auth.session%ROWTYPE;
BEGIN
  PERFORM auth.lexon_lock_selection(target_user_id,target_session_id,coalesce(pending_org,selected_org));
  SELECT * INTO stored FROM auth.session WHERE id=target_session_id AND user_id=target_user_id;
  IF NOT FOUND OR stored.active_organization_id IS DISTINCT FROM expected_org OR stored.selection_version<>expected_version THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.member m JOIN auth.organization o ON o.id=m.organization_id
      WHERE m.id=expected_member AND m.user_id=target_user_id AND o.id=coalesce(pending_org,selected_org) AND o.state='active')
    OR NOT EXISTS(SELECT 1 FROM auth.member m JOIN auth.organization o ON o.id=m.organization_id
      WHERE m.user_id=target_user_id AND o.id=selected_org AND o.state='active') THEN RETURN false; END IF;
  UPDATE auth.session SET active_organization_id=selected_org::text,pending_organization_id=pending_org::text
    WHERE id=target_session_id AND user_id=target_user_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION auth.lexon_write_selection(uuid,uuid,text,bigint,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lexon_write_selection(uuid,uuid,text,bigint,uuid,uuid,uuid) TO lexon_auth;
