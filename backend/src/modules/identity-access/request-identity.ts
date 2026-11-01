import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { Observable, type Subscription } from 'rxjs';
import type { IdentitySummary, OrgRole } from '@lexon/contracts';
import {
  withVerifiedIdentity,
  currentVerifiedIdentity,
} from './identity.types.js';
import { IdentityError } from './identity-error.js';

export interface TenantRequestContext {
  readonly orgId: string;
  readonly userId: string;
  readonly role: OrgRole;
}
export interface ResolvedRequestIdentity {
  identity: Parameters<typeof withVerifiedIdentity>[0];
  tenant: TenantRequestContext;
  summary: IdentitySummary;
}
const metadata = new AsyncLocalStorage<ResolvedRequestIdentity>();
export function currentTenantContext(): TenantRequestContext {
  currentVerifiedIdentity();
  const state = metadata.getStore();
  if (!state) throw new IdentityError('AUTH_REQUIRED', 401);
  return state.tenant;
}
@Injectable()
export class RequestIdentity {
  readonly #prepared = new WeakMap<
    object,
    { resolved: ResolvedRequestIdentity; headers: Headers }
  >();
  prepare(
    request: object,
    resolved: ResolvedRequestIdentity,
    headers: Headers,
  ): void {
    if (this.#prepared.has(request))
      throw new IdentityError('AUTH_REQUIRED', 401);
    this.#prepared.set(request, {
      resolved: {
        identity: Object.freeze({ ...resolved.identity }),
        tenant: Object.freeze({ ...resolved.tenant }),
        summary: Object.freeze({
          ...resolved.summary,
          user: Object.freeze({ ...resolved.summary.user }),
          organization: Object.freeze({ ...resolved.summary.organization }),
        }),
      },
      headers: new Headers(headers),
    });
  }
  has(request: object): boolean {
    return this.#prepared.has(request);
  }
  async run<T>(request: object, work: () => Promise<T>): Promise<T> {
    const state = this.#prepared.get(request);
    if (!state) throw new IdentityError('AUTH_REQUIRED', 401);
    try {
      return await withVerifiedIdentity(
        state.resolved.identity,
        () => metadata.run(state.resolved, work),
        state.headers,
      );
    } finally {
      this.#prepared.delete(request);
    }
  }
  summary(): IdentitySummary {
    currentVerifiedIdentity();
    const state = metadata.getStore();
    if (!state) throw new IdentityError('AUTH_REQUIRED', 401);
    return state.summary;
  }
}
@Injectable()
export class RequestIdentityInterceptor implements NestInterceptor {
  constructor(private readonly identities: RequestIdentity) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<object>();
    if (!this.identities.has(request)) return next.handle();
    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;
      let finish: (() => void) | undefined;
      void this.identities
        .run(
          request,
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
              subscription = next.handle().subscribe({
                next: (value) => subscriber.next(value),
                error: (error) => {
                  subscriber.error(error);
                  resolve();
                },
                complete: () => {
                  subscriber.complete();
                  resolve();
                },
              });
            }),
        )
        .catch((error) => subscriber.error(error));
      return () => {
        subscription?.unsubscribe();
        finish?.();
      };
    });
  }
}
