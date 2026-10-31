import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
export class FaultProxy {
  readonly #sockets = new Set<Socket>();
  #enabled = true;
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
    socket.pipe(upstream).pipe(socket);
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
  }
  async close(): Promise<void> {
    this.disconnect();
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
