import { createHash } from 'node:crypto';
import type { ChatSearchPage, ChatSearchRequest } from '@lexon/contracts';
import {
  ChatApiError,
  ChatSearchPageSchema,
  ChatSearchRequestSchema,
} from '@lexon/contracts';
import { z } from 'zod';
import {
  ChatSearchRepository,
  TenantDatabase,
  type ChatSearchCursor,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';

const cursorSchema = z.tuple([
  z.literal(1),
  z.string().regex(/^[a-f0-9]{64}$/),
  z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  z.iso.datetime(),
  z.uuid(),
]);

function digest(actor: RunActor, query: string): string {
  return createHash('sha256')
    .update(`${actor.orgId}\0${actor.userId}\0${query}`, 'utf8')
    .digest('hex');
}

function encodeCursor(input: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string,
  actor: RunActor,
  queryDigest: string,
): ChatSearchCursor {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed[1] !== queryDigest) throw new Error();
    return {
      score: parsed[2],
      activityAt: parsed[3],
      chatId: parsed[4],
      messageId: null,
    };
  } catch {
    throw new ChatApiError('CHAT_CONFLICT');
  }
}

function safeSnippet(text: string, query: string) {
  const parts = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  let match: RegExpExecArray | null = null;
  for (const part of parts) {
    match = new RegExp(escapeRegExp(part), 'iu').exec(text);
    if (match) break;
  }
  const maxLength = 500;
  let start = match ? Math.max(0, match.index - 180) : 0;
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start] ?? '')) start++;
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1] ?? '')) end--;
  const excerpt = text.slice(start, end);
  return {
    excerpt,
    matchStart:
      match && match.index >= start && match.index + match[0].length <= end
        ? match.index - start
        : null,
    matchEnd:
      match && match.index >= start && match.index + match[0].length <= end
        ? match.index - start + match[0].length
        : null,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isStatementTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '57014'
  );
}

export class ChatSearchService {
  private readonly repository = new ChatSearchRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly authorization: RunAuthorizationService,
  ) {}

  async search(
    actor: RunActor,
    input: ChatSearchRequest,
  ): Promise<ChatSearchPage> {
    this.authorization.assertLiveActor(actor);
    const request = ChatSearchRequestSchema.parse(input);
    const queryDigest = digest(actor, request.query);
    const cursor = request.cursor
      ? decodeCursor(request.cursor, actor, queryDigest)
      : null;
    try {
      return await this.database.withTenant(
        { orgId: actor.orgId, userId: actor.userId },
        async (tx) => {
          const rows = await this.repository.search(
            tx,
            request.query,
            cursor,
            request.limit,
          );
          const hasMore = rows.length > request.limit;
          const pageRows = hasMore ? rows.slice(0, request.limit) : rows;
          const items = pageRows.map((row) => ({
            chatId: row.chatId,
            title: row.title || 'New chat',
            messageId: row.messageId,
            ...safeSnippet(row.excerpt ?? '', request.query),
            updatedAt: row.updatedAt.toISOString(),
          }));
          const last = pageRows.at(-1);
          return ChatSearchPageSchema.parse({
            items,
            pageInfo: {
              nextCursor:
                hasMore && last
                  ? encodeCursor([
                      1,
                      queryDigest,
                      last.score,
                      last.activityAt,
                      last.chatId,
                    ])
                  : null,
            },
          });
        },
      );
    } catch (error) {
      if (isStatementTimeout(error))
        throw new ChatApiError('CHAT_SEARCH_TIMEOUT');
      throw error;
    }
  }
}
