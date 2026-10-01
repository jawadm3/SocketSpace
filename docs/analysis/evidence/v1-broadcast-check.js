// Evidence script: does v1's server deliver a message to ONE partner (1-to-1) or to EVERYONE?
// Starts v1 server.js as a child process, connects 3 clients, client A sends one message.
const path = require('path');
const { spawn } = require('child_process');
const repo = 'D:/mini project/socketspace';
const { io } = require(path.join(repo, 'node_modules/socket.io-client'));

const server = spawn(process.execPath, ['server.js'], { cwd: repo });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await wait(1500);
  const opts = { transports: ['websocket'], extraHeaders: { origin: 'http://localhost:3000' } };
  const names = ['A', 'B', 'C'];
  const clients = names.map(() => io('http://localhost:8001', opts));
  const received = { A: [], B: [], C: [] };
  clients.forEach((c, i) => c.on('message', (m) => received[names[i]].push(m)));
  await Promise.all(clients.map((c) => new Promise((r) => (c.connected ? r() : c.on('connect', r)))));
  clients[0].emit('message', { message: 'hello from A', timestamp: '12:00' });
  // Also try an oversized / arbitrary payload to show there is no validation.
  clients[0].emit('message', { message: 'x'.repeat(100000), timestamp: '<script>', injected: { any: 'field' } });
  await wait(800);
  console.log('Connected clients: 3 (A, B, C). A sent 2 messages.');
  for (const n of names) {
    console.log(`Client ${n} received ${received[n].length} message(s):`,
      received[n].map((m) => ({ keys: Object.keys(m), id: m.id, messageLength: String(m.message).length, timestamp: m.timestamp })));
  }
  clients.forEach((c) => c.close());
  await wait(300);
  server.kill();
  console.log('--- server log (first 600 chars) ---');
  console.log(serverLog.slice(0, 600));
  process.exit(0);
})();
