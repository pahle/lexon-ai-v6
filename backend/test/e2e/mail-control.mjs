import { connect } from 'node:net';
const [recipient, kind] = process.argv.slice(2);
if (
  !recipient ||
  recipient.length > 254 ||
  ![
    'verification',
    'reset',
    'invitation',
    'admin-setup',
    'email-change',
    'security',
  ].includes(kind)
) {
  process.stderr.write('Invalid mail control request\n');
  process.exitCode = 2;
} else {
  const socket = connect('/run/lexon/health/mail-control.sock');
  let buffer = '';
  socket.setEncoding('utf8');
  socket.setTimeout(3000, () =>
    socket.destroy(new Error('Mail control timeout')),
  );
  socket.once('connect', () =>
    socket.write(JSON.stringify({ recipient, kind }) + '\n'),
  );
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 8192)
      socket.destroy(new Error('Mail control response too large'));
  });
  socket.once('end', () => process.stdout.write(buffer));
  socket.once('error', () => {
    process.stderr.write('Mail control unavailable\n');
    process.exitCode = 1;
  });
}
