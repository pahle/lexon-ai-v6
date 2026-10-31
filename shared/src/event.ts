export interface EventEnvelope<T> {
  readonly version: 1;
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly payload: T;
}
