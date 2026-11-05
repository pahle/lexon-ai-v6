import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

interface RunAuthorizationDatabaseOptions {
  readonly appUrl: string;
  readonly authUrl: string;
}

async function setTenant(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<void> {
  await client.query('BEGIN');
  await client.query(
    "SELECT set_config('app.org_id',$1,true),set_config('app.user_id',$2,true)",
    [orgId, userId],
  );
}

async function waitForAuthBlock(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: number }>(
      `SELECT count(*)::int AS blocked FROM pg_stat_activity
       WHERE datname=current_database() AND usename='lexon_auth'
       AND state='active' AND cardinality(pg_blocking_pids(pid))>0`,
    );
    if (result.rows[0]!.blocked > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Membership removal did not wait for the run effect');
}

async function waitForBlockedPid(pool: Pool, pid: number): Promise<boolean> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(
      `SELECT cardinality(pg_blocking_pids(pid)) > 0 AS blocked
       FROM pg_stat_activity WHERE pid=$1`,
      [pid],
    );
    if (result.rows[0]?.blocked) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

export function createRunAuthorizationDatabaseFixture(
  options: RunAuthorizationDatabaseOptions,
) {
  const app = new Pool({ connectionString: options.appUrl, max: 4 });
  const auth = new Pool({ connectionString: options.authUrl, max: 4 });

  return {
    async insertCompletedRun(orgId: string, userId: string): Promise<string> {
      const runId = randomUUID();
      const client = await app.connect();
      try {
        await setTenant(client, orgId, userId);
        await client.query(
          `INSERT INTO app.ai_runs
           (id,org_id,initiating_user_id,initiating_session_id,initiating_mfa_verified_at,
            profile_id,profile_version,resolved_config,model_id,input_text,status,
            input_budget_tokens,output_budget_tokens)
           VALUES($1,$2,$3,$4,$5,'test-profile',1,'{}','test-model','test','completed',1,1)`,
          [
            runId,
            orgId,
            userId,
            randomUUID(),
            new Date('2026-11-05T08:00:00.000Z'),
          ],
        );
        await client.query('COMMIT');
        return runId;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async inspectFacts(orgId: string, userId: string, outsiderId: string) {
      const client = await app.connect();
      try {
        await setTenant(client, orgId, userId);
        const facts = await client.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, userId],
        );
        const wrongUser = await client.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, outsiderId],
        );
        await client.query('ROLLBACK');

        const noContext = await app.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, userId],
        );
        const access = await app.query<{
          app_execute: boolean;
          auth_execute: boolean;
          public_execute: boolean;
          password_read: boolean;
          user_update: boolean;
        }>(`SELECT
          has_function_privilege('lexon_app','auth.lexon_ai_actor_facts(uuid,uuid)','EXECUTE') AS app_execute,
          has_function_privilege('lexon_auth','auth.lexon_ai_actor_facts(uuid,uuid)','EXECUTE') AS auth_execute,
          has_function_privilege('public','auth.lexon_ai_actor_facts(uuid,uuid)','EXECUTE') AS public_execute,
          has_column_privilege('lexon_app','auth.account','password','SELECT') AS password_read,
          has_table_privilege('lexon_app','auth.user','UPDATE') AS user_update`);
        const definition = await app.query<{
          prosecdef: boolean;
          proconfig: string[];
          definition: string;
        }>(`SELECT p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p WHERE p.oid='auth.lexon_ai_actor_facts(uuid,uuid)'::regprocedure`);
        return {
          facts: facts.rows,
          wrongUser: wrongUser.rows,
          noContext: noContext.rows,
          access: access.rows[0],
          definition: definition.rows[0],
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async authorizeEffectWhileRemovingMember(
      orgId: string,
      initiatorId: string,
      removedUserId: string,
      runId: string,
    ) {
      const effect = await app.connect();
      try {
        await setTenant(effect, orgId, initiatorId);
        const facts = await effect.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, initiatorId],
        );
        const removal = (async () => {
          const remover = await auth.connect();
          try {
            await remover.query('BEGIN');
            await remover.query('SELECT auth.lexon_lock_organization($1)', [
              orgId,
            ]);
            await remover.query(
              'DELETE FROM auth.member WHERE organization_id=$1 AND user_id=$2',
              [orgId, removedUserId],
            );
            await remover.query('COMMIT');
          } catch (error) {
            await remover.query('ROLLBACK').catch(() => undefined);
            throw error;
          } finally {
            remover.release();
          }
        })();
        await waitForAuthBlock(auth);
        await effect.query(
          'UPDATE app.ai_runs SET model_iterations=model_iterations+1 WHERE org_id=$1 AND id=$2',
          [orgId, runId],
        );
        await effect.query('COMMIT');
        await removal;
        return { facts: facts.rows };
      } catch (error) {
        await effect.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        effect.release();
      }
    },

    async selectionAndAuthorization(orgId: string, userId: string) {
      const selection = await auth.connect();
      const authorization = await app.connect();
      let selectionOpen = false;
      let authorizationOpen = false;
      try {
        await selection.query('BEGIN');
        selectionOpen = true;
        const selectionPid = Number(
          (
            await selection.query<{ pid: string }>(
              'SELECT pg_backend_pid() AS pid',
            )
          ).rows[0]!.pid,
        );
        const authorizationPid = Number(
          (
            await authorization.query<{ pid: string }>(
              'SELECT pg_backend_pid() AS pid',
            )
          ).rows[0]!.pid,
        );
        await selection.query(
          'SELECT id FROM auth."user" WHERE id=$1 FOR UPDATE',
          [userId],
        );

        await setTenant(authorization, orgId, userId);
        authorizationOpen = true;
        const facts = authorization.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, userId],
        );
        const authorizationWaitedForUser = await waitForBlockedPid(
          app,
          authorizationPid,
        );

        // This is the remaining parent-lock step in F1's selection lock
        // protocol, after it has already locked the user row.
        const parentSelection = selection.query(
          'SELECT auth.lexon_lock_selection($1,$2,$3)',
          [userId, randomUUID(), orgId],
        );
        const selectionCycle = await waitForBlockedPid(auth, selectionPid);
        if (selectionCycle) {
          await selection.query('ROLLBACK');
          selectionOpen = false;
          await facts;
          await parentSelection;
        } else {
          await parentSelection;
          await selection.query('COMMIT');
          selectionOpen = false;
          await facts;
        }
        await authorization.query('COMMIT');
        authorizationOpen = false;
        return { authorizationWaitedForUser, selectionCycle };
      } finally {
        if (selectionOpen)
          await selection.query('ROLLBACK').catch(() => undefined);
        if (authorizationOpen)
          await authorization.query('ROLLBACK').catch(() => undefined);
        selection.release();
        authorization.release();
      }
    },

    async sameUserAuthorizationsOverlap(orgId: string, userId: string) {
      const first = await app.connect();
      const second = await app.connect();
      let firstOpen = false;
      let secondOpen = false;
      try {
        await setTenant(first, orgId, userId);
        firstOpen = true;
        const firstFacts = await first.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, userId],
        );
        const firstAuthorized = firstFacts.rowCount === 1;

        await setTenant(second, orgId, userId);
        secondOpen = true;
        const secondAuthorization = second.query(
          'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
          [orgId, userId],
        );
        const secondFinishedWhileFirstStepHeld = await Promise.race([
          secondAuthorization.then((facts) => facts.rowCount === 1),
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), 500),
          ),
        ]);

        await first.query('COMMIT');
        firstOpen = false;
        const secondFacts = await secondAuthorization;
        await second.query('COMMIT');
        secondOpen = false;
        return {
          firstAuthorized,
          secondAuthorized: secondFacts.rowCount === 1,
          secondFinishedWhileFirstStepHeld,
        };
      } finally {
        if (firstOpen) await first.query('ROLLBACK').catch(() => undefined);
        if (secondOpen) await second.query('ROLLBACK').catch(() => undefined);
        first.release();
        second.release();
      }
    },

    async runIterations(orgId: string, userId: string, runId: string) {
      const client = await app.connect();
      try {
        await setTenant(client, orgId, userId);
        const result = await client.query<{ model_iterations: number }>(
          'SELECT model_iterations FROM app.ai_runs WHERE org_id=$1 AND id=$2',
          [orgId, runId],
        );
        await client.query('ROLLBACK');
        return result.rows[0]?.model_iterations;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    close() {
      return Promise.all([app.end(), auth.end()]);
    },
  };
}
