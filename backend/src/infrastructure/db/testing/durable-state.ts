import { Pool } from 'pg';

/**
 * Post-access-loss durable state read. Once the initiator's membership is
 * gone the chats→chat_runs→ai_runs RLS chain hides the run from their claim
 * entirely, so assertions on the settled row go through the migrator role.
 */
export async function durableRunState(
  migratorUrl: string,
  runId: string,
): Promise<{ status: string; errorCode: string | null } | null> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    const row = (
      await pool.query<{ status: string; error_code: string | null }>(
        'SELECT status,error_code FROM app.ai_runs WHERE id=$1',
        [runId],
      )
    ).rows[0];
    return row ? { status: row.status, errorCode: row.error_code } : null;
  } finally {
    await pool.end();
  }
}

/** Same read for an ai_operations row under the initiator-invisible chain. */
export async function durableOperationState(
  migratorUrl: string,
  operationId: string,
): Promise<{ status: string; errorCode: string | null } | null> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    const row = (
      await pool.query<{ status: string; error_code: string | null }>(
        'SELECT status,error_code FROM app.ai_operations WHERE id=$1',
        [operationId],
      )
    ).rows[0];
    return row ? { status: row.status, errorCode: row.error_code } : null;
  } finally {
    await pool.end();
  }
}

/** Mirrors AiOperationRepository.forRun's join, filter and ordering. */
export async function durableOperationsForRun(
  migratorUrl: string,
  runId: string,
  throughSequence: number,
): Promise<
  {
    id: string;
    status: string;
    decision: string | null;
    errorCode: string | null;
    result: unknown;
  }[]
> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    const rows = (
      await pool.query<{
        id: string;
        status: string;
        decision: string | null;
        error_code: string | null;
        result: unknown;
      }>(
        `SELECT o.id,o.status,o.decision,o.error_code,o.result
         FROM app.ai_operations o
         JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
         WHERE o.run_id=$1 AND s.sequence<$2
         ORDER BY s.sequence,o.call_occurrence`,
        [runId, throughSequence],
      )
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      decision: row.decision,
      errorCode: row.error_code,
      result: row.result,
    }));
  } finally {
    await pool.end();
  }
}

/** Same read for an ai_steps row under the initiator-invisible chain. */
export async function durableStepState(
  migratorUrl: string,
  runId: string,
  sequence: number,
): Promise<{ state: string; leaseUntil: Date | null } | null> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    const row = (
      await pool.query<{ state: string; lease_until: Date | null }>(
        'SELECT state,lease_until FROM app.ai_steps WHERE run_id=$1 AND sequence=$2',
        [runId, sequence],
      )
    ).rows[0];
    return row ? { state: row.state, leaseUntil: row.lease_until } : null;
  } finally {
    await pool.end();
  }
}
