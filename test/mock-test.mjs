import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const calls = [];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const now = Date.now();
const mockHost = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : {};
    calls.push({ path: req.url, body: parsed });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: { saved: true } }));
  });
});

const mockOpencode = http.createServer((req, res) => {
  if (req.url === '/api/session') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 'ses_warming', title: 'Warming session', parentID: null, time: { updated: 4 } },
      { id: 'ses_waiting', title: 'Waiting session', parentID: null, time: { updated: 3 } },
      { id: 'ses_expired', title: 'Expired session', parentID: null, time: { updated: 2 } },
      { id: 'ses_unwarmed', title: 'Unwarmed session', parentID: null, time: { updated: 1 } },
    ]));
    return;
  }
  res.writeHead(404);
  res.end();
});

const hostPort = await listen(mockHost);
const opencodePort = await listen(mockOpencode);
const servicePort = await freePort();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-warming-marks-'));
const dataDir = path.join(tempRoot, 'extension-data');
await fs.mkdir(dataDir, { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'session-warming.json'),
  JSON.stringify({
    enabled: true,
    minutes: 30,
    sessions: {
      ses_warming: { directory: '/tmp/project', warmUntil: now + 10 * 60 * 1000 },
      ses_waiting: { directory: '/tmp/project', warmUntil: null },
      ses_expired: { directory: '/tmp/project', warmUntil: now - 10 * 60 * 1000 },
    },
  }, null, 2),
);

const child = spawn(process.execPath, [path.join(ROOT, 'service', 'main.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    OPENCHAMBER_SERVICE_PORT: String(servicePort),
    OPENCHAMBER_SERVICE_TOKEN: 'test-token',
    OPENCHAMBER_HOST_CALLBACK_URL: `http://127.0.0.1:${hostPort}`,
    OPENCHAMBER_OPENCODE_URL: `http://127.0.0.1:${opencodePort}`,
    OPENCHAMBER_SERVICE_DATA_DIR: dataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

try {
  const health = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${servicePort}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, 5000);
  if (!health) throw new Error('service did not become healthy');

  const gotAll = await waitFor(
    () => new Set(calls
      .filter((call) => call.path === '/service/call' && call.body.method === 'marks.set')
      .map((call) => call.body.input?.target?.sessionId)).size >= 4,
    12000,
  );
  if (!gotAll) throw new Error('did not receive marks for all four sessions');

  const marks = new Map();
  for (const call of calls) {
    if (call.path !== '/service/call' || call.body.method !== 'marks.set') continue;
    const sessionId = call.body.input?.target?.sessionId;
    marks.set(sessionId, call.body.input?.mark);
  }

  const expected = {
    ses_warming: { icon: 'fire-fill', tone: 'warning', contains: '预热中' },
    ses_waiting: { icon: 'fire-fill', tone: 'neutral', contains: '等待' },
    ses_expired: { icon: 'fire-fill', tone: 'info', contains: '已过期' },
    ses_unwarmed: { icon: 'fire', tone: 'neutral', contains: '未预热' },
  };

  let failed = false;
  for (const [sessionId, want] of Object.entries(expected)) {
    const mark = marks.get(sessionId);
    if (!mark) {
      console.error(`FAIL ${sessionId}: no mark`);
      failed = true;
      continue;
    }
    const ok = mark.icon === want.icon
      && mark.tone === want.tone
      && typeof mark.text === 'string'
      && mark.text.includes(want.contains);
    if (!ok) {
      console.error(`FAIL ${sessionId}: got ${JSON.stringify(mark)}`);
      failed = true;
    } else {
      console.log(`PASS ${sessionId}: ${mark.icon} / ${mark.tone} / ${mark.text}`);
    }
  }

  if (failed) {
    console.error('\nservice output:\n' + output);
    process.exitCode = 1;
  } else {
    console.log('\nAll mark checks passed.');
  }
} finally {
  child.kill('SIGTERM');
  mockHost.close();
  mockOpencode.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
