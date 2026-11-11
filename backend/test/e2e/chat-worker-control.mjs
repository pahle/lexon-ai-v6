import { createConnection } from 'node:net';
const [op, runId, cursor] = process.argv.slice(2);
const socket = createConnection('/run/lexon/health/chat-proof.sock');
let response = '';
socket.setEncoding('utf8');
socket.setTimeout(2000, () => socket.destroy());
socket.on('connect', () =>
  socket.write(
    JSON.stringify({ op, runId, ...(cursor ? { cursor } : {}) }) + '\n',
  ),
);
socket.on('data', (chunk) => {
  response += chunk;
});
socket.on('end', () => process.stdout.write(response.trim()));
