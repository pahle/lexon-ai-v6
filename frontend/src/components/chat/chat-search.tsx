'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatApi, ChatSearchPage } from '@lexon/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Search } from 'lucide-react';
import { formatActivityDate } from '@/lib/date-time';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount and unmount only; the callback is intentionally called once on mount
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
    <section className="flex flex-col gap-3.5">
      <form onSubmit={submit} role="search" className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
        />
        <Input
          aria-label="Search chats"
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search chats"
        />
      </form>
      {submittedQuery ? (
        <div
          className="flex flex-col gap-3.5"
          aria-live="polite"
          aria-busy={loading || loadingMore}
        >
          {loading ? <p role="status">Searching chats</p> : null}
          {failed ? (
            <p role="alert">Search could not be completed. Try again.</p>
          ) : null}
          {!loading && !failed && results?.items.length ? (
            <p className="text-muted-foreground text-[13px] leading-[normal]">
              {results.items.length}{' '}
              {results.items.length === 1 ? 'chat' : 'chats'}
            </p>
          ) : null}
          {!loading && !failed && results?.items.length === 0 ? (
            <Empty className="flex-none gap-2 border-0 px-0 py-16 text-wrap text-muted-foreground">
              <EmptyHeader className="max-w-none gap-2">
                <EmptyMedia
                  variant="icon"
                  className="mb-0 size-10 rounded-[10px] [&_svg:not([class*='size-'])]:size-5"
                >
                  <Search aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle className="text-base leading-[normal] font-semibold text-foreground">
                  No chats match “{submittedQuery}”
                </EmptyTitle>
                <EmptyDescription className="max-w-none text-sm leading-[normal]">
                  Search looks in chat titles and messages. Try other words.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="mt-2">
                <Button type="button" variant="outline" onClick={clear}>
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {!loading && results?.items.length ? (
            <ul className="flex flex-col gap-3.5">
              {results.items.map((item, index) => (
                <li key={`${item.chatId}:${item.messageId ?? 'title'}`}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-1 rounded-[10px] border p-3 text-left leading-[normal] hover:bg-muted ${index === 0 ? 'border-border bg-muted' : 'border-transparent'}`}
                    onClick={() =>
                      void onOpenMatch?.(item.chatId, item.messageId)
                    }
                  >
                    <span className="flex w-full justify-between gap-4 text-sm leading-[normal] font-medium">
                      <span>{item.title}</span>
                      <time className="text-muted-foreground shrink-0 text-xs font-normal whitespace-nowrap">
                        {formatActivityDate(item.updatedAt, {
                          todayAs: 'label',
                        })}
                      </time>
                    </span>
                    {item.excerpt ? (
                      <span className="text-muted-foreground text-[13px]/[1.5]">
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
              {loadingMore ? (
                <>
                  <Spinner aria-hidden="true" />
                  <span className="sr-only">Loading more</span>
                </>
              ) : (
                'Load more results'
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
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
      <mark className="rounded-[3px] bg-(--lexon-tint) px-0.5 text-inherit dark:bg-[#4A1E23]">
        {text.slice(safeStart, safeEnd)}
      </mark>
      {text.slice(safeEnd)}
    </>
  );
}
