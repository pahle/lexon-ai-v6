import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

type Isolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
export function createOrganizationInspector(options: { migratorUrl: string }) {
  const pool = new Pool({ connectionString: options.migratorUrl, max: 6 });
  let retryFault = false;
  async function owners(id: string) {
    return (
      await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM auth.member WHERE organization_id=$1 AND role='owner'",
        [id],
      )
    ).rows[0]!.count;
  }
  async function waitFor(
    client: PoolClient,
    predicate: () => Promise<boolean>,
  ) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await client.query('ROLLBACK');
    throw new Error('Organization race synchronization timed out');
  }
  async function hold(id: string, memberId?: string) {
    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM auth.organization WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (memberId)
        await client.query(
          "UPDATE auth.member SET role='admin' WHERE id=$1 AND organization_id=$2",
          [memberId, id],
        );
      return {
        async waitForAuthWaiters(
          count: number,
          settled: () => boolean = () => false,
        ) {
          await waitFor(client, async () => {
            const row = (
              await pool.query<{ blocked: number }>(
                "SELECT count(*) FILTER(WHERE cardinality(pg_blocking_pids(pid))>0)::int AS blocked FROM pg_stat_activity WHERE datname=current_database() AND usename='lexon_auth'",
              )
            ).rows[0]!;
            return settled() || row.blocked >= count;
          });
        },
        async release() {
          if (released) return;
          released = true;
          try {
            await client.query('COMMIT');
          } finally {
            client.release();
          }
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  }
  return {
    owners,
    hold,
    async teamCount(userId: string) {
      return (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM auth.member m JOIN auth.organization o ON o.id=m.organization_id WHERE m.user_id=$1 AND o.kind='team'",
          [userId],
        )
      ).rows[0]!.count;
    },
    async name(id: string) {
      return (
        await pool.query<{ name: string }>(
          'SELECT name FROM auth.organization WHERE id=$1',
          [id],
        )
      ).rows[0]!.name;
    },
    async failAudits(count: number) {
      if (!Number.isInteger(count) || count < 1 || count > 3)
        throw new Error('Invalid fixture failure count');
      await pool.query(`CREATE SEQUENCE auth.test_org_retry;
        CREATE FUNCTION ops.test_retry_org_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
          IF NEW.type='organization.created.v1' AND NEW.metadata->>'kind'='team' AND nextval('auth.test_org_retry')<=${count} THEN RAISE EXCEPTION 'Injected serialization failure' USING ERRCODE='40001'; END IF;
          RETURN NEW; END $$;
        CREATE TRIGGER test_retry_org_audit BEFORE INSERT ON ops.audit_events FOR EACH ROW EXECUTE FUNCTION ops.test_retry_org_audit();`);
      retryFault = true;
    },
    async attempts() {
      return (
        await pool.query<{ count: number }>(
          'SELECT last_value::int AS count FROM auth.test_org_retry',
        )
      ).rows[0]!.count;
    },
    async seedProvisioning(
      inviterId: string,
      withInvite = true,
      withMember = false,
    ) {
      const id = randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "INSERT INTO auth.organization(id,name,slug,created_at,kind,state) VALUES($1,'Provisioning fixture',$2,now(),'team','provisioning')",
          [id, `provision-${id}`],
        );
        if (withInvite)
          await client.query(
            "INSERT INTO auth.invitation(organization_id,email,role,purpose,status,expires_at,inviter_id) VALUES($1,'owner@example.test','owner','first_owner','pending',now()+interval '1 day',$2)",
            [id, inviterId],
          );
        if (withMember)
          await client.query(
            "INSERT INTO auth.member(organization_id,user_id,role,created_at) VALUES($1,$2,'owner',now())",
            [id, inviterId],
          );
        await client.query('COMMIT');
        return id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async seedTeam(userIds: string[], id = randomUUID()) {
      const members = userIds.map((userId) => ({ id: randomUUID(), userId }));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "INSERT INTO auth.organization(id,name,slug,created_at,kind,state) VALUES($1,'Fixture team',$2,now(),'team','active')",
          [id, `fixture-${id}`],
        );
        for (const member of members)
          await client.query(
            "INSERT INTO auth.member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'owner',now())",
            [member.id, id, member.userId],
          );
        await client.query('COMMIT');
        return { id, members };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async bareTeam() {
      await pool.query(
        "INSERT INTO auth.organization(name,slug,created_at,kind,state) VALUES('Ownerless',$1,now(),'team','active')",
        [`ownerless-${randomUUID()}`],
      );
    },
    async deleteTeam(id: string) {
      await pool.query('DELETE FROM auth.organization WHERE id=$1', [id]);
    },
    async mutateMember(id: string, action: 'delete' | 'demote') {
      await pool.query(
        action === 'delete'
          ? 'DELETE FROM auth.member WHERE id=$1'
          : "UPDATE auth.member SET role='member' WHERE id=$1",
        [id],
      );
    },
    async invalidRole(id: string) {
      await pool.query(
        "UPDATE auth.member SET role='owner,admin' WHERE id=$1",
        [id],
      );
    },
    async duplicateMember(organizationId: string, userId: string) {
      await pool.query(
        "INSERT INTO auth.member(organization_id,user_id,role,created_at) VALUES($1,$2,'member',now())",
        [organizationId, userId],
      );
    },
    async race(
      id: string,
      memberIds: string[],
      action: 'delete' | 'demote',
      isolation: Isolation,
    ) {
      const first = await pool.connect();
      const second = await pool.connect();
      let secondCommitted = false;
      let secondCode: string | undefined;
      let settled = false;
      let blocked = false;
      try {
        for (const client of [first, second]) {
          await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          await client.query(
            'SELECT count(*) FROM auth.member WHERE organization_id=$1',
            [id],
          );
        }
        const query =
          action === 'delete'
            ? 'DELETE FROM auth.member WHERE id=$1'
            : "UPDATE auth.member SET role='member' WHERE id=$1";
        await first.query(query, [memberIds[0]]);
        const pid = (
          await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        ).rows[0]!.pid;
        const pending = second.query(query, [memberIds[1]]).then(
          () => {
            settled = true;
            return null;
          },
          (error) => {
            settled = true;
            return error as { code?: string };
          },
        );
        await waitFor(first, async () => {
          if (settled) return true;
          blocked = (
            await pool.query<{ blocked: boolean }>(
              'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
              [pid],
            )
          ).rows[0]!.blocked;
          return blocked;
        });
        await first.query('COMMIT');
        const failure = await pending;
        if (failure) {
          secondCode = failure.code;
          await second.query('ROLLBACK');
        } else {
          try {
            await second.query('COMMIT');
            secondCommitted = true;
          } catch (error) {
            secondCode = (error as { code?: string }).code;
            await second.query('ROLLBACK');
          }
        }
        return {
          committed: [true, secondCommitted],
          secondCode,
          blocked,
          owners: await owners(id),
        };
      } finally {
        await first.query('ROLLBACK');
        await second.query('ROLLBACK');
        first.release();
        second.release();
      }
    },
    async close() {
      try {
        if (retryFault)
          await pool.query(
            'DROP TRIGGER test_retry_org_audit ON ops.audit_events; DROP FUNCTION ops.test_retry_org_audit(); DROP SEQUENCE auth.test_org_retry;',
          );
      } finally {
        await pool.end();
      }
    },
  };
}
