-- F6 task 8 — project deletion: the audit validator gains
-- project.deleted.v1 ({projectId, chatCount}; the chat.% row-trigger
-- dispatch is replayed unchanged) and ops.project_delete performs the
-- one-transaction tombstone + cascade the spec §8 requires.
-- F6 task 7 — standalone-chat sharing: the validator gains the
-- chat.shared/share_revoked pair (ids only: subject + chatId).
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
    WHEN 'project.created.v1' THEN
      allowed_metadata := ARRAY['projectId'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    WHEN 'project.settings_changed.v1' THEN
      allowed_metadata := ARRAY['projectId','fields'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND jsonb_typeof(metadata->'fields')='array' AND jsonb_array_length(metadata->'fields') BETWEEN 1 AND 3
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(metadata->'fields') AS entries(value) WHERE entries.value NOT IN ('"name"'::jsonb,'"matterNumber"'::jsonb,'"practiceArea"'::jsonb))
        AND (SELECT count(DISTINCT entries.value) FROM jsonb_array_elements(metadata->'fields') AS entries(value))=jsonb_array_length(metadata->'fields');
    WHEN 'project.instructions_changed.v1' THEN
      allowed_metadata := ARRAY['projectId','action'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND metadata->>'action' IN ('set','cleared');
    WHEN 'project.member_added.v1' THEN
      allowed_metadata := ARRAY['projectId','role'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId','memberId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND metadata->>'role' IN ('viewer','editor');
    WHEN 'project.member_role_changed.v1' THEN
      allowed_metadata := ARRAY['projectId','previousRole','role'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId','memberId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND metadata->>'previousRole' IN ('viewer','editor') AND metadata->>'role' IN ('viewer','editor');
    WHEN 'project.member_removed.v1' THEN
      allowed_metadata := ARRAY['projectId','reason'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId','memberId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (NOT (metadata ? 'reason') OR metadata->>'reason'='deny');
    WHEN 'project.deny_added.v1' THEN
      allowed_metadata := ARRAY['projectId','setByUserId'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND jsonb_typeof(metadata->'setByUserId')='string'
        AND metadata->>'setByUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    WHEN 'project.deny_lifted.v1' THEN
      allowed_metadata := ARRAY['projectId','setByUserId'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND jsonb_typeof(metadata->'setByUserId')='string'
        AND metadata->>'setByUserId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    WHEN 'chat.shared.v1' THEN
      allowed_metadata := ARRAY['chatId'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId']
        AND jsonb_typeof(metadata->'chatId')='string'
        AND metadata->>'chatId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    WHEN 'chat.share_revoked.v1' THEN
      allowed_metadata := ARRAY['chatId'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId','subjectUserId']
        AND jsonb_typeof(metadata->'chatId')='string'
        AND metadata->>'chatId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    WHEN 'project.deleted.v1' THEN
      allowed_metadata := ARRAY['projectId','chatCount'];
      valid := event->>'outcome'='success' AND event ?& ARRAY['orgId','actorUserId']
        AND jsonb_typeof(metadata->'projectId')='string'
        AND metadata->>'projectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND jsonb_typeof(metadata->'chatCount')='number';
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

-- chat.shared/share_revoked are org-governance events (subject +
-- chatId metadata): they route to lexon_validate_audit before the
-- chat.% AI fallback claims them.
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
  ELSIF NEW.type IN ('chat.shared.v1','chat.share_revoked.v1') THEN
    PERFORM auth.lexon_validate_audit(event);
  ELSIF NEW.type LIKE 'chat.%' THEN
    PERFORM auth.lexon_validate_ai_audit(event);
  ELSE
    PERFORM auth.lexon_validate_audit(event);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- F6 task 8 — project deletion (spec §8): one claims-bound definer owns the
-- whole tombstone transaction because the per-chat fence
-- (ops.ai_mark_chat_deleted / ops.ai_chat_begin_delete_cancel) verifies
-- caller = chat owner — member chats would refuse. Returns the deleted
-- chat list ({chatId,ownerUserId,runIds}) so the service can emit the same
-- post-commit signals as single-chat delete; NULL when the caller is not
-- the project owner (or the claims/project are absent).
CREATE FUNCTION ops.project_delete(input_org_id uuid,input_user_id uuid,input_project_id uuid,input_grace_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $$
DECLARE
  context_org uuid; context_user uuid;
  locked_project app.projects%ROWTYPE;
  chat_row app.chats%ROWTYPE;
  chat_run_ids uuid[];
  chat_permit_refs jsonb;
  run_id uuid;
  chats jsonb := '[]'::jsonb;
BEGIN
  context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
  context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
  IF context_org IS NULL OR context_user IS NULL OR input_project_id IS NULL
    OR context_org IS DISTINCT FROM input_org_id OR context_user IS DISTINCT FROM input_user_id
    OR input_grace_ms IS NULL OR input_grace_ms < 1
    OR NOT ops.lexon_org_member(input_org_id,input_user_id) THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:' || context_org::text,0));
  SELECT * INTO locked_project FROM app.projects
    WHERE org_id=context_org AND id=input_project_id FOR UPDATE;
  IF NOT FOUND OR locked_project.owner_user_id IS DISTINCT FROM context_user THEN
    RETURN NULL;
  END IF;
  FOR chat_row IN
    SELECT * FROM app.chats
      WHERE org_id=context_org AND project_id=input_project_id AND deleted_at IS NULL
      ORDER BY id FOR UPDATE
  LOOP
    UPDATE app.chats SET deleted_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE org_id=chat_row.org_id AND id=chat_row.id;
    SELECT array_agg(cr.run_id ORDER BY cr.run_id) INTO chat_run_ids
      FROM app.chat_runs cr WHERE cr.org_id=chat_row.org_id AND cr.chat_id=chat_row.id;
    chat_run_ids:=COALESCE(chat_run_ids,'{}'::uuid[]);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'orgId',p.org_id,'runId',p.run_id,'sequence',p.sequence,
        'expectedVersion',p.expected_version,'stepId',p.step_id,
        'fence',p.fence,'slot',p.slot,'ownerToken',p.owner_token)
        ORDER BY p.run_id,p.sequence),'[]'::jsonb) INTO chat_permit_refs
      FROM app.ai_step_permit_references p
      WHERE p.org_id=chat_row.org_id AND p.user_id=chat_row.owner_user_id
        AND p.run_id=ANY(chat_run_ids);
    INSERT INTO app.chat_deletion_work
      (org_id,owner_user_id,chat_id,phase,run_ids,permit_refs,grace_until)
      VALUES (chat_row.org_id,chat_row.owner_user_id,chat_row.id,'grace',
        chat_run_ids,chat_permit_refs,clock_timestamp()+input_grace_ms*interval '1 millisecond');
    UPDATE app.ai_runs r SET status='cancelling',run_version=run_version+1,updated_at=clock_timestamp()
      WHERE r.org_id=chat_row.org_id AND r.initiating_user_id=chat_row.owner_user_id
        AND r.status IN ('queued','running','awaiting_approval')
        AND EXISTS (SELECT 1 FROM app.chat_runs cr WHERE cr.org_id=chat_row.org_id
          AND cr.chat_id=chat_row.id AND cr.run_id=r.id AND cr.kind='answer');
    FOREACH run_id IN ARRAY chat_run_ids LOOP
      PERFORM pg_notify('lexon_chat_deleted',run_id::text);
    END LOOP;
    chats:=chats || jsonb_build_object(
      'chatId',chat_row.id,'ownerUserId',chat_row.owner_user_id,'runIds',chat_run_ids);
  END LOOP;
  DELETE FROM app.projects WHERE org_id=context_org AND id=input_project_id;
  RETURN jsonb_build_object('chatCount',jsonb_array_length(chats),'chats',chats);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ops.project_delete(uuid,uuid,uuid,integer) FROM PUBLIC,lexon_auth,lexon_migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ops.project_delete(uuid,uuid,uuid,integer) TO lexon_app;
