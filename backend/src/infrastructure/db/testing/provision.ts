import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
export {
  bootstrapDatabase,
  configureRuntimeRolePasswords,
} from '../bootstrap.js';
export { migrateDatabase } from '../migrate.js';

export function roleUrl(
  base: string,
  role: string,
  password: string,
  database: string,
): string {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}
export async function cloneDatabase(
  adminUrl: string,
  template: string,
  database: string,
): Promise<void> {
  if (
    ![template, database].every((name) => /^[a-z][a-z0-9_]{0,62}$/.test(name))
  )
    throw new Error('Invalid fixture database name');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE "${database}" TEMPLATE "${template}" OWNER lexon_migrator`,
    );
  } finally {
    await client.end();
  }
}
export async function dropDatabase(
  adminUrl: string,
  database: string,
): Promise<void> {
  if (!/^lexon_test_[a-f0-9]+$/.test(database))
    throw new Error('Refusing to drop an unowned database');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

export async function revertProjectActorFacts0044ForUpgradeTest(
  migratorUrl: string,
): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const journal = JSON.parse(
      await readFile(
        new URL('../../../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string; when: number }> };
    const migration = journal.entries.find(
      (entry) => entry.tag === '0044_project_actor_facts',
    );
    if (!migration) throw new Error('Migration 0044 journal entry missing');
    await client.query('BEGIN');
    // Reverses 0044_project_actor_facts so migrateDatabase replays it through
    // the real drizzle path: the access-loss definer family drops first, then
    // ai_mark_chat_deleted regains its 0026 body (the 0044 rewrite added
    // the lexon_project_access clause the 0043 rewind would orphan). The
    // drop+create — not CREATE OR REPLACE — mirrors the migration: the 0026
    // REVOKE stripped lexon_migrator's EXECUTE grant, which makes OR REPLACE
    // fail the function ACL check under PG 17.
    await client.query(`
      DROP FUNCTION auth.lexon_ai_actor_facts(uuid,uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_ai_access_loss_facts(uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_ai_finalize_access_loss(uuid,uuid,uuid,integer,integer,uuid,bigint);
      DROP FUNCTION ops.lexon_ai_access_loss_decide(uuid,uuid,uuid,uuid,text);
      DROP FUNCTION ops.lexon_ai_terminal_stream_proof(uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_ai_expire_access_loss(uuid,uuid,uuid,uuid);
      DROP FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid);
      CREATE FUNCTION ops.ai_mark_chat_deleted(input_org_id uuid,input_user_id uuid,input_chat_id uuid) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,ops,pg_temp AS $restore$
      DECLARE context_org uuid; context_user uuid; locked_chat app.chats%ROWTYPE;
      BEGIN
        context_org:=NULLIF(current_setting('app.org_id',true),'')::uuid;
        context_user:=NULLIF(current_setting('app.user_id',true),'')::uuid;
        IF context_org IS NULL OR context_user IS NULL OR input_chat_id IS NULL
          OR context_org IS DISTINCT FROM input_org_id OR context_user IS DISTINCT FROM input_user_id THEN
          RETURN false;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:' || context_org::text,0));
        SELECT * INTO locked_chat FROM app.chats
          WHERE org_id=context_org AND id=input_chat_id AND owner_user_id=context_user
            AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE app.chats SET deleted_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE org_id=context_org AND id=input_chat_id;
        RETURN true;
      END $restore$;
      REVOKE ALL ON FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid) FROM PUBLIC,lexon_auth,lexon_migrator;
      GRANT EXECUTE ON FUNCTION ops.ai_mark_chat_deleted(uuid,uuid,uuid) TO lexon_app;
    `);
    const removed = await client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE created_at=$1::bigint',
      [migration.when],
    );
    if (removed.rowCount !== 1)
      throw new Error('Expected to remove the 0044 migration journal row');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function revertProjects0043ForUpgradeTest(
  migratorUrl: string,
): Promise<void> {
  // The 0044 access-loss definers (and its ai_mark_chat_deleted rewrite)
  // unwind first so the 0043 rewind below never orphans a function body that
  // references ops.lexon_project_access — same newest-to-oldest rule the
  // 0042 caller documents.
  await revertProjectActorFacts0044ForUpgradeTest(migratorUrl);
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const journal = JSON.parse(
      await readFile(
        new URL('../../../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string; when: number }> };
    const migration = journal.entries.find(
      (entry) => entry.tag === '0043_projects',
    );
    if (!migration) throw new Error('Migration 0043 journal entry missing');
    await client.query('BEGIN');
    // Reverses 0043_projects so migrateDatabase can replay it (and any older
    // rewound migration) through the real drizzle path. Order matters:
    // policies referencing ops.* definers die before the functions, triggers
    // before their functions, referencing tables before the parents.
    await client.query(`
      DROP POLICY chats_access_select ON app.chats;
      DROP POLICY owner_live_chat_insert ON app.chats;
      CREATE POLICY owner_live_chat_select ON app.chats FOR SELECT TO lexon_app
        USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
          AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
          AND deleted_at IS NULL);
      CREATE POLICY owner_live_chat_insert ON app.chats FOR INSERT TO lexon_app
        WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
          AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
          AND deleted_at IS NULL);
      DROP POLICY chat_run_access_select ON app.chat_runs;
      CREATE POLICY owner_chat_run_select ON app.chat_runs FOR SELECT TO lexon_app
        USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
          AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_runs.org_id
            AND c.id=chat_runs.chat_id
            AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid));
      DROP POLICY chat_message_access_select ON app.chat_messages;
      DROP POLICY owner_chat_message_insert ON app.chat_messages;
      DROP POLICY owner_chat_message_update ON app.chat_messages;
      DROP POLICY owner_chat_message_delete ON app.chat_messages;
      CREATE POLICY owner_chat_message ON app.chat_messages FOR ALL TO lexon_app
        USING (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
          AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
            AND c.id=chat_messages.chat_id AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
            AND c.deleted_at IS NULL))
        WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
          AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_messages.org_id
            AND c.id=chat_messages.chat_id AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
            AND c.deleted_at IS NULL));
      DROP POLICY ai_runs_access_read ON app.ai_runs;
      DROP POLICY ai_runs_owner_live_insert ON app.ai_runs;
      DROP POLICY ai_runs_owner_live_update ON app.ai_runs;
      DROP POLICY ai_runs_owner_live_delete ON app.ai_runs;
      CREATE POLICY ai_runs_owner_live_resource ON app.ai_runs AS RESTRICTIVE
        FOR ALL TO lexon_app
        USING (
            (CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
              THEN jsonb_array_length(resolved_config->'resourceIds')=0
              WHEN resolved_config->'resourceIds' IS NULL THEN true ELSE false END)
            OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND EXISTS (
              SELECT 1 FROM app.chat_runs cr JOIN app.chats c
                ON c.org_id=cr.org_id AND c.id=cr.chat_id
              WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id
                AND cr.chat_id::text=ai_runs.resolved_config->'resourceIds'->>0
                AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
                  THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END
                AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
                AND c.deleted_at IS NULL))
            OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND status='queued'
              AND CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
                THEN jsonb_array_length(resolved_config->'resourceIds')<=32 ELSE false END
              AND NOT ops.ai_chat_run_is_associated(ai_runs.org_id,
                NULLIF(current_setting('app.user_id',true),'')::uuid,ai_runs.id))
          )
        WITH CHECK (
            (CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
              THEN jsonb_array_length(resolved_config->'resourceIds')=0
              WHEN resolved_config->'resourceIds' IS NULL THEN true ELSE false END)
            OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND EXISTS (
              SELECT 1 FROM app.chat_runs cr JOIN app.chats c
                ON c.org_id=cr.org_id AND c.id=cr.chat_id
              WHERE cr.org_id=ai_runs.org_id AND cr.run_id=ai_runs.id
                AND cr.chat_id::text=ai_runs.resolved_config->'resourceIds'->>0
                AND CASE WHEN jsonb_typeof(ai_runs.resolved_config->'resourceIds')='array'
                  THEN jsonb_array_length(ai_runs.resolved_config->'resourceIds')=1 ELSE false END
                AND c.owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
                AND c.deleted_at IS NULL))
            OR (initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND status='queued'
              AND CASE WHEN jsonb_typeof(resolved_config->'resourceIds')='array'
                THEN jsonb_array_length(resolved_config->'resourceIds')<=32 ELSE false END
              AND NOT ops.ai_chat_run_is_associated(ai_runs.org_id,
                NULLIF(current_setting('app.user_id',true),'')::uuid,ai_runs.id))
          );
      DROP POLICY ai_steps_access_read ON app.ai_steps;
      DROP POLICY ai_steps_owner_run_insert ON app.ai_steps;
      DROP POLICY ai_steps_owner_run_update ON app.ai_steps;
      DROP POLICY ai_steps_owner_run_delete ON app.ai_steps;
      CREATE POLICY ai_steps_owner_run ON app.ai_steps AS RESTRICTIVE
        FOR ALL TO lexon_app
        USING (EXISTS (SELECT 1 FROM app.ai_runs r
          WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
            AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
              OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
        WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
          WHERE r.org_id=ai_steps.org_id AND r.id=ai_steps.run_id
            AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
              OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
      DROP POLICY ai_checkpoints_access_read ON app.ai_checkpoints;
      DROP POLICY ai_checkpoints_owner_run_insert ON app.ai_checkpoints;
      DROP POLICY ai_checkpoints_owner_run_update ON app.ai_checkpoints;
      DROP POLICY ai_checkpoints_owner_run_delete ON app.ai_checkpoints;
      CREATE POLICY ai_checkpoints_owner_run ON app.ai_checkpoints AS RESTRICTIVE
        FOR ALL TO lexon_app
        USING (EXISTS (SELECT 1 FROM app.ai_runs r
          WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
            AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
              OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
        WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
          WHERE r.org_id=ai_checkpoints.org_id AND r.id=ai_checkpoints.run_id
            AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
              OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
      DROP POLICY ai_operations_access_read ON app.ai_operations;
      DROP POLICY ai_operations_owner_run_insert ON app.ai_operations;
      DROP POLICY ai_operations_owner_run_update ON app.ai_operations;
      DROP POLICY ai_operations_owner_run_delete ON app.ai_operations;
      CREATE POLICY ai_operations_owner_run ON app.ai_operations AS RESTRICTIVE
        FOR ALL TO lexon_app
        USING (EXISTS (SELECT 1 FROM app.ai_runs r
          WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
            AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
              OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)))
        WITH CHECK (EXISTS (SELECT 1 FROM app.ai_runs r
          WHERE r.org_id=ai_operations.org_id AND r.id=ai_operations.run_id
            AND (COALESCE(r.resolved_config->'resourceIds','[]'::jsonb)='[]'::jsonb
              OR r.initiating_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)));
      DROP POLICY owner_live_chat_create_request_insert ON app.chat_create_requests;
      CREATE POLICY owner_live_chat_create_request_insert ON app.chat_create_requests
        FOR INSERT TO lexon_app
        WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::uuid
          AND owner_user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
          AND EXISTS (SELECT 1 FROM app.chats c WHERE c.org_id=chat_create_requests.org_id
            AND c.id=chat_create_requests.chat_id AND c.owner_user_id=chat_create_requests.owner_user_id
            AND c.deleted_at IS NULL));
      DROP TRIGGER chats_project_stats ON app.chats;
      DROP TRIGGER chat_messages_project_activity ON app.chat_messages;
      DROP TRIGGER chat_create_request_project_bind ON app.chat_create_requests;
      DROP TABLE app.chat_shares;
      DROP TABLE app.project_instructions;
      DROP TABLE app.project_denies;
      DROP TABLE app.project_members;
      ALTER TABLE app.chats DROP CONSTRAINT chats_project_fk, DROP COLUMN project_id;
      ALTER TABLE app.chat_create_requests DROP COLUMN project_id;
      DROP TABLE app.projects;
      REVOKE UPDATE ON app.chats FROM lexon_app;
      GRANT UPDATE ON app.chats TO lexon_app;
      DROP FUNCTION ops.lexon_org_member(uuid,uuid);
      DROP FUNCTION ops.lexon_org_owner_admin(uuid,uuid);
      DROP FUNCTION ops.lexon_project_denied(uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_project_access(uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_project_deny_add(uuid,uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_project_deny_lift(uuid,uuid,uuid,uuid);
      DROP FUNCTION ops.lexon_project_member_count();
      DROP FUNCTION ops.lexon_project_chat_stats();
      DROP FUNCTION ops.lexon_project_chat_activity();
      DROP FUNCTION ops.chat_create_request_project_bind();
    `);
    const removed = await client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE created_at=$1::bigint',
      [migration.when],
    );
    if (removed.rowCount !== 1)
      throw new Error('Expected to remove the 0043 migration journal row');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function revertAiOperationKinds0042ForUpgradeTest(
  migratorUrl: string,
): Promise<void> {
  // drizzle's migrator applies only journal entries newer than the last
  // recorded migration, so 0043 must be unwound first or the caller's
  // migrateDatabase would skip the pending 0042 replay entirely. Running it
  // before the 0042 rewind keeps a failed 0042 step self-healing: migrate()
  // would then replay both pending entries in order.
  await revertProjects0043ForUpgradeTest(migratorUrl);
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const journal = JSON.parse(
      await readFile(
        new URL('../../../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string; when: number }> };
    const migration = journal.entries.find(
      (entry) => entry.tag === '0042_ai_operation_kinds',
    );
    if (!migration) throw new Error('Migration 0042 journal entry missing');
    await client.query('BEGIN');
    await client.query(`
      DROP POLICY IF EXISTS ai_operations_internal ON app.ai_operations;
      DROP FUNCTION IF EXISTS app.ai_expired_operations(integer);
      DROP INDEX IF EXISTS app.ai_operations_expiry_idx;
      ALTER TABLE app.ai_operations
        DROP CONSTRAINT ai_operations_decision_lifecycle,
        DROP CONSTRAINT ai_operations_lifecycle,
        DROP CONSTRAINT ai_operations_decision_check,
        DROP CONSTRAINT ai_operations_status_check,
        DROP CONSTRAINT ai_operations_kind_check,
        DROP COLUMN expires_at,
        DROP COLUMN kind;
      ALTER TABLE app.ai_operations
        ADD CONSTRAINT ai_operations_status_check
          CHECK (status IN ('pending','awaiting_approval','approved','rejected','succeeded','failed','outcome_unknown')),
        ADD CONSTRAINT ai_operations_decision_lifecycle CHECK (
          (decision IS NULL AND decided_at IS NULL AND decision_by_user_id IS NULL AND status NOT IN ('approved','rejected'))
          OR (decision='approve' AND status IN ('approved','rejected','succeeded','failed','outcome_unknown') AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL)
          OR (decision='reject' AND status='rejected' AND decided_at IS NOT NULL AND decision_by_user_id IS NOT NULL AND result IS NOT NULL AND completed_at IS NOT NULL)
        ),
        ADD CONSTRAINT ai_operations_lifecycle CHECK (
          (status IN ('pending','awaiting_approval','approved') AND result IS NULL AND completed_at IS NULL)
          OR (status IN ('succeeded','rejected','failed','outcome_unknown') AND result IS NOT NULL AND completed_at IS NOT NULL)
        ),
        ADD CONSTRAINT ai_operations_decision_check
          CHECK (decision IS NULL OR decision IN ('approve','reject'));
    `);
    const removed = await client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE created_at=$1::bigint',
      [migration.when],
    );
    if (removed.rowCount !== 1)
      throw new Error('Expected to remove the 0042 migration journal row');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function reapplyChatMutation0032ForUpgradeTest(
  migratorUrl: string,
): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const journal = JSON.parse(
      await readFile(
        new URL('../../../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string; when: number }> };
    const migration = journal.entries.find(
      (entry) => entry.tag === '0032_chat_mutation_requests',
    );
    if (!migration) throw new Error('Migration 0032 journal entry missing');
    const sql = await readFile(
      new URL(
        '../../../../drizzle/0032_chat_mutation_requests.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query('BEGIN');
    const receiptTable = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('app.chat_mutation_requests') IS NOT NULL AS exists",
    );
    if (!receiptTable.rows[0]?.exists)
      throw new Error('Migration 0032 receipt table is unavailable');
    await client.query('DROP TABLE app.chat_mutation_requests');
    const removed = await client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE created_at=$1::bigint',
      [migration.when],
    );
    if (removed.rowCount !== 1)
      throw new Error('Expected to remove the 0032 migration journal row');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function chatMutationSendReceiptRows(
  migratorUrl: string,
  requestIds: readonly string[],
): Promise<
  Array<{
    request_id: string;
    chat_id: string;
    user_message_id: string;
    assistant_message_id: string;
  }>
> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const result = await client.query<{
      request_id: string;
      chat_id: string;
      user_message_id: string;
      assistant_message_id: string;
    }>(
      `SELECT request_id,chat_id,user_message_id,assistant_message_id
       FROM app.chat_mutation_requests
       WHERE mutation_kind='send' AND request_id=ANY($1::uuid[])
       ORDER BY chat_id,user_message_id`,
      [requestIds],
    );
    return result.rows;
  } finally {
    await client.end();
  }
}
