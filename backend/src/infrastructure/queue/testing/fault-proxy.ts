import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
export class FaultProxy {
  readonly #sockets = new Set<Socket>();
  #enabled = true;
  #hanging = false;
  #rejectWrites = false;
  readonly #server = createServer((socket) => {
    if (!this.#enabled) {
      socket.destroy();
      return;
    }
    const target = new URL(this.#target);
    const upstream = connect({
      host: target.hostname,
      port: Number(target.port || 6379),
    });
    for (const peer of [socket, upstream]) {
      this.#sockets.add(peer);
      peer.on('error', () => peer.destroy());
      peer.on('close', () => {
        this.#sockets.delete(peer);
        socket.destroy();
        upstream.destroy();
      });
    }
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      if (!this.#rejectWrites) {
        upstream.write(chunk);
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length) {
        const frame = redisFrame(buffered);
        if (!frame) break;
        const command = buffered.subarray(0, frame.bytes);
        buffered = buffered.subarray(frame.bytes);
        if (['eval', 'evalsha'].includes(frame.name.toLowerCase()))
          socket.write(
            '-OOM command not allowed when used memory > maxmemory\r\n',
          );
        else upstream.write(command);
      }
    });
    upstream.pipe(socket);
    if (this.#hanging) {
      socket.pause();
      upstream.pause();
    }
  });
  private constructor(readonly url: string) {}
  #target = '';
  static async start(target: string): Promise<FaultProxy> {
    const proxy = new FaultProxy('');
    proxy.#target = target;
    proxy.#server.listen(0, '127.0.0.1');
    await once(proxy.#server, 'listening');
    const address = proxy.#server.address();
    if (!address || typeof address === 'string')
      throw new Error('Proxy unavailable');
    const url = new URL(target);
    url.hostname = '127.0.0.1';
    url.port = String(address.port);
    Object.defineProperty(proxy, 'url', { value: url.href });
    return proxy;
  }
  disconnect(): void {
    this.#enabled = false;
    for (const socket of this.#sockets) socket.destroy();
  }
  restore(): void {
    this.#enabled = true;
    this.#hanging = false;
    this.#rejectWrites = false;
    for (const socket of this.#sockets) socket.resume();
  }
  hang(): void {
    this.#hanging = true;
    for (const socket of this.#sockets) socket.pause();
  }
  rejectWrites(): void {
    this.#rejectWrites = true;
  }
  async close(): Promise<void> {
    this.disconnect();
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

// RESP2 command framing for this private fault injector. Incomplete TCP chunks
// are retained; each pipelined command gets exactly one matching response.
function redisFrame(buffer: Buffer): { bytes: number; name: string } | null {
  const first = buffer.indexOf('\r\n');
  if (first < 0) return null;
  const count = Number(buffer.subarray(1, first).toString());
  if (buffer[0] !== 42 || !Number.isSafeInteger(count) || count < 1)
    throw new Error('Invalid test RESP frame');
  let offset = first + 2;
  let name = '';
  for (let i = 0; i < count; i++) {
    const end = buffer.indexOf('\r\n', offset);
    if (end < 0) return null;
    const length = Number(buffer.subarray(offset + 1, end).toString());
    if (buffer[offset] !== 36 || !Number.isSafeInteger(length) || length < 0)
      throw new Error('Invalid test RESP frame');
    const next = end + 2 + length + 2;
    if (buffer.length < next) return null;
    if (i === 0) name = buffer.subarray(end + 2, end + 2 + length).toString();
    offset = next;
  }
  return { bytes: offset, name };
}
