import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  createProjectScenario,
  projectDeny,
} from '../../src/infrastructure/db/testing/project-fixture.js';
import { TenantDatabase } from '../../src/infrastructure/db/index.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import {
  CHAT_PROFILES,
  PROJECT_CONTEXT_ID,
} from '../../src/modules/chat/chat-profiles.js';
import { ProjectContextProvider } from '../../src/modules/chat/project-context.js';
import { createProductionRunRegistry } from '../../src/modules/chat/run-registry.js';

// F6 §9: the project context provider emits the bound project's name and
// instructions as an untrusted piece under the initiator's own claims — the
// executor's fenceUntrusted framing carries it, so instructions can never
// grant tools or change the model. The reads run through the real
// TenantDatabase/RLS chain against the seeded F6 scenario.

const projectBudget =
  CHAT_PROFILES['project-chat'].contextBudgets[PROJECT_CONTEXT_ID]!;

function collect(
  provider: ProjectContextProvider,
  args: {
    actor: RunActor;
    runId: string;
    input?: Readonly<Record<string, unknown>>;
    budget?: number;
  },
) {
  return provider.collect({
    actor: args.actor,
    runId: args.runId,
    input: args.input ?? { prompt: 'Summarize the matter posture.' },
    budget: args.budget ?? projectBudget,
  });
}

test('emits the project name and instructions as one untrusted piece for a project-bound run', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    const scenario = await createProjectScenario(pools);
    const provider = new ProjectContextProvider(database);
    const pieces = await collect(provider, {
      actor: {
        orgId: scenario.orgId,
        userId: scenario.users.owner,
      } as RunActor,
      runId: scenario.runId,
    });
    expect(pieces).toEqual([
      {
        label: 'project',
        text: 'Project: F6 matter\n\nProject instructions:\nseed instructions',
      },
    ]);
    // The serialized piece stays inside the profile's context budget.
    expect(Buffer.byteLength(JSON.stringify(pieces))).toBeLessThanOrEqual(
      projectBudget,
    );
  } finally {
    await database.close();
    await pools.close();
  }
});

test('returns no pieces for a standalone (project-less) run', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    const scenario = await createProjectScenario(pools);
    // A run bound to the standalone chat: the provider's join resolves no
    // project row and emits nothing.
    const standaloneRunId = randomUUID();
    const client = await pools.migrator.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
           resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens)
         VALUES ($1,$2,$3,'chat',1,
           jsonb_build_object('resourceIds',jsonb_build_array($4::text)),
           'synthetic/test','seed input','completed',1000,1000)`,
        [
          standaloneRunId,
          scenario.orgId,
          scenario.users.owner,
          scenario.standaloneChatId,
        ],
      );
      await client.query(
        `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
         VALUES ($1,$2,$3,'answer')`,
        [scenario.orgId, scenario.standaloneChatId, standaloneRunId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const provider = new ProjectContextProvider(database);
    const pieces = await collect(provider, {
      actor: {
        orgId: scenario.orgId,
        userId: scenario.users.owner,
      } as RunActor,
      runId: standaloneRunId,
    });
    expect(pieces).toEqual([]);
  } finally {
    await database.close();
    await pools.close();
  }
});

test('returns no pieces once the initiator lost project access (RLS closes the join)', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    const scenario = await createProjectScenario(pools);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const provider = new ProjectContextProvider(database);
    const pieces = await collect(provider, {
      actor: {
        orgId: scenario.orgId,
        userId: scenario.users.owner,
      } as RunActor,
      runId: scenario.runId,
    });
    expect(pieces).toEqual([]);
  } finally {
    await database.close();
    await pools.close();
  }
});

test.each<
  [string, { input?: Readonly<Record<string, unknown>>; budget?: number }]
>([
  ['the wrong context budget', { budget: projectBudget - 1 }],
  ['a missing prompt', { input: {} }],
  ['a non-string prompt', { input: { prompt: 12 } }],
  ['a blank prompt', { input: { prompt: '   ' } }],
])('rejects %s before any tenant read', async (_label, overrides) => {
  // Validation precedes the tenant read, so a stub database proves no I/O ran.
  const provider = new ProjectContextProvider({
    withTenant: async () => {
      throw new Error('tenant read should not run');
    },
  } as never);
  await expect(
    collect(provider, {
      actor: {
        orgId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      } as RunActor,
      runId: '33333333-3333-4333-8333-333333333333',
      ...overrides,
    }),
  ).rejects.toThrow('AI context request denied');
});

test('the production registry resolves the project provider only through contextBudgets', () => {
  const registry = createProductionRunRegistry([
    new ProjectContextProvider({ withTenant: async () => undefined } as never),
  ]);
  // Selection is purely by profile contextBudgets — the engine keeps zero
  // project branches: 'chat' carries no 'project' entry, 'project-chat' does.
  expect(CHAT_PROFILES.chat.contextBudgets).not.toHaveProperty(
    PROJECT_CONTEXT_ID,
  );
  expect(CHAT_PROFILES['project-chat'].contextBudgets[PROJECT_CONTEXT_ID]).toBe(
    projectBudget,
  );
  expect(registry.context(PROJECT_CONTEXT_ID)?.id).toBe(PROJECT_CONTEXT_ID);
  expect(registry.profile('project-chat')?.id).toBe('project-chat');
});
