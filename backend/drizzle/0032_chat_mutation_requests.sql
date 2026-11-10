CREATE TABLE app.chat_mutation_requests (
  org_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  mutation_kind text NOT NULL CHECK (mutation_kind IN ('send','edit','regenerate')),
  chat_id uuid NOT NULL,
  source_message_id uuid,
  user_message_id uuid NOT NULL,
  assistant_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,owner_user_id,mutation_kind,request_id)
);
--> statement-breakpoint
INSERT INTO app.chat_mutation_requests
  (org_id,owner_user_id,request_id,mutation_kind,chat_id,source_message_id,
   user_message_id,assistant_message_id)
SELECT chat.org_id,chat.owner_user_id,user_message.id,'send',chat.id,
  user_message.parent_message_id,user_message.id,answer.id
FROM app.chat_messages user_message
JOIN app.chats chat ON chat.org_id=user_message.org_id AND chat.id=user_message.chat_id
JOIN LATERAL (
  SELECT candidate.id FROM app.chat_messages candidate
  WHERE candidate.org_id=user_message.org_id AND candidate.chat_id=user_message.chat_id
    AND candidate.parent_message_id=user_message.id AND candidate.role='assistant'
  ORDER BY candidate.created_at,candidate.id LIMIT 1
) answer ON true
WHERE user_message.role='user';
--> statement-breakpoint
ALTER TABLE app.chat_mutation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_mutation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_live_chat_mutation_select ON app.chat_mutation_requests
  FOR SELECT TO lexon_app
  USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_mutation_requests.org_id
      AND c.id=chat_mutation_requests.chat_id AND c.owner_user_id=chat_mutation_requests.owner_user_id
      AND c.deleted_at IS NULL));
CREATE POLICY owner_live_chat_mutation_insert ON app.chat_mutation_requests
  FOR INSERT TO lexon_app
  WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
    AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_mutation_requests.org_id
      AND c.id=chat_mutation_requests.chat_id AND c.owner_user_id=chat_mutation_requests.owner_user_id
      AND c.deleted_at IS NULL));
CREATE POLICY chat_mutation_internal ON app.chat_mutation_requests
  FOR ALL TO lexon_migrator USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON app.chat_mutation_requests TO lexon_app;
REVOKE UPDATE,DELETE,TRUNCATE ON app.chat_mutation_requests FROM lexon_app,lexon_auth,PUBLIC;
