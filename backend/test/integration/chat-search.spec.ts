import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  ChatMessageRepository,
  ChatSearchRepository,
} from '../../src/infrastructure/db/index.js';

test('ranked chat search returns owner matches and keeps search terms out of cursors', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-search-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const ownerIdentity = await identity(origin, owner);
    const firstId = randomUUID();
    const secondId = randomUUID();
    const deletedId = randomUUID();
    const titleOnlyId = randomUUID();
    const secretTerm = `ranked-canary-${randomUUID()}`;
    await fixture.chat.createFor(ownerIdentity, firstId, 'First discussion');
    await fixture.chat.createFor(ownerIdentity, secondId, 'Second discussion');
    await fixture.chat.createFor(
      ownerIdentity,
      deletedId,
      `Deleted ${secretTerm}`,
    );
    await fixture.chat.createFor(
      ownerIdentity,
      titleOnlyId,
      'Title-only legislation',
    );
    const messages = new ChatMessageRepository();
    await fixture.database.withTenant(ownerIdentity, async (tx) => {
      await messages.insertUser(tx, {
        chatId: firstId,
        messageId: randomUUID(),
        parentMessageId: null,
        text: `The ${secretTerm} governs this agreement`,
        effort: 'high',
      });
      await messages.insertUser(tx, {
        chatId: secondId,
        messageId: randomUUID(),
        parentMessageId: null,
        text: `A further ${secretTerm} discussion`,
        effort: 'high',
      });
      await messages.insertUser(tx, {
        chatId: deletedId,
        messageId: randomUUID(),
        parentMessageId: null,
        text: `Deleted body contains ${secretTerm}`,
        effort: 'high',
      });
    });
    await fixture.chat.deleteFor(ownerIdentity, deletedId);

    const firstPageResponse = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ query: secretTerm, limit: 1 }),
    });
    expect(
      firstPageResponse.status,
      await firstPageResponse.clone().text(),
    ).toBe(200);
    const firstPage = (await firstPageResponse.json()) as {
      items: Array<{
        chatId: string;
        messageId: string | null;
        excerpt: string;
        matchStart: number | null;
        matchEnd: number | null;
      }>;
      pageInfo: { nextCursor: string | null };
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.messageId).toBeTruthy();
    expect(firstPage.items[0]?.excerpt).toContain(secretTerm);
    expect(
      firstPage.items[0]?.excerpt.slice(
        firstPage.items[0]?.matchStart ?? 0,
        firstPage.items[0]?.matchEnd ?? 0,
      ),
    ).toBe('ranked');
    expect(firstPageResponse.url).not.toContain(secretTerm);
    expect(firstPage.pageInfo.nextCursor).not.toContain(secretTerm);

    const secondPageResponse = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: secretTerm,
        limit: 1,
        cursor: firstPage.pageInfo.nextCursor,
      }),
    });
    expect(secondPageResponse.status).toBe(200);
    const secondPage = (await secondPageResponse.json()) as {
      items: Array<{ chatId: string }>;
    };
    expect(secondPage.items.map((item) => item.chatId)).toHaveLength(1);
    expect(secondPage.items[0]?.chatId).not.toBe(firstPage.items[0]?.chatId);
    expect(secondPage.items[0]?.chatId).not.toBe(deletedId);
    const testMarkers = {
      start: '__LXTESTSTART__',
      end: '__LXTESTEND__',
    };
    const lookaheadRows = await fixture.database.withTenant(
      ownerIdentity,
      (tx) =>
        new ChatSearchRepository().search(tx, secretTerm, null, 1, testMarkers),
    );
    expect(lookaheadRows).toHaveLength(2);
    expect(
      lookaheadRows[0]?.excerpt
        ?.replaceAll(testMarkers.start, '')
        .replaceAll(testMarkers.end, ''),
    ).toContain(secretTerm);
    expect(lookaheadRows[1]?.excerpt).toBeNull();

    const titleOnly = await search(origin, owner, 'legislation');
    expect(
      titleOnly.items.find((item) => item.chatId === titleOnlyId)?.messageId,
    ).toBeNull();
    const titlePartial = await search(origin, owner, 'legislat');
    const titlePartialHit = titlePartial.items.find(
      (item) => item.chatId === titleOnlyId,
    );
    expect(titlePartialHit?.messageId).toBeNull();
    expect(
      titlePartialHit?.excerpt.slice(
        titlePartialHit.matchStart ?? 0,
        titlePartialHit.matchEnd ?? 0,
      ),
    ).toBe('legislat');

    const titleAndMessageId = randomUUID();
    const titleAndMessageChat = randomUUID();
    await fixture.chat.createFor(
      ownerIdentity,
      titleAndMessageChat,
      'contract contract contract',
    );
    await fixture.database.withTenant(ownerIdentity, (tx) =>
      messages.insertUser(tx, {
        chatId: titleAndMessageChat,
        messageId: titleAndMessageId,
        parentMessageId: null,
        text: 'contract',
        effort: 'high',
      }),
    );
    const titleAndMessage = await search(origin, owner, 'contract');
    expect(
      titleAndMessage.items.find((item) => item.chatId === titleAndMessageChat)
        ?.messageId,
    ).toBe(titleAndMessageId);

    const multiwordChat = randomUUID();
    await fixture.chat.createFor(ownerIdentity, multiwordChat, 'Exact terms');
    await fixture.database.withTenant(ownerIdentity, (tx) =>
      messages.insertUser(tx, {
        chatId: multiwordChat,
        messageId: randomUUID(),
        parentMessageId: null,
        text: 'quick contractual breaches',
        effort: 'high',
      }),
    );
    const exactLeadingTerms = await search(
      origin,
      owner,
      'quick contract breach',
    );
    expect(
      exactLeadingTerms.items.some((item) => item.chatId === multiwordChat),
    ).toBe(false);

    const trailingPunctuationChat = randomUUID();
    const trailingPunctuationMessage = randomUUID();
    await fixture.chat.createFor(
      ownerIdentity,
      trailingPunctuationChat,
      'Punctuation query',
    );
    await fixture.database.withTenant(ownerIdentity, (tx) =>
      messages.insertUser(tx, {
        chatId: trailingPunctuationChat,
        messageId: trailingPunctuationMessage,
        parentMessageId: null,
        text: 'contract',
        effort: 'high',
      }),
    );
    const trailingPunctuation = await search(origin, owner, 'contrac!');
    expect(
      trailingPunctuation.items.find(
        (item) => item.chatId === trailingPunctuationChat,
      )?.messageId,
    ).toBe(trailingPunctuationMessage);
    const punctuationOnly = await search(origin, owner, '!!!');
    expect(punctuationOnly.items).toEqual([]);

    const answerChatId = randomUUID();
    const answerTerm = `answer-index-${randomUUID()}`;
    const answerCreation = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: answerChatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Find the synthetic answer',
        effort: 'high',
      }),
    });
    expect(answerCreation.status, await answerCreation.clone().text()).toBe(
      201,
    );
    const answerRun = (await answerCreation.json()) as { runId: string };
    await fixture.chat.setRunOutputFor(
      ownerIdentity,
      answerRun.runId,
      `A canonical ${answerTerm} answer`,
    );
    const answerVector = await fixture.inspect.query(
      'SELECT search_vector::text FROM app.ai_runs WHERE id=$1',
      [answerRun.runId],
    );
    expect(answerVector.rows[0]?.search_vector).toContain("'answer'");
    const answerResults = await search(origin, owner, answerTerm);
    expect(
      answerResults.items.find((item) => item.chatId === answerChatId)
        ?.messageId,
    ).toBe(answerRun.runId);

    const longAnswerChatId = randomUUID();
    const longAnswerCreate = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: longAnswerChatId,
        userMessageId: randomUUID(),
        requestId: randomUUID(),
        text: 'Long canonical answer fixture',
        effort: 'high',
      }),
    });
    expect(longAnswerCreate.status).toBe(201);
    const longAnswerRun = (await longAnswerCreate.json()) as { runId: string };
    const longAnswerBody = `${'ordinary filler '.repeat(100)} The agreement is at the end.`;
    await fixture.chat.setRunOutputFor(
      ownerIdentity,
      longAnswerRun.runId,
      longAnswerBody,
    );
    const stemmedAnswer = await search(origin, owner, 'agreements');
    const stemmedAnswerHit = stemmedAnswer.items.find(
      (item) => item.chatId === longAnswerChatId,
    );
    expect(stemmedAnswerHit?.excerpt).toContain('agreement');
    expect(stemmedAnswerHit?.matchStart).toBeGreaterThanOrEqual(0);
    expect(stemmedAnswerHit?.matchEnd).toBeGreaterThan(
      stemmedAnswerHit?.matchStart ?? 0,
    );
    expect(
      stemmedAnswerHit?.excerpt.slice(
        stemmedAnswerHit.matchStart!,
        stemmedAnswerHit.matchEnd!,
      ),
    ).toMatch(/agreement/i);

    const branchChatId = randomUUID();
    const branchRootId = randomUUID();
    const branchCreate = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: branchChatId,
        userMessageId: branchRootId,
        requestId: randomUUID(),
        text: 'Branch resolution',
        effort: 'high',
      }),
    });
    expect(branchCreate.status).toBe(201);
    const branchRun = (await branchCreate.json()) as { runId: string };
    const olderLeafId = randomUUID();
    const newerLeafId = randomUUID();
    await fixture.database.withTenant(ownerIdentity, async (tx) => {
      await messages.insertUser(tx, {
        chatId: branchChatId,
        messageId: olderLeafId,
        parentMessageId: branchRun.runId,
        text: 'Older branch leaf',
        effort: 'high',
      });
      await messages.insertUser(tx, {
        chatId: branchChatId,
        messageId: newerLeafId,
        parentMessageId: branchRun.runId,
        text: 'Newer branch leaf',
        effort: 'high',
      });
    });
    const resolve = (messageId: string) =>
      fetch(`${origin}/api/chats/${branchChatId}/search-match/${messageId}`, {
        method: 'POST',
        headers: owner,
      });
    const latestBranch = await resolve(branchRootId);
    expect(latestBranch.status).toBe(201);
    expect((await latestBranch.json()).leafId).toBe(newerLeafId);
    const selectViewed = await fetch(
      `${origin}/api/chats/${branchChatId}/viewed-leaf`,
      {
        method: 'PUT',
        headers: { ...owner, 'content-type': 'application/json' },
        body: JSON.stringify({ leafId: olderLeafId }),
      },
    );
    expect(selectViewed.status).toBe(200);
    const viewedBranch = await resolve(branchRootId);
    expect(viewedBranch.status).toBe(201);
    expect((await viewedBranch.json()).leafId).toBe(olderLeafId);
    expect((await resolve(randomUUID())).status).toBe(404);

    const searchBranchChat = randomUUID();
    const searchBranchRoot = randomUUID();
    const searchBranchCreate = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: searchBranchChat,
        userMessageId: searchBranchRoot,
        requestId: randomUUID(),
        text: 'Search branch root',
        effort: 'high',
      }),
    });
    expect(searchBranchCreate.status).toBe(201);
    const searchBranchRun = (await searchBranchCreate.json()) as {
      runId: string;
    };
    const matchingBranchMessage = randomUUID();
    const otherBranchMessage = randomUUID();
    await fixture.database.withTenant(ownerIdentity, async (tx) => {
      await messages.insertUser(tx, {
        chatId: searchBranchChat,
        messageId: matchingBranchMessage,
        parentMessageId: searchBranchRun.runId,
        text: 'rarely search branch target',
        effort: 'high',
      });
      await messages.insertUser(tx, {
        chatId: searchBranchChat,
        messageId: otherBranchMessage,
        parentMessageId: searchBranchRun.runId,
        text: 'unrelated selected branch',
        effort: 'high',
      });
    });
    const savedOtherLeaf = await fetch(
      `${origin}/api/chats/${searchBranchChat}/viewed-leaf`,
      {
        method: 'PUT',
        headers: { ...owner, 'content-type': 'application/json' },
        body: JSON.stringify({ leafId: otherBranchMessage }),
      },
    );
    expect(savedOtherLeaf.status).toBe(200);
    const branchSearch = await search(origin, owner, 'rarely');
    const branchHit = branchSearch.items.find(
      (item) => item.chatId === searchBranchChat,
    );
    expect(branchHit?.messageId).toBe(matchingBranchMessage);
    const openedSearchHit = await fetch(
      `${origin}/api/chats/${searchBranchChat}/search-match/${matchingBranchMessage}`,
      { method: 'POST', headers: owner },
    );
    expect(openedSearchHit.status).toBe(201);
    expect((await openedSearchHit.json()).leafId).toBe(matchingBranchMessage);

    const deletedBetweenSearchAndOpen = randomUUID();
    await fixture.chat.createFor(
      ownerIdentity,
      deletedBetweenSearchAndOpen,
      'Deleted after search',
    );
    const staleMessageId = randomUUID();
    await fixture.database.withTenant(ownerIdentity, (tx) =>
      messages.insertUser(tx, {
        chatId: deletedBetweenSearchAndOpen,
        messageId: staleMessageId,
        parentMessageId: null,
        text: 'stale-target canary',
        effort: 'high',
      }),
    );
    const stalePage = await search(origin, owner, 'stale-target');
    expect(
      stalePage.items.some(
        (item) => item.chatId === deletedBetweenSearchAndOpen,
      ),
    ).toBe(true);
    await fixture.chat.deleteFor(ownerIdentity, deletedBetweenSearchAndOpen);
    const staleResolve = await fetch(
      `${origin}/api/chats/${deletedBetweenSearchAndOpen}/search-match/${staleMessageId}`,
      { method: 'POST', headers: owner },
    );
    expect(staleResolve.status).toBe(404);

    const tieChatId = randomUUID();
    const tieRootId = randomUUID();
    const tieChatCreate = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: tieChatId,
        userMessageId: tieRootId,
        requestId: randomUUID(),
        text: 'Deterministic tie root',
        effort: 'high',
      }),
    });
    expect(tieChatCreate.status).toBe(201);
    const tieRun = (await tieChatCreate.json()) as { runId: string };
    const tieMessageA = '00000000-0000-4000-8000-000000000001';
    const tieMessageB = '00000000-0000-4000-8000-000000000002';
    await fixture.database.withTenant(ownerIdentity, async (tx) => {
      await messages.insertUser(tx, {
        chatId: tieChatId,
        messageId: tieMessageB,
        parentMessageId: tieRun.runId,
        text: 'deterministic tie marker',
        effort: 'high',
      });
      await messages.insertUser(tx, {
        chatId: tieChatId,
        messageId: tieMessageA,
        parentMessageId: tieRun.runId,
        text: 'deterministic tie marker',
        effort: 'high',
      });
    });
    const tiedResults = await search(origin, owner, 'deterministic tie');
    expect(
      tiedResults.items.find((item) => item.chatId === tieChatId)?.messageId,
    ).toBe(tieMessageA);

    const indexedCases = [
      { query: 'contracts', text: 'The contract governs this synthetic case' },
      { query: 'contrac', text: 'Partial contract vocabulary' },
      { query: '1320', text: 'Article 1320 protects the parties' },
      { query: 'café', text: 'A café in Jakarta is named here' },
      {
        query: 'script',
        text: "HostileMarkerLXDEADBEEFSTART plaintext. Script marker with hostile <script>alert('xss')</script>",
      },
    ];
    const caseIds = indexedCases.map(() => randomUUID());
    const caseMessageIds = indexedCases.map(() => randomUUID());
    await Promise.all(
      caseIds.map((chatId) =>
        fixture.chat.createFor(ownerIdentity, chatId, 'Search fixture'),
      ),
    );
    await fixture.database.withTenant(ownerIdentity, async (tx) => {
      for (const [index, item] of indexedCases.entries())
        await messages.insertUser(tx, {
          chatId: caseIds[index]!,
          messageId: caseMessageIds[index]!,
          parentMessageId: null,
          text: item.text,
          effort: 'high',
        });
    });
    const scriptVector = await fixture.inspect.query(
      `SELECT role,user_text,search_vector::text,to_tsvector('english',coalesce(user_text,''))::text AS computed_vector
       FROM app.chat_messages WHERE id=$1`,
      [caseMessageIds[4]],
    );
    expect(scriptVector.rows[0]?.user_text).toContain('<script>');
    expect(scriptVector.rows[0]?.computed_vector).toContain('script');
    expect(scriptVector.rows[0]?.search_vector).toContain('script');
    for (const [index, item] of indexedCases.entries()) {
      const page = await search(origin, owner, item.query);
      const hit = page.items.find(
        (candidate) => candidate.chatId === caseIds[index],
      );
      expect(hit, `expected search hit for ${item.query}`).toBeDefined();
      expect(hit?.excerpt.length).toBeLessThanOrEqual(500);
      if (item.query === 'script') {
        expect(hit?.excerpt).toContain('HostileMarkerLXDEADBEEFSTART');
        expect(hit?.excerpt).toContain('<script>');
        expect(hit?.matchStart).toBeGreaterThanOrEqual(0);
        expect(hit?.matchEnd).toBeGreaterThan(hit?.matchStart ?? 0);
        expect(hit?.excerpt.slice(hit.matchStart!, hit.matchEnd!)).toMatch(
          /script/i,
        );
      }
    }
    const articleLookalike = await search(origin, owner, '13200');
    expect(
      articleLookalike.items.some((item) => item.chatId === caseIds[2]),
    ).toBe(false);
    const punctuatedArticle = await search(origin, owner, '1320!');
    expect(
      punctuatedArticle.items.some((item) => item.chatId === caseIds[2]),
    ).toBe(true);
    const wrongQueryCursor = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'different private term',
        cursor: firstPage.pageInfo.nextCursor,
      }),
    });
    expect(wrongQueryCursor.status).toBe(409);
    expect(await wrongQueryCursor.text()).not.toContain(secretTerm);

    const foreignResponse = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...foreign, 'content-type': 'application/json' },
      body: JSON.stringify({ query: secretTerm }),
    });
    expect(foreignResponse.status).toBe(200);
    expect((await foreignResponse.json()).items).toEqual([]);
  } finally {
    await app.close();
    await fixture.close();
  }
});

async function identity(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const response = await fetch(`${origin}/api/identity`, { headers });
  const body = (await response.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  return { orgId: body.organization.id, userId: body.user.id };
}

async function search(
  origin: string,
  headers: Record<string, string>,
  query: string,
) {
  const response = await fetch(`${origin}/api/chats/search`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    items: Array<{
      chatId: string;
      messageId: string | null;
      excerpt: string;
      matchStart: number | null;
      matchEnd: number | null;
    }>;
  };
}
