import { createConnection } from 'node:net';

const socketPath = '/run/lexon/health/chat-load-control.sock';
const input = process.argv[2];
if (!input || input.length > 16_000) {
  process.stderr.write('Invalid chat load control request.\n');
  process.exitCode = 1;
} else {
  const socket = createConnection(socketPath);
  let response = '';
  socket.setEncoding('utf8');
  socket.setTimeout(6000, () => socket.destroy());
  socket.on('connect', () => socket.write(input + '\n'));
  socket.on('data', (chunk) => {
    response += chunk;
    if (response.length > 16_384) socket.destroy();
  });
  socket.on('end', () => process.stdout.write(response.trim()));
  socket.on('error', () => {
    process.stderr.write('Chat load control is unavailable.\n');
    process.exitCode = 1;
  });
}
