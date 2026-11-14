import { z } from 'zod';
import { OutboxRepository } from './outbox.repository.js';
import { CHAT_DELETION_NOTIFICATION_CHANNEL } from './pg-notification-listener.js';
import { ChatRepository } from './chat.repository.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import {
  chatCleanupJobId,
  type ChatCleanupPhase,
} from './chat-cleanup-job-id.js';
import {
  StepPermitReferenceRepository,
  type StepPermitReference,
} from './step-permit.repository.js';

const uuid = z.uuid();

export type ChatDeletionState = ChatCleanupPhase | 'complete';

export interface ChatDeletionWork {
  readonly orgId: string;
  readonly ownerUserId: string;
  readonly chatId: string;
  readonly phase: ChatDeletionState;
  readonly runIds: readonly string[];
  readonly permitRefs: readonly StepPermitReference[];
  readonly requestedAt: Date;
  readonly graceUntil: Date;
}

interface WorkRow {
  org_id: string;
  owner_user_id: string;
  chat_id: string;
  phase: ChatDeletionState;
  run_ids: string[];
  permit_refs: StepPermitReference[];
  requested_at: Date;
  grace_until: Date;
}

function mapWork(row: WorkRow): ChatDeletionWork {
  return {
    orgId: row.org_id,
    ownerUserId: row.owner_user_id,
    chatId: row.chat_id,
    phase: row.phase,
    runIds: row.run_ids,
    permitRefs: row.permit_refs,
    requestedAt: row.requested_at,
    graceUntil: row.grace_until,
  };
}

export class ChatDeletionRepository {
  private readonly chats = new ChatRepository();
  private readonly outbox = new OutboxRepository();
  private readonly permitReferences = new StepPermitReferenceRepository();

  async request(
    tx: TenantSession,
    chatId: string,
    graceMs: number,
  ): Promise<boolean> {
    if (
      !uuid.safeParse(chatId).success ||
      !Number.isSafeInteger(graceMs) ||
      graceMs < 1
    )
      return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId || !(await this.chats.lockLive(tx, chatId))) return false;
    const runs = await client.query<{ run_id: string }>(
      `SELECT run_id FROM app.chat_runs WHERE org_id=$1 AND chat_id=$2 ORDER BY run_id`,
      [ctx.orgId, chatId],
    );
    const runIds = runs.rows.map((row) => row.run_id);
    const permitRefs = await this.permitReferences.listForRuns(tx, runIds);
    const phase: ChatCleanupPhase = 'grace';
    const jobId = chatCleanupJobId(chatId, phase);
    if (!(await this.chats.markDeleted(tx, chatId, phase, jobId))) return false;
    await client.query(
      `INSERT INTO app.chat_deletion_work
       (org_id,owner_user_id,chat_id,phase,run_ids,permit_refs,grace_until)
       VALUES($1,$2,$3,'grace',$4::uuid[],$5::jsonb,clock_timestamp()+$6*interval '1 millisecond')`,
      [
        ctx.orgId,
        ctx.userId,
        chatId,
        runIds,
        JSON.stringify(permitRefs),
        graceMs,
      ],
    );
    await client.query('SELECT ops.ai_chat_begin_delete_cancel($1,$2,$3)', [
      ctx.orgId,
      ctx.userId,
      chatId,
    ]);
    for (const runId of runIds)
      await client.query('SELECT pg_notify($1,$2)', [
        CHAT_DELETION_NOTIFICATION_CHANNEL,
        runId,
      ]);
    return true;
  }

  async read(
    tx: TenantSession,
    chatId: string,
    lock = false,
  ): Promise<ChatDeletionWork | null> {
    if (!uuid.safeParse(chatId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<WorkRow>(
      `SELECT org_id,owner_user_id,chat_id,phase,run_ids,permit_refs,requested_at,grace_until
       FROM app.chat_deletion_work WHERE org_id=$1 AND owner_user_id=$2 AND chat_id=$3
       ${lock ? 'FOR UPDATE' : ''}`,
      [ctx.orgId, ctx.userId, chatId],
    );
    return result.rows[0] ? mapWork(result.rows[0]) : null;
  }

  async wasDeleted(
    tx: TenantSession,
    entityKind: 'chat' | 'message',
    entityId: string,
  ): Promise<boolean> {
    if (!uuid.safeParse(entityId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query(
      `SELECT 1 FROM app.chat_deleted_ids
       WHERE org_id=$1 AND owner_user_id=$2 AND entity_kind=$3 AND entity_id=$4`,
      [ctx.orgId, ctx.userId, entityKind, entityId],
    );
    if (result.rowCount === 1) return true;
    if (entityKind !== 'chat') return false;
    const deleted = await client.query(
      'SELECT ops.ai_chat_was_deleted($1,$2,$3) AS deleted',
      [ctx.orgId, ctx.userId, entityId],
    );
    return deleted.rows[0]?.deleted === true;
  }

  async moveToNextPhase(
    tx: TenantSession,
    chatId: string,
    expected: ChatCleanupPhase,
    next: ChatCleanupPhase,
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const updated = await client.query(
      `UPDATE app.chat_deletion_work SET phase=$4,updated_at=clock_timestamp()
       WHERE org_id=$1 AND owner_user_id=$2 AND chat_id=$3 AND phase=$5`,
      [ctx.orgId, ctx.userId, chatId, next, expected],
    );
    if (updated.rowCount !== 1) return false;
    await this.outbox.append(
      tx,
      {
        type: 'chat.cleanup.v1',
        ctx: { orgId: ctx.orgId, userId: ctx.userId },
        payload: { chatId, phase: next },
      },
      { id: chatCleanupJobId(chatId, next) },
    );
    return true;
  }

  async purgeContent(tx: TenantSession, chatId: string): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query<{ purged: boolean }>(
      'SELECT ops.ai_purge_deleted_chat($1,$2,$3) AS purged',
      [ctx.orgId, ctx.userId, chatId],
    );
    return result.rows[0]?.purged === true;
  }

  async terminalizeRuns(tx: TenantSession, chatId: string): Promise<boolean> {
    if (!uuid.safeParse(chatId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query<{ terminalized: boolean }>(
      'SELECT ops.ai_chat_terminalize_deleted_runs($1,$2,$3) AS terminalized',
      [ctx.orgId, ctx.userId, chatId],
    );
    return result.rows[0]?.terminalized === true;
  }

  async complete(tx: TenantSession, chatId: string): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const updated = await client.query(
      `UPDATE app.chat_deletion_work SET phase='complete',completed_at=clock_timestamp(),
       updated_at=clock_timestamp()
       WHERE org_id=$1 AND owner_user_id=$2 AND chat_id=$3 AND phase='purge_valkey'`,
      [ctx.orgId, ctx.userId, chatId],
    );
    return updated.rowCount === 1;
  }
}
