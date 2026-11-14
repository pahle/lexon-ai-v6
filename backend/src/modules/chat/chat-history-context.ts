import { Injectable } from '@nestjs/common';
import {
  TenantDatabase,
  ChatMessageRepository,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { CHAT_HISTORY_CONTEXT_ID, CHAT_PROFILES } from './chat-profiles.js';
import type { ContextPiece, ContextProvider } from './run-contracts.js';
import { assembleModelInput } from './model-input.js';
import { renderContexts } from './untrusted-context.js';

@Injectable()
export class ChatHistoryContextProvider implements ContextProvider {
  readonly id = CHAT_HISTORY_CONTEXT_ID;
  readonly version = 1;
  private readonly messages = new ChatMessageRepository();

  constructor(private readonly database: TenantDatabase) {}

  async collect(args: {
    readonly actor: RunActor;
    readonly runId: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly budget: number;
  }): Promise<ContextPiece[]> {
    if (
      args.budget !== CHAT_PROFILES.chat.contextBudgets[this.id] ||
      typeof args.input.prompt !== 'string' ||
      !args.input.prompt.trim()
    )
      throw new Error('AI context request denied');
    const history = await this.database.withTenant(
      { orgId: args.actor.orgId, userId: args.actor.userId },
      (tx) => this.messages.historyForRun(tx, args.runId),
    );
    const eligible: ContextPiece[] = history.flatMap((message) => {
      if (!message.text?.trim()) return [];
      if (message.role === 'user')
        return [{ label: 'chat history user', text: message.text }];
      if (
        message.status !== 'completed' &&
        message.status !== 'failed' &&
        message.status !== 'cancelled'
      )
        return [];
      return [
        {
          label: `chat history assistant ${message.status}`,
          text: message.text,
        },
      ];
    });

    while (eligible.length) {
      const serializedBytes = Buffer.byteLength(
        JSON.stringify(eligible),
        'utf8',
      );
      if (
        serializedBytes <= args.budget &&
        this.fitsInput(eligible, args.input.prompt)
      )
        return eligible;
      eligible.shift();
    }
    return [];
  }

  private fitsInput(history: readonly ContextPiece[], prompt: string): boolean {
    const contexts = renderContexts(history);
    try {
      assembleModelInput(
        CHAT_PROFILES.chat,
        [{ role: 'system', content: contexts }],
        prompt,
        CHAT_PROFILES.chat.reasoning.default,
      );
      return true;
    } catch {
      return false;
    }
  }
}
