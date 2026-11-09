import { TenantDatabase } from './tenant-database.js';
import { inspectPool } from './tenant-session.js';
import type { AiConfig } from '../../config/ai-config.js';

function valid(config: AiConfig): boolean {
  const values = [
    config.maxLen,
    config.eventBytes,
    config.slotBytes,
    config.memoryBudgetBytes,
    config.maxActive,
    config.maxActivePerOrg,
    config.terminalSlots,
  ];
  if (!values.every(Number.isSafeInteger)) return false;
  const slots = Math.floor(config.memoryBudgetBytes / config.slotBytes);
  const fingerprint = [
    config.maxLen,
    config.eventBytes,
    config.slotBytes,
    config.memoryBudgetBytes,
    config.maxActive,
    config.maxActivePerOrg,
    config.terminalSlots,
  ].join(':');
  return (
    config.maxLen >= 1 &&
    config.maxLen <= 1024 &&
    config.eventBytes >= 1 &&
    config.eventBytes <= 4096 &&
    config.slotBytes === 6_291_456 &&
    config.maxActive >= 1 &&
    config.maxActivePerOrg >= 1 &&
    config.maxActivePerOrg <= 6 &&
    config.maxActivePerOrg <= config.maxActive &&
    config.terminalSlots >= 0 &&
    config.terminalSlots <= 6 &&
    config.maxActive + config.terminalSlots <= slots &&
    Number.isSafeInteger(config.memoryBudgetBytes) &&
    config.memoryBudgetBytes > 0 &&
    config.fingerprint === fingerprint
  );
}

export class AiCapacityRepository {
  constructor(private readonly database: TenantDatabase) {}

  async configure(config: AiConfig): Promise<void> {
    if (!valid(config)) throw new Error('Invalid AI capacity configuration');
    const pool = inspectPool(this.database);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(1976301,17)');
      const inserted = await client.query(
        `INSERT INTO ops.ai_engine_capacity
         (singleton,max_active,max_active_per_org,terminal_slots,max_len,event_bytes,slot_bytes,memory_budget_bytes,config_fingerprint)
         VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(singleton) DO NOTHING RETURNING singleton`,
        [
          config.maxActive,
          config.maxActivePerOrg,
          config.terminalSlots,
          config.maxLen,
          config.eventBytes,
          config.slotBytes,
          config.memoryBudgetBytes,
          config.fingerprint,
        ],
      );
      if (inserted.rowCount !== 1) {
        const existing = await client.query<{
          max_active: number;
          max_active_per_org: number;
          terminal_slots: number;
          max_len: number;
          event_bytes: number;
          slot_bytes: number;
          memory_budget_bytes: string | number;
          config_fingerprint: string;
        }>(
          `SELECT max_active,max_active_per_org,terminal_slots,max_len,event_bytes,slot_bytes,memory_budget_bytes,config_fingerprint
           FROM ops.ai_engine_capacity WHERE singleton=true`,
        );
        const row = existing.rows[0];
        if (
          !row ||
          row.max_active !== config.maxActive ||
          row.max_active_per_org !== config.maxActivePerOrg ||
          row.terminal_slots !== config.terminalSlots ||
          row.max_len !== config.maxLen ||
          row.event_bytes !== config.eventBytes ||
          row.slot_bytes !== config.slotBytes ||
          Number(row.memory_budget_bytes) !== config.memoryBudgetBytes ||
          row.config_fingerprint !== config.fingerprint
        )
          throw new Error('AI capacity configuration mismatch');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
