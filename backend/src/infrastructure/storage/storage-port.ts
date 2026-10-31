export abstract class StoragePort {
  abstract put(key: string, body: Uint8Array): Promise<void>;
  abstract get(
    key: string,
    range?: { start: number; endInclusive: number },
  ): Promise<Uint8Array>;
  abstract delete(key: string): Promise<void>;
  abstract presignPut(key: string, expiresInSeconds: number): Promise<string>;
  abstract check(): Promise<'up' | 'down'>;
  abstract close(): Promise<void>;
}
