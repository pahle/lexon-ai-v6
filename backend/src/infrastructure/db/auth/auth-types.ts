import type { BetterAuthPlugin } from 'better-auth';
import type { createAuthEngine } from './auth-factory.js';

export interface AuthEngineOptions {
  authUrl: string;
  origin: string;
  secret: string;
  policy?: {
    cookieSeconds?: number;
    cookieRefreshSeconds?: number;
    reauthSeconds?: number;
    invitationSeconds?: number;
    verificationSeconds?: number;
    resetSeconds?: number;
  };
  pluginConfiguration?: {
    allowUserToCreateOrganization?: boolean;
    issuer?: string;
  };
  plugins?: BetterAuthPlugin[];
  mail: {
    sendVerification: (message: {
      email: string;
      url: string;
    }) => Promise<void>;
    sendPasswordReset: (message: {
      email: string;
      url: string;
    }) => Promise<void>;
  };
}
export type LexonServerApi = ReturnType<typeof createAuthEngine>['api'];
type Command = keyof LexonServerApi;
type CommandInput<K extends Command> = Parameters<LexonServerApi[K]>[0];
type CommandResult<K extends Command> = Awaited<ReturnType<LexonServerApi[K]>>;
declare const commandSessionBrand: unique symbol;
export interface AuthCommandSession {
  readonly [commandSessionBrand]: true;
  call<K extends Command>(
    name: K,
    input: CommandInput<K> & { asResponse: true },
  ): Promise<Response>;
  call<K extends Command>(
    name: K,
    input: CommandInput<K> & { returnHeaders: true; returnStatus: true },
  ): Promise<{ headers: Headers; status: number; response: CommandResult<K> }>;
  call<K extends Command>(
    name: K,
    input: CommandInput<K> & { returnHeaders: true },
  ): Promise<{ headers: Headers; response: CommandResult<K> }>;
  call<K extends Command>(
    name: K,
    input: CommandInput<K> & { returnStatus: true },
  ): Promise<{ status: number; response: CommandResult<K> }>;
  call<K extends Command>(
    name: K,
    input: Parameters<LexonServerApi[K]>[0],
  ): Promise<Awaited<ReturnType<LexonServerApi[K]>>>;
}
export interface AuthIntegration {
  transaction<T>(work: (session: AuthCommandSession) => Promise<T>): Promise<T>;
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}
