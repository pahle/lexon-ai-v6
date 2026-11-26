import { z } from 'zod';
import * as contracts from '@lexon/contracts';
import { chatClientError, ChatClientError } from './chat-errors';
import { notifyIdentityFallbackHint } from './identity-client';
import { parseJsonResponse, requestJson } from './request-json';

export interface MattersClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

const ProjectDetailSchema = contracts.ProjectSummarySchema.and(
  z.strictObject({ instructions: z.string().nullable() }),
);
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

const ProjectChatsSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: contracts.UuidSchema,
      title: z.string(),
      updatedAt: z.iso.datetime(),
    }),
  ),
});
export type ProjectChatItem = z.infer<
  typeof ProjectChatsSchema
>['items'][number];

const MemberListSchema = z.strictObject({
  items: z.array(contracts.ProjectMemberSummarySchema),
});
const DenyListSchema = z.strictObject({
  items: z.array(contracts.DenySummarySchema),
});
const OrgProjectPageSchema = z.strictObject({
  items: z.array(contracts.OrgProjectSummarySchema),
  pageInfo: z.strictObject({ nextCursor: z.string().max(256).nullable() }),
});

export interface MattersApi {
  list(
    input: {
      q?: string;
      filter?: 'all' | 'owned' | 'shared';
      sort?: 'name' | 'activity';
      cursor?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<contracts.ProjectPage>;
  create(input: contracts.ProjectCreateInput): Promise<ProjectDetail>;
  detail(projectId: string): Promise<ProjectDetail>;
  updateSettings(
    projectId: string,
    input: contracts.ProjectSettingsInput,
  ): Promise<ProjectDetail>;
  updateInstructions(
    projectId: string,
    input: contracts.ProjectInstructionsInput,
  ): Promise<{ instructions: string | null }>;
  remove(projectId: string): Promise<void>;
  listChats(projectId: string): Promise<ProjectChatItem[]>;
  listMembers(projectId: string): Promise<contracts.ProjectMemberSummary[]>;
  addMember(
    projectId: string,
    input: contracts.MemberAddInput,
  ): Promise<contracts.ProjectMemberSummary>;
  updateMemberRole(
    projectId: string,
    userId: string,
    input: contracts.MemberRoleInput,
  ): Promise<contracts.ProjectMemberSummary>;
  removeMember(projectId: string, userId: string): Promise<void>;
  searchMembers(
    input: contracts.OrgMemberSearchQuery,
    signal?: AbortSignal,
  ): Promise<contracts.OrgMemberSummary[]>;
  orgList(input?: { q?: string; cursor?: string; limit?: number }): Promise<{
    items: contracts.OrgProjectSummary[];
    nextCursor: string | null;
  }>;
  listDenies(projectId: string): Promise<contracts.DenySummary[]>;
  addDeny(projectId: string, input: contracts.DenyAddInput): Promise<unknown>;
  removeDeny(projectId: string, userId: string): Promise<void>;
}

export function createMattersClient(options: MattersClientOptions): MattersApi {
  if (
    !options.baseUrl.startsWith('/') ||
    options.baseUrl.startsWith('//') ||
    /[\\?#]/.test(options.baseUrl)
  )
    throw new Error('Matters API must use the same origin');

  const base = options.baseUrl.replace(/\/$/, '');
  const id = (value: string) => contracts.UuidSchema.parse(value);

  async function call<T>(
    path: string,
    schema: z.ZodType<T> | null,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await requestJson(
      base + path,
      { fetch: options.fetch, method, body, signal },
      () => new ChatClientError('AI_PROVIDER_UNAVAILABLE', 503),
    );
    if (notifyIdentityFallbackHint(response))
      throw new ChatClientError('AI_ACCESS_REVOKED', response.status);
    if (!response.ok) throw await chatClientError(response);
    return parseJsonResponse(
      response,
      schema,
      () => new ChatClientError('AI_INTERNAL', 503),
    );
  }

  const pageQuery = (input: {
    q?: string;
    cursor?: string;
    limit?: number;
    filter?: string;
    sort?: string;
  }) => {
    const query = new URLSearchParams();
    if (input.q) query.set('q', input.q);
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    if (input.filter) query.set('filter', input.filter);
    if (input.sort) query.set('sort', input.sort);
    return query.size > 0 ? `?${query.toString()}` : '';
  };

  return {
    list: (input, signal) =>
      call(
        `/projects${pageQuery(input)}`,
        contracts.ProjectPageSchema,
        'GET',
        undefined,
        signal,
      ),
    create: (input) =>
      call(
        '/projects',
        ProjectDetailSchema,
        'POST',
        contracts.ProjectCreateInputSchema.parse(input),
      ),
    detail: (projectId) =>
      call(`/projects/${id(projectId)}`, ProjectDetailSchema),
    updateSettings: (projectId, input) =>
      call(
        `/projects/${id(projectId)}`,
        ProjectDetailSchema,
        'PATCH',
        contracts.ProjectSettingsInputSchema.parse(input),
      ),
    updateInstructions: (projectId, input) =>
      call(
        `/projects/${id(projectId)}/instructions`,
        z.strictObject({ instructions: z.string().nullable() }),
        'PATCH',
        contracts.ProjectInstructionsInputSchema.parse(input),
      ),
    remove: (projectId) => call(`/projects/${id(projectId)}`, null, 'DELETE'),
    listChats: async (projectId) =>
      (await call(`/projects/${id(projectId)}/chats`, ProjectChatsSchema))
        .items,
    listMembers: async (projectId) =>
      (await call(`/projects/${id(projectId)}/members`, MemberListSchema))
        .items,
    addMember: (projectId, input) =>
      call(
        `/projects/${id(projectId)}/members`,
        contracts.ProjectMemberSummarySchema,
        'POST',
        contracts.MemberAddInputSchema.parse(input),
      ),
    updateMemberRole: (projectId, userId, input) =>
      call(
        `/projects/${id(projectId)}/members/${id(userId)}`,
        contracts.ProjectMemberSummarySchema,
        'PATCH',
        contracts.MemberRoleInputSchema.parse(input),
      ),
    removeMember: (projectId, userId) =>
      call(`/projects/${id(projectId)}/members/${id(userId)}`, null, 'DELETE'),
    searchMembers: async (input, signal) =>
      (
        await call(
          `/org/members/search?q=${encodeURIComponent(input.q)}${input.limit !== undefined ? `&limit=${input.limit}` : ''}`,
          contracts.OrgMemberSearchResultSchema,
          'GET',
          undefined,
          signal,
        )
      ).items,
    orgList: async (input = {}) => {
      const page = await call(
        `/org/projects${pageQuery(input)}`,
        OrgProjectPageSchema,
      );
      return { items: page.items, nextCursor: page.pageInfo.nextCursor };
    },
    listDenies: async (projectId) =>
      (await call(`/org/projects/${id(projectId)}/denies`, DenyListSchema))
        .items,
    addDeny: (projectId, input) =>
      call(
        `/org/projects/${id(projectId)}/denies`,
        null,
        'POST',
        contracts.DenyAddInputSchema.parse(input),
      ),
    removeDeny: (projectId, userId) =>
      call(
        `/org/projects/${id(projectId)}/denies/${id(userId)}`,
        null,
        'DELETE',
      ),
  };
}
