export interface RevalidationKey {
  userId: string;
  sessionId: string;
  orgId: string;
}

interface Entry {
  expiresAt: number;
  pending: Promise<void> | undefined;
}

/**
 * Single-flight session revalidation: concurrent callers for one
 * user/session/organization share one load. A success is reused for `ttlMs`;
 * a rejection is never cached.
 */
export class RevalidationCache {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(opts: { ttlMs: number; now?: () => number }) {
    this.#ttlMs = opts.ttlMs;
    this.#now = opts.now ?? Date.now;
  }

  get(key: RevalidationKey, load: () => Promise<void>): Promise<void> {
    const id = `${key.userId}|${key.sessionId}|${key.orgId}`;
    const existing = this.#entries.get(id);
    if (existing?.pending) return existing.pending;
    if (existing && existing.expiresAt > this.#now()) return Promise.resolve();
    const entry: Entry = { expiresAt: 0, pending: undefined };
    const pending = load().then(
      () => {
        entry.expiresAt = this.#now() + this.#ttlMs;
        entry.pending = undefined;
        this.#sweep();
      },
      (error: unknown) => {
        if (this.#entries.get(id) === entry) this.#entries.delete(id);
        throw error;
      },
    );
    entry.pending = pending;
    this.#entries.set(id, entry);
    return pending;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [id, entry] of this.#entries)
      if (!entry.pending && entry.expiresAt <= now) this.#entries.delete(id);
  }
}
