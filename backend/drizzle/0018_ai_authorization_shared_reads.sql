-- AI worker authorization is a short-lived capability check. Shared reads
-- preserve conflicts with identity/membership changes while allowing more
-- than one run for the same actor to authorize at the same time.
CREATE OR REPLACE FUNCTION auth.lexon_ai_actor_facts(input_org_id uuid, input_user_id uuid)
RETURNS TABLE (
  actor_user_id uuid,
  email_verified boolean,
  banned boolean,
  two_factor_enabled boolean,
  membership_role text,
  organization_kind text,
  organization_state text,
  require2fa boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,pg_temp AS $$
DECLARE
  context_org text;
  context_user text;
  org_kind text;
  org_state text;
  org_require2fa boolean;
  user_email_verified boolean;
  user_banned boolean;
  user_two_factor_enabled boolean;
  member_role text;
BEGIN
  context_org := NULLIF(current_setting('app.org_id', true), '');
  context_user := NULLIF(current_setting('app.user_id', true), '');
  IF context_org IS NULL OR context_user IS NULL
    OR context_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR context_user !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR context_org::uuid IS DISTINCT FROM input_org_id
    OR context_user::uuid IS DISTINCT FROM input_user_id THEN
    RETURN;
  END IF;

  SELECT o.kind, o.state, o.require2fa
    INTO org_kind, org_state, org_require2fa
    FROM auth.organization AS o
    WHERE o.id = input_org_id
    FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT u.email_verified, u.banned, u.two_factor_enabled
    INTO user_email_verified, user_banned, user_two_factor_enabled
    FROM auth."user" AS u
    WHERE u.id = input_user_id
    FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT m.role INTO member_role
    FROM auth.member AS m
    WHERE m.organization_id = input_org_id AND m.user_id = input_user_id
    FOR SHARE;

  actor_user_id := input_user_id;
  email_verified := user_email_verified;
  banned := user_banned;
  two_factor_enabled := user_two_factor_enabled;
  membership_role := member_role;
  organization_kind := org_kind;
  organization_state := org_state;
  require2fa := org_require2fa;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION auth.lexon_ai_actor_facts(uuid, uuid) FROM PUBLIC, lexon_auth;
GRANT EXECUTE ON FUNCTION auth.lexon_ai_actor_facts(uuid, uuid) TO lexon_app;
--> statement-breakpoint
-- Preserve exact provider cost decimals instead of numeric(20,10)'s implicit rounding.
ALTER TABLE app.ai_attempts
  ALTER COLUMN cost_usd TYPE numeric USING cost_usd::numeric;
ALTER TABLE app.ai_attempts
  ADD CONSTRAINT ai_attempts_cost_usd_finite_nonnegative
  CHECK (cost_usd IS NULL OR (cost_usd >= 0 AND cost_usd < 'Infinity'::numeric));
