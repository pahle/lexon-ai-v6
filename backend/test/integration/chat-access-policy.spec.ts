import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  chatShare,
  createProjectScenario,
  errorCode,
  projectDeny,
  withAppTenant,
  type ProjectScenario,
  type Queryable,
} from '../../src/infrastructure/db/testing/project-fixture.js';

// F6 §4.3: read access widens to owner OR project access OR share, writes
// stay owner/initiator-only, and the disjoint-by-project_id arms keep a deny
// or a removal airtight. All claims run as lexon_app with bound GUCs.

async function treeCounts(
  client: Queryable,
  scenario: ProjectScenario,
): Promise<Record<string, number>> {
  const row = (
    await client.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM app.chats WHERE id=$1) AS chat,
         (SELECT count(*) FROM app.chat_runs WHERE chat_id=$1) AS chat_runs,
         (SELECT count(*) FROM app.chat_messages WHERE chat_id=$1)
           AS chat_messages,
         (SELECT count(*) FROM app.ai_runs WHERE id=$2) AS ai_runs,
         (SELECT count(*) FROM app.ai_operations WHERE id=$3)
           AS ai_operations`,
      [scenario.projectChatId, scenario.runId, scenario.operationId],
    )
  ).rows[0]!;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
}

const VISIBLE_TREE = {
  chat: 1,
  chat_runs: 1,
  chat_messages: 2,
  ai_runs: 1,
  ai_operations: 1,
};
const HIDDEN_TREE = {
  chat: 0,
  chat_runs: 0,
  chat_messages: 0,
  ai_runs: 0,
  ai_operations: 0,
};

test('a project member reads the project chat tree; non-members and denied users cannot', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const memberView = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.viewer },
      (client) => treeCounts(client, scenario),
    );
    expect(memberView).toEqual(VISIBLE_TREE);
    const nonMemberView = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.member },
      (client) => treeCounts(client, scenario),
    );
    expect(nonMemberView).toEqual(HIDDEN_TREE);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.editor,
      setByUserId: scenario.users.admin,
    });
    const deniedView = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.editor },
      (client) => treeCounts(client, scenario),
    );
    expect(deniedView).toEqual(HIDDEN_TREE);
    // A denied owner's own chat inside the project goes to zero rows: the
    // owner arm is disjoint and grants nothing on project-bound rows.
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const deniedOwnerChat = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chats WHERE id=$1',
              [scenario.projectChatId],
            )
          ).rows[0]!.count,
        ),
    );
    expect(deniedOwnerChat).toBe(0);
  } finally {
    await pools.close();
  }
});

test('a standalone chat is readable by its owner and share recipient, and shares grant nothing on project chats', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const countChat = async (userId: string, chatId: string) =>
      withAppTenant(
        pools.app,
        { orgId: scenario.orgId, userId },
        async (client) =>
          Number(
            (
              await client.query<{ count: string }>(
                'SELECT count(*) FROM app.chats WHERE id=$1',
                [chatId],
              )
            ).rows[0]!.count,
          ),
      );
    expect(
      await countChat(scenario.users.owner, scenario.standaloneChatId),
    ).toBe(1);
    // No share yet: an org member without a grant sees nothing.
    expect(
      await countChat(scenario.users.viewer, scenario.standaloneChatId),
    ).toBe(0);
    await chatShare(pools.migrator, {
      orgId: scenario.orgId,
      chatId: scenario.standaloneChatId,
      userId: scenario.users.viewer,
      grantedByUserId: scenario.users.owner,
    });
    expect(
      await countChat(scenario.users.viewer, scenario.standaloneChatId),
    ).toBe(1);
    // A share written directly on a project chat is inert — the predicate
    // only honors shares on standalone rows.
    await chatShare(pools.migrator, {
      orgId: scenario.orgId,
      chatId: scenario.projectChatId,
      userId: scenario.users.member,
      grantedByUserId: scenario.users.owner,
    });
    expect(
      await countChat(scenario.users.member, scenario.projectChatId),
    ).toBe(0);
  } finally {
    await pools.close();
  }
});

test('chats INSERT with project_id requires owner/editor access on the project', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const insertChat = async (userId: string, chatId: string) =>
      withAppTenant(
        pools.app,
        { orgId: scenario.orgId, userId },
        async (client) => {
          await client.query(
            `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id)
             VALUES ($1,$2,$3,'created in project',$4)`,
            [chatId, scenario.orgId, userId, scenario.projectId],
          );
          return Number(
            (
              await client.query<{ count: string }>(
                'SELECT count(*) FROM app.chats WHERE id=$1',
                [chatId],
              )
            ).rows[0]!.count,
          );
        },
      );
    const refusal = async (userId: string) =>
      withAppTenant(
        pools.app,
        { orgId: scenario.orgId, userId },
        async (client) => {
          try {
            await client.query(
              `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id)
               VALUES ($1,$2,$3,'created in project',$4)`,
              [randomUUID(), scenario.orgId, userId, scenario.projectId],
            );
            return 'allowed';
          } catch (error) {
            return errorCode(error);
          }
        },
      );
    // The project owner and an editor land project-bound chats and can read
    // them back inside the same transaction.
    expect(await insertChat(scenario.users.owner, randomUUID())).toBe(1);
    expect(await insertChat(scenario.users.editor, randomUUID())).toBe(1);
    // Viewer, plain member, outsider and (after a migrator-written deny) a
    // denied editor are all refused at WITH CHECK.
    expect(await refusal(scenario.users.viewer)).toBe('42501');
    expect(await refusal(scenario.users.member)).toBe('42501');
    expect(await refusal(scenario.users.outsider)).toBe('42501');
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.editor,
      setByUserId: scenario.users.admin,
    });
    expect(await refusal(scenario.users.editor)).toBe('42501');
  } finally {
    await pools.close();
  }
});

test('ai_runs and ai_operations stay initiator-written even when members can read them', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const viewer = { orgId: scenario.orgId, userId: scenario.users.viewer };
    const member = { orgId: scenario.orgId, userId: scenario.users.member };
    // Non-initiator UPDATEs hide behind the read arm: the row is invisible,
    // so the statement matches zero rows rather than erroring.
    const viewerUpdate = await withAppTenant(
      pools.app,
      viewer,
      async (client) => ({
        runs: (
          await client.query(
            "UPDATE app.ai_runs SET input_text='x' WHERE id=$1",
            [scenario.runId],
          )
        ).rowCount,
        operations: (
          await client.query(
            'UPDATE app.ai_operations SET tool_version=2 WHERE id=$1',
            [scenario.operationId],
          )
        ).rowCount,
      }),
    );
    expect(viewerUpdate).toEqual({ runs: 0, operations: 0 });
    const memberUpdate = await withAppTenant(
      pools.app,
      member,
      async (client) =>
        (
          await client.query(
            'UPDATE app.ai_operations SET tool_version=2 WHERE id=$1',
            [scenario.operationId],
          )
        ).rowCount,
    );
    expect(memberUpdate).toBe(0);
    // INSERTs are refused outright — by the write-fence trigger or the
    // restrictive WITH CHECK, whichever fires first.
    const viewerInsert = await withAppTenant(
      pools.app,
      viewer,
      async (client) => {
        try {
          await client.query(
            `INSERT INTO app.ai_operations(id,org_id,run_id,step_id,call_occurrence,
               tool_name,tool_version,idempotency_mode,args,args_hash,snapshot_hash,
               approval_required,status)
             VALUES ($1,$2,$3,$4,9,'fixture-tool',1,'read','{}',
               'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
               'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
               false,'pending')`,
            [
              randomUUID(),
              scenario.orgId,
              scenario.runId,
              scenario.stepId,
            ],
          );
          return 'allowed';
        } catch (error) {
          return errorCode(error);
        }
      },
    );
    expect(['42501', '23514']).toContain(viewerInsert);
    // A denied initiator loses the write arm as well — the run row itself is
    // invisible, so UPDATEs match nothing.
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const deniedOwnerUpdate = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query(
            "UPDATE app.ai_runs SET input_text='x' WHERE id=$1",
            [scenario.runId],
          )
        ).rowCount,
    );
    expect(deniedOwnerUpdate).toBe(0);
  } finally {
    await pools.close();
  }
});

test('chat_create_requests INSERT applies the same project gate and binds the chat', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const insertReceipt = async (userId: string, chatId: string) =>
      withAppTenant(
        pools.app,
        { orgId: scenario.orgId, userId },
        async (client) => {
          try {
            await client.query(
              `INSERT INTO app.chat_create_requests(org_id,owner_user_id,request_id,
                 chat_id,user_message_id,assistant_message_id,project_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [
                scenario.orgId,
                userId,
                randomUUID(),
                chatId,
                randomUUID(),
                randomUUID(),
                scenario.projectId,
              ],
            );
            return 'ok';
          } catch (error) {
            return errorCode(error);
          }
        },
      );
    // Editor receipts for their own project chat pass the gate.
    expect(
      await insertReceipt(scenario.users.editor, scenario.editorChatId),
    ).toBe('ok');
    // The materialize trigger binds a NULL-project chat to the receipt's
    // project — the owner receipt for the standalone chat proves the copy.
    expect(
      await insertReceipt(scenario.users.owner, scenario.standaloneChatId),
    ).toBe('ok');
    const bound = await pools.migrator.query<{ project_id: string | null }>(
      'SELECT project_id FROM app.chats WHERE org_id=$1 AND id=$2',
      [scenario.orgId, scenario.standaloneChatId],
    );
    expect(bound.rows[0]!.project_id).toBe(scenario.projectId);
    // Viewers and non-members are refused at WITH CHECK.
    expect(
      await insertReceipt(scenario.users.viewer, scenario.viewerChatId),
    ).toBe('42501');
    const memberChat = randomUUID();
    await pools.migrator.query(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id)
       VALUES ($1,$2,$3,'member standalone',NULL)`,
      [memberChat, scenario.orgId, scenario.users.member],
    );
    expect(
      await insertReceipt(scenario.users.member, memberChat),
    ).toBe('42501');
  } finally {
    await pools.close();
  }
});
