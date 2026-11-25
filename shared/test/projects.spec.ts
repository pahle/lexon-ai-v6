import { describe, expect, it } from 'vitest';
import {
  ChatShareSummarySchema,
  DenyAddInputSchema,
  DenySummarySchema,
  MattersListQuerySchema,
  MemberAddInputSchema,
  MemberRoleInputSchema,
  OrgMemberSearchQuerySchema,
  OrgMemberSummarySchema,
  OrgProjectsQuerySchema,
  OrgProjectSummarySchema,
  ProjectAccessSchema,
  ProjectCreateInputSchema,
  ProjectInstructionsInputSchema,
  ProjectMemberSummarySchema,
  ProjectPageSchema,
  ProjectRoleSchema,
  ProjectSettingsInputSchema,
  ProjectSummarySchema,
  ShareAddInputSchema,
} from '../src/projects.js';
import {
  ChatAccessSchema,
  ChatDetailSchema,
  ChatPageSchema,
} from '../src/chat.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const projectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const chatId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const stamp = '2026-11-25T00:00:00.000Z';

describe('project input contracts', () => {
  it('accepts a minimal create and full create/settings shapes', () => {
    expect(ProjectCreateInputSchema.parse({ name: 'Matter A' })).toEqual({
      name: 'Matter A',
    });
    const full = {
      name: 'Matter A',
      matterNumber: '2026/001',
      practiceArea: 'Litigation',
    };
    expect(ProjectCreateInputSchema.parse(full)).toEqual(full);
    expect(ProjectSettingsInputSchema.parse(full)).toEqual(full);
    expect(ProjectSettingsInputSchema.parse({ name: 'Renamed' })).toEqual({
      name: 'Renamed',
    });
    // Clearing optional metadata is explicit.
    expect(ProjectSettingsInputSchema.parse({ matterNumber: null })).toEqual({
      matterNumber: null,
    });
  });

  it('rejects out-of-shape inputs and strictObject extras', () => {
    for (const input of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(121) },
      { name: 'Matter A', matterNumber: 'x'.repeat(65) },
      { name: 'Matter A', practiceArea: 'x'.repeat(121) },
      { name: 'Matter A', userId },
      { name: 'Matter A', orgId: id },
    ])
      expect(ProjectCreateInputSchema.safeParse(input).success).toBe(false);
    for (const input of [
      {},
      { name: 'x'.repeat(121) },
      { name: 'Matter A', extra: true },
    ])
      expect(ProjectSettingsInputSchema.safeParse(input).success).toBe(false);
  });

  it('bounds instructions at exactly 8,000 characters and allows clearing', () => {
    const atLimit = 'x'.repeat(8000);
    expect(
      ProjectInstructionsInputSchema.parse({ instructions: atLimit }),
    ).toEqual({ instructions: atLimit });
    expect(
      ProjectInstructionsInputSchema.safeParse({
        instructions: 'x'.repeat(8001),
      }).success,
    ).toBe(false);
    expect(
      ProjectInstructionsInputSchema.parse({ instructions: null }),
    ).toEqual({ instructions: null });
    for (const input of [
      {},
      { instructions: 42 },
      { instructions: 'ok', text: 'extra' },
    ])
      expect(ProjectInstructionsInputSchema.safeParse(input).success).toBe(
        false,
      );
  });

  it('keeps member/deny/share inputs strict and role-bounded', () => {
    expect(ProjectRoleSchema.options).toEqual(['viewer', 'editor']);
    expect(ProjectAccessSchema.options).toEqual(['owner', 'editor', 'viewer']);
    expect(MemberAddInputSchema.parse({ userId, role: 'editor' })).toEqual({
      userId,
      role: 'editor',
    });
    expect(MemberRoleInputSchema.parse({ role: 'viewer' })).toEqual({
      role: 'viewer',
    });
    expect(DenyAddInputSchema.parse({ userId })).toEqual({ userId });
    for (const schema of [
      MemberAddInputSchema,
      MemberRoleInputSchema,
      DenyAddInputSchema,
    ])
      expect(schema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(
      MemberAddInputSchema.safeParse({ userId, role: 'owner' }).success,
    ).toBe(false);
    expect(
      MemberAddInputSchema.safeParse({ userId, role: 'editor', orgId: id })
        .success,
    ).toBe(false);
    // Share recipients: 1..50 uuids.
    expect(ShareAddInputSchema.parse({ userIds: [userId] })).toEqual({
      userIds: [userId],
    });
    expect(
      ShareAddInputSchema.parse({
        userIds: Array.from({ length: 50 }, () => userId),
      }).userIds,
    ).toHaveLength(50);
    for (const input of [
      { userIds: [] },
      { userIds: Array.from({ length: 51 }, () => userId) },
      { userIds: [userId, 'not-a-uuid'] },
      { userIds: [userId], userId },
    ])
      expect(ShareAddInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('project summary contracts', () => {
  const summary = {
    version: 1,
    id: projectId,
    name: 'Matter A',
    matterNumber: '2026/001',
    practiceArea: 'Litigation',
    owner: { userId, name: 'Owner One' },
    myRole: 'editor',
    memberCount: 3,
    chatCount: 7,
    lastActivityAt: stamp,
    createdAt: stamp,
  };

  it('parses the member-facing summary and a page of them', () => {
    expect(ProjectSummarySchema.parse(summary)).toEqual(summary);
    expect(
      ProjectPageSchema.parse({
        items: [summary],
        pageInfo: { nextCursor: 'cursor-1' },
      }).items,
    ).toHaveLength(1);
    for (const item of [
      { ...summary, myRole: 'member' },
      { ...summary, instructions: 'hidden' },
      { ...summary, memberCount: -1 },
      { ...summary, owner: { userId } },
    ])
      expect(ProjectSummarySchema.safeParse(item).success).toBe(false);
  });

  it('keeps the org metadata summary free of instructions and member roles', () => {
    const orgSummary = {
      version: 1,
      id: projectId,
      name: 'Matter A',
      matterNumber: '2026/001',
      practiceArea: 'Litigation',
      owner: { userId, name: 'Owner One' },
      memberCount: 3,
      chatCount: 7,
      lastActivityAt: stamp,
      createdAt: stamp,
    };
    expect(OrgProjectSummarySchema.parse(orgSummary)).toEqual(orgSummary);
    for (const item of [
      { ...orgSummary, instructions: 'never' },
      { ...orgSummary, myRole: 'viewer' },
    ])
      expect(OrgProjectSummarySchema.safeParse(item).success).toBe(false);
  });

  it('parses member, deny and share summaries', () => {
    const member = {
      version: 1,
      memberId: userId,
      userId,
      name: 'Member One',
      email: 'member@lexon.id',
      role: 'viewer',
      createdAt: stamp,
    };
    expect(ProjectMemberSummarySchema.parse(member)).toEqual(member);
    expect(
      ProjectMemberSummarySchema.safeParse({ ...member, role: 'owner' })
        .success,
    ).toBe(false);
    const deny = {
      version: 1,
      userId,
      name: 'Member One',
      email: 'member@lexon.id',
      setByUserId: id,
      createdAt: stamp,
    };
    expect(DenySummarySchema.parse(deny)).toEqual(deny);
    const share = {
      version: 1,
      userId,
      name: 'Member One',
      email: 'member@lexon.id',
      grantedByUserId: id,
      createdAt: stamp,
    };
    expect(ChatShareSummarySchema.parse(share)).toEqual(share);
  });
});

describe('project query contracts', () => {
  it('defaults the Matters list query and validates filter/sort', () => {
    expect(MattersListQuerySchema.parse({})).toEqual({
      filter: 'all',
      sort: 'activity',
    });
    expect(
      MattersListQuerySchema.parse({
        q: 'matter',
        filter: 'shared',
        sort: 'name',
        cursor: 'abc',
        limit: '5',
      }),
    ).toEqual({
      q: 'matter',
      filter: 'shared',
      sort: 'name',
      cursor: 'abc',
      limit: 5,
    });
    for (const input of [
      { filter: 'mine' },
      { sort: 'created' },
      { limit: '0' },
      { limit: '101' },
      { userId },
    ])
      expect(MattersListQuerySchema.safeParse(input).success).toBe(false);
  });

  it('parses org projects and org member search queries', () => {
    expect(OrgProjectsQuerySchema.parse({ q: 'm', limit: '10' })).toEqual({
      q: 'm',
      limit: 10,
    });
    expect(OrgProjectsQuerySchema.parse({})).toEqual({});
    for (const input of [
      { q: 'x'.repeat(201) },
      { filter: 'all' },
      { limit: '0' },
    ])
      expect(OrgProjectsQuerySchema.safeParse(input).success).toBe(false);
    expect(OrgMemberSearchQuerySchema.parse({ q: 'adi', limit: '5' })).toEqual({
      q: 'adi',
      limit: 5,
    });
    expect(OrgMemberSearchQuerySchema.parse({ q: 'adi' })).toEqual({
      q: 'adi',
    });
    for (const input of [
      {},
      { q: '' },
      { q: 'a', userId },
      { q: 'a', limit: '0' },
      { q: 'a', limit: '51' },
    ])
      expect(OrgMemberSearchQuerySchema.safeParse(input).success).toBe(false);
  });

  it('parses the org member summary used by pickers', () => {
    const member = {
      version: 1,
      userId,
      name: 'Member One',
      email: 'member@lexon.id',
      role: 'admin',
    };
    expect(OrgMemberSummarySchema.parse(member)).toEqual(member);
    expect(
      OrgMemberSummarySchema.safeParse({ ...member, memberId: id }).success,
    ).toBe(false);
  });
});

describe('chat detail access contract', () => {
  const tree = {
    id: chatId,
    title: 'Case notes',
    messages: [],
    viewedLeafId: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  it('accepts only owner|reader on ChatAccessSchema', () => {
    expect(ChatAccessSchema.options).toEqual(['owner', 'reader']);
    for (const value of ['viewer', 'editor', 'member', ''])
      expect(ChatAccessSchema.safeParse(value).success).toBe(false);
  });

  it('requires access on the chat detail payload', () => {
    expect(ChatDetailSchema.parse({ ...tree, access: 'owner' }).access).toBe(
      'owner',
    );
    expect(ChatDetailSchema.parse({ ...tree, access: 'reader' }).access).toBe(
      'reader',
    );
    for (const payload of [
      tree,
      { ...tree, access: 'viewer' },
      { ...tree, access: null },
    ])
      expect(ChatDetailSchema.safeParse(payload).success).toBe(false);
  });

  it('round-trips projectName on ChatPage items', () => {
    const item = {
      id: chatId,
      title: 'Case notes',
      updatedAt: stamp,
      lastMessageAt: stamp,
      awaitingUser: false,
      projectName: 'Matter A',
    };
    expect(
      ChatPageSchema.parse({ items: [item], pageInfo: { nextCursor: null } })
        .items[0],
    ).toEqual(item);
    const without = { ...item };
    delete (without as Record<string, unknown>).projectName;
    expect(
      ChatPageSchema.parse({
        items: [without],
        pageInfo: { nextCursor: null },
      }).items[0],
    ).toEqual(without);
  });
});
