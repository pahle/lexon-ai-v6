import { createServer } from 'node:http';
createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('lexon-egress-probe');
}).listen(7777, '0.0.0.0');
