'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/components/shell/workspace-provider';
import { consumeRouteHeadingFocus } from '@/components/shell/navigation-focus';
import { LoadingState } from '@/components/states/page-states';
import { ChatHistory } from '@/components/chat/chat-history';
import { ChatSearch } from '@/components/chat/chat-search';
import { DataTabs } from '@/components/data-views/data-list-page';
import { createChatClient } from '@/lib/chat-client';
import { rememberChatSearchHighlight } from '@/lib/chat-search-highlight';
import { navigateToSearchMatch } from '@/lib/chat-search-navigation';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default function ChatsPage() {
  const { identity } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'own' | 'shared'>('own');
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (consumeRouteHeadingFocus()) {
      const timer = window.setTimeout(() => heading.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const timer = window.setTimeout(() => heading.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!identity) return <LoadingState message="Verifying your workspace…" />;
  const scope = { orgId: identity.organization.id, userId: identity.user.id };
  const scopeKey = `${scope.orgId}:${scope.userId}`;

  async function openSearchMatch(chatId: string, messageId: string | null) {
    await navigateToSearchMatch({
      chatId,
      messageId,
      resolve: async (id, selectedMessageId) =>
        client.resolveSearchMatch(id, selectedMessageId),
      remember: rememberChatSearchHighlight,
      isCurrent: () =>
        mounted.current && isTenantScopeCurrent(queryClient, scope),
      navigate: (id) => router.push(`/chats/${id}`),
    });
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3.5 px-6 py-7 max-md:px-4 max-md:py-5">
      <header className="flex items-end justify-between gap-4">
        <h1
          ref={heading}
          tabIndex={-1}
          className="min-w-0 font-serif text-[32px] leading-[normal] font-normal tracking-[-0.005em] outline-none"
        >
          Chats
        </h1>
        <Button
          nativeButton={false}
          className="bg-clip-border"
          render={<Link href="/workspace" />}
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          New chat
        </Button>
      </header>
      <ChatSearch
        key={scopeKey}
        client={client}
        scope={scope}
        scopeKey={scopeKey}
        onActiveSearchChange={setSearching}
        onOpenMatch={openSearchMatch}
      />
      {!searching ? (
        <>
          <DataTabs
            tabs={[
              { value: 'own', label: 'All' },
              { value: 'shared', label: 'Shared with me' },
            ]}
            value={tab}
            onChange={(value) => setTab(value as 'own' | 'shared')}
          />
          <ChatHistory client={client} scope={scope} listScope={tab} />
        </>
      ) : null}
    </div>
  );
}
