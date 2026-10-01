const path = require('path');
const { spawn } = require('child_process');
const repo = 'D:/mini project/socketspace';
const { io } = require(path.join(repo, 'node_modules/socket.io-client'));
const server = spawn(process.execPath, ['server.js'], { cwd: repo });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await wait(1500);
  const c = io('http://localhost:8001', { transports: ['websocket'], extraHeaders: { origin: 'https://evil.example' } });
  const ok = await Promise.race([
    new Promise((r) => c.on('connect', () => r('CONNECTED'))),
    new Promise((r) => c.on('connect_error', (e) => r('REJECTED: ' + e.message))),
    wait(3000).then(() => 'TIMEOUT'),
  ]);
  console.log('WebSocket connection with Origin https://evil.example ->', ok);
  c.close(); server.kill(); process.exit(0);
})();
