import { createHash } from 'node:crypto';
import type { ChatSearchPage, ChatSearchRequest } from '@lexon/contracts';
import { ChatApiError, ChatSearchPageSchema, ChatSearchRequestSchema } from '@lexon/contracts';
import { z } from 'zod';
import {
  ChatSearchRepository,
  TenantDatabase,
  type ChatSearchCursor,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';

const cursorSchema = z.strictObject({
  version: z.literal(1),
  orgId: z.uuid(),
  userId: z.uuid(),
  queryDigest: z.string().regex(/^[a-f0-9]{64}$/),
  score: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  activityAt: z.iso.datetime(),
  chatId: z.uuid(),
});

function digest(query: string): string {
  return createHash('sha256').update(query, 'utf8').digest('hex');
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
    if (
      parsed.orgId !== actor.orgId ||
      parsed.userId !== actor.userId ||
      parsed.queryDigest !== queryDigest
    )
      throw new Error();
    return {
      score: parsed.score,
      activityAt: parsed.activityAt,
      chatId: parsed.chatId,
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
    matchStart: match && match.index >= start && match.index + match[0].length <= end
      ? match.index - start
      : null,
    matchEnd: match && match.index >= start && match.index + match[0].length <= end
      ? match.index - start + match[0].length
      : null,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class ChatSearchService {
  private readonly repository = new ChatSearchRepository();

  constructor(private readonly database: TenantDatabase) {}

  async search(actor: RunActor, input: ChatSearchRequest): Promise<ChatSearchPage> {
    const request = ChatSearchRequestSchema.parse(input);
    const queryDigest = digest(request.query);
    const cursor = request.cursor
      ? decodeCursor(request.cursor, actor, queryDigest)
      : null;
    return this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const rows = await this.repository.search(
          tx,
          request.query,
          cursor,
          request.limit + 1,
        );
        const hasMore = rows.length > request.limit;
        const pageRows = hasMore ? rows.slice(0, request.limit) : rows;
        const items = pageRows.map((row) => ({
          chatId: row.chatId,
          title: row.title || 'New chat',
          messageId: row.messageId,
          ...safeSnippet(row.excerpt, request.query),
          updatedAt: row.updatedAt.toISOString(),
        }));
        const last = pageRows.at(-1);
        return ChatSearchPageSchema.parse({
          items,
          pageInfo: {
            nextCursor:
              hasMore && last
                ? encodeCursor({
                    version: 1,
                    orgId: actor.orgId,
                    userId: actor.userId,
                    queryDigest,
                    score: last.score,
                    activityAt: last.activityAt,
                    chatId: last.chatId,
                  })
                : null,
          },
        });
      },
    );
  }
}
