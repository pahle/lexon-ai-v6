'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatApi, ChatSearchPage } from '@lexon/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Search } from 'lucide-react';
import {
  chatSearchQueriesPrefix,
  chatSearchQueryKey,
  type ChatQueryScope,
} from '@/lib/chat-queries';

export function ChatSearch(props: {
  client: ChatApi;
  scope: ChatQueryScope;
  scopeKey: string;
  onOpenMatch?: (
    chatId: string,
    messageId: string | null,
  ) => void | Promise<void>;
  onActiveSearchChange?: (active: boolean) => void;
}) {
  return <ChatSearchSession key={props.scopeKey} {...props} />;
}

function ChatSearchSession({
  client,
  scope,
  onOpenMatch,
  onActiveSearchChange,
}: {
  client: ChatApi;
  scope: ChatQueryScope;
  onOpenMatch?: (
    chatId: string,
    messageId: string | null,
  ) => void | Promise<void>;
  onActiveSearchChange?: (active: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const resultQueryKey = chatSearchQueryKey(scope, submittedQuery);
  const resultQuery = useQuery({
    queryKey: resultQueryKey,
    queryFn: () => client.search({ query: submittedQuery }),
    enabled: false,
    staleTime: Infinity,
  });
  const results = resultQuery.data ?? null;

  useEffect(() => {
    onActiveSearchChange?.(false);
    return () => {
      requestVersion.current += 1;
      controller.current?.abort();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    requestVersion.current += 1;
    const version = requestVersion.current;
    controller.current?.abort();
    controller.current = null;
    setFailed(false);
    setLoadingMore(false);
    if (!value) {
      queryClient.removeQueries({ queryKey: chatSearchQueriesPrefix(scope) });
      setSubmittedQuery('');
      setLoading(false);
      onActiveSearchChange?.(false);
      return;
    }
    const key = chatSearchQueryKey(scope, value);
    queryClient.removeQueries({ queryKey: key, exact: true });
    const nextController = new AbortController();
    controller.current = nextController;
    setSubmittedQuery(value);
    onActiveSearchChange?.(true);
    setLoading(true);
    setLoadingMore(false);
    try {
      const result = await client.search(
        { query: value },
        nextController.signal,
      );
      if (version !== requestVersion.current) return;
      queryClient.setQueryData(key, result);
    } catch {
      if (version !== requestVersion.current) return;
      setFailed(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  async function loadMore() {
    const cursor = results?.pageInfo.nextCursor;
    if (!submittedQuery || !cursor || loadingMore) return;
    const version = requestVersion.current;
    const nextController = new AbortController();
    controller.current?.abort();
    controller.current = nextController;
    setFailed(false);
    setLoadingMore(true);
    try {
      const next = await client.search(
        { query: submittedQuery, cursor },
        nextController.signal,
      );
      if (version !== requestVersion.current) return;
      const key = chatSearchQueryKey(scope, submittedQuery);
      queryClient.setQueryData<ChatSearchPage>(key, (current) => {
        if (!current) return undefined;
        const seen = new Set(
          current.items.map(
            (item) => `${item.chatId}:${item.messageId ?? 'title'}`,
          ),
        );
        const more = next.items.filter((item) => {
          const key = `${item.chatId}:${item.messageId ?? 'title'}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return {
          items: [...current.items, ...more],
          pageInfo: next.pageInfo,
        };
      });
    } catch {
      if (version !== requestVersion.current) return;
      setFailed(true);
    } finally {
      if (version === requestVersion.current) setLoadingMore(false);
    }
  }

  function clear() {
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    setQuery('');
    setSubmittedQuery('');
    onActiveSearchChange?.(false);
    queryClient.removeQueries({ queryKey: chatSearchQueriesPrefix(scope) });
    setFailed(false);
    setLoading(false);
    setLoadingMore(false);
  }

  return (
    <section className="flex flex-col gap-4">
      <form onSubmit={submit} role="search">
        <InputGroup className="h-9">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search chats"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search chats"
          />
        </InputGroup>
      </form>
      {submittedQuery ? (
        <div
          className="flex flex-col gap-3"
          aria-live="polite"
          aria-busy={loading || loadingMore}
        >
          {loading ? <p role="status">Searching chats</p> : null}
          {failed ? (
            <p role="alert">Search could not be completed. Try again.</p>
          ) : null}
          {!loading && !failed && results?.items.length ? (
            <p className="text-muted-foreground text-sm">
              {results.items.length}{' '}
              {results.items.length === 1 ? 'chat' : 'chats'}
            </p>
          ) : null}
          {!loading && !failed && results?.items.length === 0 ? (
            <Empty className="h-80 flex-none border-0">
              <EmptyHeader className="max-w-none">
                <EmptyMedia variant="icon">
                  <Search aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No chats match “{submittedQuery}”</EmptyTitle>
                <EmptyDescription className="max-w-none sm:whitespace-nowrap">
                  Search looks in chat titles and messages. Try other words.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={clear}>
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {!loading && results?.items.length ? (
            <ul className="flex flex-col gap-2">
              {results.items.map((item, index) => (
                <li key={`${item.chatId}:${item.messageId ?? 'title'}`}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-1 rounded-lg p-3 text-left hover:bg-muted ${index === 0 ? 'border border-border bg-muted/50' : ''}`}
                    onClick={() =>
                      void onOpenMatch?.(item.chatId, item.messageId)
                    }
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="font-medium">{item.title}</span>
                      <time className="text-muted-foreground shrink-0 text-xs">
                        {formatActivityDate(item.updatedAt)}
                      </time>
                    </span>
                    {item.excerpt ? (
                      <span className="text-muted-foreground line-clamp-2 text-sm">
                        {highlightExcerpt(
                          item.excerpt,
                          item.matchStart,
                          item.matchEnd,
                        )}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!loading && results?.pageInfo.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading results…' : 'Load more results'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatActivityDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (day.getTime() === today.getTime())
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function highlightExcerpt(
  text: string,
  start: number | null,
  end: number | null,
) {
  if (start === null || end === null || start >= end || start >= text.length)
    return text;
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(text.length, end);
  return (
    <>
      {text.slice(0, safeStart)}
      <mark className="rounded-sm bg-primary/20 text-foreground">
        {text.slice(safeStart, safeEnd)}
      </mark>
      {text.slice(safeEnd)}
    </>
  );
}
