'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/components/shell/workspace-provider';
import { PageHeader } from '@/components/shell/page-header';
import { LoadingState } from '@/components/states/page-states';
import { ChatHistory } from '@/components/chat/chat-history';
import { ChatSearch } from '@/components/chat/chat-search';
import { createChatClient } from '@/lib/chat-client';
import { rememberChatSearchHighlight } from '@/lib/chat-search-highlight';
import { navigateToSearchMatch } from '@/lib/chat-search-navigation';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { SquarePen } from 'lucide-react';

export default function ChatsPage() {
  const { identity } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const [searching, setSearching] = useState(false);
  const mounted = useRef(true);
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
    <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-4">
      <PageHeader
        title="Chats"
        showDivider={false}
        actions={
          <Button render={<Link href="/workspace" />}>
            <SquarePen aria-hidden="true" data-icon="inline-start" />
            New chat
          </Button>
        }
      />
      <ChatSearch
        key={scopeKey}
        client={client}
        scope={scope}
        scopeKey={scopeKey}
        onActiveSearchChange={setSearching}
        onOpenMatch={openSearchMatch}
      />
      {!searching ? <ChatHistory client={client} scope={scope} /> : null}
    </div>
  );
}
