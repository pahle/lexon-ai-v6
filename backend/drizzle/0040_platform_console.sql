-- F4.3 platform console: cross-organization read path, account invitations,
-- audit validator. Read functions are STABLE; the lock and the invitation
-- write functions are VOLATILE (owner fix, plan Task 2).
CREATE INDEX user_created_at_id_idx ON auth."user" (created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX user_name_trgm_idx ON auth."user" USING GIN (lower(name) public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX user_email_trgm_idx ON auth."user" USING GIN (lower(email) public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX organization_team_created_idx ON auth.organization (created_at DESC, id DESC) WHERE kind = 'team';
--> statement-breakpoint
CREATE INDEX organization_name_trgm_idx ON auth.organization USING GIN (lower(name) public.gin_trgm_ops) WHERE kind = 'team';
--> statement-breakpoint
CREATE INDEX organization_slug_trgm_idx ON auth.organization USING GIN (lower(slug) public.gin_trgm_ops) WHERE kind = 'team';
--> statement-breakpoint
CREATE INDEX member_org_created_idx ON auth.member (organization_id, created_at, user_id);
--> statement-breakpoint
CREATE INDEX session_user_expires_idx ON auth.session (user_id, expires_at);
--> statement-breakpoint
CREATE TABLE auth.lexon_account_invitation (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email text NOT NULL,
  name text,
  token_digest text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth."user"(id),
  status text NOT NULL CHECK (status IN ('pending','accepted','cancelled')),
  sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_user_id uuid REFERENCES auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON TABLE auth.lexon_account_invitation FROM PUBLIC, lexon_auth, lexon_app;
--> statement-breakpoint
CREATE UNIQUE INDEX lexon_account_invitation_pending_email_idx ON auth.lexon_account_invitation (email) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX lexon_account_invitation_pending_sent_idx ON auth.lexon_account_invitation (sent_at DESC, id DESC) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX lexon_account_invitation_email_trgm_idx ON auth.lexon_account_invitation USING GIN (lower(email) public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX lexon_account_invitation_name_trgm_idx ON auth.lexon_account_invitation USING GIN (lower(coalesce(name, '')) public.gin_trgm_ops);
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_accounts(q text, statuses text[], two_factor boolean[], page_size int, page_offset int) RETURNS TABLE(id uuid, name text, email text, status text, two_factor_enabled boolean, is_platform_administrator boolean, team_count int, created_at timestamp, last_active_at timestamp, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
WITH filtered AS (
  SELECT u.id, u.name, u.email, CASE WHEN coalesce(u.banned, false) THEN 'disabled' WHEN NOT u.email_verified THEN 'unverified' ELSE 'active' END AS status,
    coalesce(u.two_factor_enabled, false) AS two_factor_enabled,
    coalesce(u.role = 'admin', false) AS is_platform_administrator, u.created_at
  FROM auth."user" u
  WHERE (q IS NULL OR lower(u.name) LIKE '%' || lower(q) || '%' ESCAPE '\' OR lower(u.email) LIKE '%' || lower(q) || '%' ESCAPE '\')
    AND (statuses IS NULL OR (CASE WHEN coalesce(u.banned, false) THEN 'disabled' WHEN NOT u.email_verified THEN 'unverified' ELSE 'active' END) = ANY (statuses))
    AND (two_factor IS NULL OR coalesce(u.two_factor_enabled, false) = ANY (two_factor))
), paged AS (
  SELECT f.*, count(*) OVER () AS total FROM filtered f
  WHERE page_size IN (10, 20, 50) AND page_offset >= 0
  ORDER BY f.created_at DESC, f.id DESC LIMIT page_size OFFSET page_offset
)
SELECT p.id, p.name, p.email, p.status, p.two_factor_enabled, p.is_platform_administrator,
  (SELECT count(*)::int FROM auth.member m JOIN auth.organization o ON o.id = m.organization_id WHERE m.user_id = p.id AND o.kind = 'team' AND o.state = 'active'), p.created_at, (SELECT max(s.updated_at) FROM auth.session s WHERE s.user_id = p.id), p.total
FROM paged p ORDER BY p.created_at DESC, p.id DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_accounts(text, text[], boolean[], int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_accounts(text, text[], boolean[], int, int) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_accounts_total(q text, statuses text[], two_factor boolean[]) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT count(*) FROM auth."user" u
  WHERE (q IS NULL OR lower(u.name) LIKE '%' || lower(q) || '%' ESCAPE '\' OR lower(u.email) LIKE '%' || lower(q) || '%' ESCAPE '\')
    AND (statuses IS NULL OR (CASE WHEN coalesce(u.banned, false) THEN 'disabled' WHEN NOT u.email_verified THEN 'unverified' ELSE 'active' END) = ANY (statuses))
    AND (two_factor IS NULL OR coalesce(u.two_factor_enabled, false) = ANY (two_factor))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_accounts_total(text, text[], boolean[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_accounts_total(text, text[], boolean[]) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_account(uid uuid) RETURNS TABLE(id uuid, name text, email text, status text, two_factor_enabled boolean, is_platform_administrator boolean, team_count int, created_at timestamp, last_active_at timestamp, email_verified boolean, active_session_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
WITH p AS (
  SELECT u.id, u.name, u.email, CASE WHEN coalesce(u.banned, false) THEN 'disabled' WHEN NOT u.email_verified THEN 'unverified' ELSE 'active' END AS status,
    coalesce(u.two_factor_enabled, false) AS two_factor_enabled,
    coalesce(u.role = 'admin', false) AS is_platform_administrator, u.created_at, u.email_verified
  FROM auth."user" u WHERE u.id = uid
)
SELECT p.id, p.name, p.email, p.status, p.two_factor_enabled, p.is_platform_administrator,
  (SELECT count(*)::int FROM auth.member m JOIN auth.organization o ON o.id = m.organization_id WHERE m.user_id = p.id AND o.kind = 'team' AND o.state = 'active'), p.created_at, (SELECT max(s.updated_at) FROM auth.session s WHERE s.user_id = p.id), p.email_verified,
  (SELECT count(*)::int FROM auth.session s WHERE s.user_id = p.id AND s.expires_at > now()
    AND (s.hard_expires_at IS NULL OR s.hard_expires_at > now()))
FROM p
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_account(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_account(uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_account_teams(uid uuid) RETURNS TABLE(organization_id uuid, name text, slug text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT o.id, o.name, o.slug, m.role FROM auth.member m
JOIN auth.organization o ON o.id = m.organization_id
WHERE m.user_id = uid AND o.kind = 'team' AND o.state = 'active'
ORDER BY o.name, o.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_account_teams(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_account_teams(uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_organizations(q text, states text[], page_size int, page_offset int) RETURNS TABLE(id uuid, name text, slug text, state text, member_count int, owner_email text, created_at timestamp, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
WITH paged AS (
  SELECT o.id, o.name, o.slug, o.state, o.created_at, count(*) OVER () AS total
  FROM auth.organization o
  WHERE o.kind = 'team'
    AND (states IS NULL OR o.state = ANY (states))
    AND (q IS NULL OR lower(o.name) LIKE '%' || lower(q) || '%' ESCAPE '\' OR lower(o.slug) LIKE '%' || lower(q) || '%' ESCAPE '\')
    AND page_size IN (10, 20, 50) AND page_offset >= 0
  ORDER BY o.created_at DESC, o.id DESC LIMIT page_size OFFSET page_offset
)
SELECT p.id, p.name, p.slug, p.state, (SELECT count(*)::int FROM auth.member m WHERE m.organization_id = p.id), CASE WHEN p.state = 'active' THEN
    (SELECT u.email FROM auth.member m JOIN auth."user" u ON u.id = m.user_id
      WHERE m.organization_id = p.id AND m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1)
  ELSE
    (SELECT i.email FROM auth.invitation i
      WHERE i.organization_id = p.id AND i.purpose = 'first_owner' AND i.replaced_by_invitation_id IS NULL LIMIT 1)
  END, p.created_at, p.total
FROM paged p ORDER BY p.created_at DESC, p.id DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_organizations(text, text[], int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_organizations(text, text[], int, int) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_organizations_total(q text, states text[]) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT count(*) FROM auth.organization o
  WHERE o.kind = 'team'
    AND (states IS NULL OR o.state = ANY (states))
    AND (q IS NULL OR lower(o.name) LIKE '%' || lower(q) || '%' ESCAPE '\' OR lower(o.slug) LIKE '%' || lower(q) || '%' ESCAPE '\')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_organizations_total(text, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_organizations_total(text, text[]) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_organization(org_id uuid) RETURNS TABLE(id uuid, name text, slug text, state text, member_count int, owner_email text, created_at timestamp, require2fa boolean, invitation_id uuid, invitation_status text, invitation_expires_at timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
WITH p AS (
  SELECT o.id, o.name, o.slug, o.state, o.created_at, o.require2fa FROM auth.organization o
  WHERE o.id = org_id AND o.kind = 'team'
)
SELECT p.id, p.name, p.slug, p.state, (SELECT count(*)::int FROM auth.member m WHERE m.organization_id = p.id), CASE WHEN p.state = 'active' THEN
    (SELECT u.email FROM auth.member m JOIN auth."user" u ON u.id = m.user_id
      WHERE m.organization_id = p.id AND m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1)
  ELSE
    (SELECT i.email FROM auth.invitation i
      WHERE i.organization_id = p.id AND i.purpose = 'first_owner' AND i.replaced_by_invitation_id IS NULL LIMIT 1)
  END, p.created_at,
  CASE WHEN p.state = 'active' THEN p.require2fa END,
  i.id, i.status, i.expires_at
FROM p LEFT JOIN auth.invitation i ON p.state = 'provisioning' AND i.organization_id = p.id
  AND i.purpose = 'first_owner' AND i.replaced_by_invitation_id IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_organization(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_organization(uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_members(org_id uuid, page_size int, page_offset int) RETURNS TABLE(user_id uuid, name text, email text, role text, joined_at timestamp, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT m.user_id, u.name, u.email, m.role, m.created_at, count(*) OVER () AS total
FROM auth.member m
JOIN auth."user" u ON u.id = m.user_id
JOIN auth.organization o ON o.id = m.organization_id AND o.kind = 'team'
WHERE m.organization_id = org_id
  AND page_size IN (10, 20, 50) AND page_offset >= 0
ORDER BY m.created_at ASC, m.user_id ASC LIMIT page_size OFFSET page_offset
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_members(uuid, int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_members(uuid, int, int) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_members_total(org_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT count(*)
FROM auth.member m
JOIN auth."user" u ON u.id = m.user_id
JOIN auth.organization o ON o.id = m.organization_id AND o.kind = 'team'
WHERE m.organization_id = org_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_members_total(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_members_total(uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_account_invitations(q text, statuses text[], page_size int, page_offset int) RETURNS TABLE(id uuid, email text, name text, status text, invited_by_name text, sent_at timestamptz, expires_at timestamptz, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT i.id, i.email, i.name, CASE WHEN i.expires_at > now() THEN 'pending' ELSE 'expired' END, u.name, i.sent_at, i.expires_at, count(*) OVER () AS total
FROM auth.lexon_account_invitation i JOIN auth."user" u ON u.id = i.invited_by
  WHERE i.status = 'pending'
    AND (statuses IS NULL OR (CASE WHEN i.expires_at > now() THEN 'pending' ELSE 'expired' END) = ANY (statuses))
    AND (q IS NULL OR lower(i.email) LIKE '%' || lower(q) || '%' ESCAPE '\' OR lower(coalesce(i.name, '')) LIKE '%' || lower(q) || '%' ESCAPE '\')
  AND page_size IN (10, 20, 50) AND page_offset >= 0
ORDER BY i.sent_at DESC, i.id DESC LIMIT page_size OFFSET page_offset
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_account_invitations(text, text[], int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_account_invitations(text, text[], int, int) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_account_invitations_total(q text, statuses text[]) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
SELECT count(*) FROM auth.lexon_account_invitation i
  WHERE i.status = 'pending'
    AND (statuses IS NULL OR (CASE WHEN i.expires_at > now() THEN 'pending' ELSE 'expired' END) = ANY (statuses))
    AND (q IS NULL OR lower(i.email) LIKE '%' || lower(q) || '%' ESCAPE '\' OR lower(coalesce(i.name, '')) LIKE '%' || lower(q) || '%' ESCAPE '\')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_account_invitations_total(text, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_account_invitations_total(text, text[]) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_platform_lock_enabled_admins() RETURNS TABLE(id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
  SELECT u.id FROM auth."user" u WHERE u.role = 'admin' AND NOT coalesce(u.banned, false)
  ORDER BY u.id FOR UPDATE
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_platform_lock_enabled_admins() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_platform_lock_enabled_admins() TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_create_account_invitation(p_email text, p_name text, p_token_digest text, p_invited_by uuid)
RETURNS TABLE(id uuid, email text, name text, status text, invited_by_name text, sent_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
#variable_conflict use_column
DECLARE normalized text := lower(btrim($1));
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account-invitation:' || normalized));
  -- One path for "account exists" and "pending invitation exists": no row either way.
  IF EXISTS (SELECT 1 FROM auth."user" u WHERE lower(u.email) = normalized)
    OR EXISTS (SELECT 1 FROM auth.lexon_account_invitation i
      WHERE i.email = normalized AND i.status = 'pending' AND i.expires_at > now()) THEN
    RETURN;
  END IF;
  UPDATE auth.lexon_account_invitation i SET status = 'cancelled', updated_at = now()
    WHERE i.email = normalized AND i.status = 'pending' AND i.expires_at <= now();
  RETURN QUERY
  WITH created AS (
    INSERT INTO auth.lexon_account_invitation (email, name, token_digest, invited_by, status, sent_at, expires_at)
    VALUES (normalized, $2, $3, $4, 'pending', now(), now() + interval '7 days')
    RETURNING auth.lexon_account_invitation.id, auth.lexon_account_invitation.email,
      auth.lexon_account_invitation.name, auth.lexon_account_invitation.status,
      auth.lexon_account_invitation.invited_by, auth.lexon_account_invitation.sent_at,
      auth.lexon_account_invitation.expires_at
  )
  SELECT c.id, c.email, c.name, c.status, u.name, c.sent_at, c.expires_at
  FROM created c JOIN auth."user" u ON u.id = c.invited_by;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_create_account_invitation(text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_create_account_invitation(text, text, text, uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_resend_account_invitation(p_id uuid, p_token_digest text)
RETURNS TABLE(id uuid, email text, name text, status text, invited_by_name text, sent_at timestamptz, expires_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
  WITH resent AS (
    UPDATE auth.lexon_account_invitation i
    SET token_digest = $2, sent_at = now(), expires_at = now() + interval '7 days', updated_at = now()
    WHERE i.id = $1 AND i.status = 'pending'
    RETURNING i.id, i.email, i.name, i.status, i.invited_by, i.sent_at, i.expires_at
  )
  SELECT r.id, r.email, r.name, r.status, u.name, r.sent_at, r.expires_at
  FROM resent r JOIN auth."user" u ON u.id = r.invited_by
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_resend_account_invitation(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_resend_account_invitation(uuid, text) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_cancel_account_invitation(id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
  WITH cancelled AS (
    UPDATE auth.lexon_account_invitation i SET status = 'cancelled', updated_at = now()
    WHERE i.id = $1 AND i.status = 'pending' RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM cancelled)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_cancel_account_invitation(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_cancel_account_invitation(uuid) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_account_invitation_signup_facts(digest text)
RETURNS TABLE(id uuid, email text, name text, usable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
  SELECT i.id, i.email, i.name, (i.status = 'pending' AND i.expires_at > now())
  FROM auth.lexon_account_invitation i WHERE i.token_digest = $1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_account_invitation_signup_facts(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_account_invitation_signup_facts(text) TO lexon_auth;
--> statement-breakpoint
CREATE FUNCTION auth.lexon_accept_account_invitation(digest text, user_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, auth, pg_temp AS $$
#variable_conflict use_column
DECLARE invitation_id uuid;
BEGIN
  SELECT i.id INTO invitation_id FROM auth.lexon_account_invitation i
  JOIN auth."user" u ON u.id = $2 AND lower(u.email) = i.email
  WHERE i.token_digest = $1 AND i.status = 'pending' AND i.expires_at > now()
  FOR UPDATE OF i;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE auth.lexon_account_invitation i SET status = 'accepted', accepted_user_id = $2, updated_at = now()
    WHERE i.id = invitation_id;
  UPDATE auth."user" u SET email_verified = true, updated_at = now() WHERE u.id = $2;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth.lexon_accept_account_invitation(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.lexon_accept_account_invitation(text, uuid) TO lexon_auth;
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
    WHEN 'platform.user_sessions_revoked.v1' THEN
      allowed_metadata := ARRAY[]::text[];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','subjectUserId'];
    WHEN 'platform.verification_email_resent.v1' THEN
      allowed_metadata := ARRAY[]::text[];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','subjectUserId'];
    WHEN 'platform.organization_members_viewed.v1' THEN
      allowed_metadata := ARRAY['page'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','orgId']
        AND jsonb_typeof(metadata->'page')='number' AND metadata->>'page' ~ '^[1-9][0-9]{0,8}$';
    WHEN 'platform.account_invitation_created.v1' THEN
      allowed_metadata := ARRAY[]::text[];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','invitationId'];
    WHEN 'platform.account_invitation_resent.v1' THEN
      allowed_metadata := ARRAY[]::text[];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','invitationId'];
    WHEN 'platform.account_invitation_cancelled.v1' THEN
      allowed_metadata := ARRAY[]::text[];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','invitationId'];
    WHEN 'platform.account_invitation_accepted.v1' THEN
      allowed_metadata := ARRAY['invitationId'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['actorUserId','subjectUserId']
        AND event->>'actorUserId' = event->>'subjectUserId'
        AND jsonb_typeof(metadata->'invitationId')='string'
        AND metadata->>'invitationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
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
