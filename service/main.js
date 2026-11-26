import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || '';
const CALLBACK = (process.env.OPENCHAMBER_HOST_CALLBACK_URL || '').replace(/\/+$/, '');
const OPENCODE_URL = (process.env.OPENCHAMBER_OPENCODE_URL || '').replace(/\/+$/, '');
const DATA_DIR = process.env.OPENCHAMBER_SERVICE_DATA_DIR || '';

const POLL_MS = 5000;
const SESSIONS_POLL_MS = 15000;
const MARK_GAP_MS = 1100; // 60/min cap, with headroom
const MAX_SESSIONS = 200;
const MAX_TEXT = 200;
const LOG = '[session-warming-marks]';

let sessions = [];
let warmingPath = null;
let lastMarkKey = new Map(); // sessionId -> JSON of the mark currently set
let queue = [];
let flushing = false;
let startedAt = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...args) {
  console.log(LOG, ...args);
}

function warn(...args) {
  console.warn(LOG, ...args);
}

function findWarmingFile() {
  const candidates = [];
  let dir = DATA_DIR;
  for (let depth = 0; dir && depth < 6; depth += 1) {
    candidates.push(path.join(dir, 'session-warming.json'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const home = os.homedir();
  candidates.push(
    path.join(home, '.config', 'openchamber', 'session-warming.json'),
    path.join(home, 'Library', 'Application Support', 'openchamber', 'session-warming.json'),
    path.join(home, 'Library', 'Application Support', 'OpenChamber', 'session-warming.json'),
  );
  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, 'openchamber', 'session-warming.json'),
      path.join(process.env.APPDATA, 'OpenChamber', 'session-warming.json'),
    );
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function readWarming() {
  if (!warmingPath) warmingPath = findWarmingFile();
  if (!warmingPath) return { sessions: {} };
  try {
    const data = JSON.parse(fs.readFileSync(warmingPath, 'utf8'));
    return {
      enabled: Boolean(data.enabled),
      minutes: Number(data.minutes) || 30,
      sessions: data.sessions && typeof data.sessions === 'object' ? data.sessions : {},
    };
  } catch (error) {
    warn('cannot read warming state:', error.message);
    return { sessions: {} };
  }
}

function markFor(warmUntil, now) {
  if (warmUntil === undefined) {
    return { icon: 'fire', tone: 'neutral', text: '未预热' };
  }
  if (warmUntil === null) {
    return { icon: 'fire-fill', tone: 'neutral', text: '等待回复结束后开始预热' };
  }
  if (typeof warmUntil === 'number' && warmUntil > now) {
    const minutes = Math.max(1, Math.round((warmUntil - now) / 60000));
    return { icon: 'fire-fill', tone: 'warning', text: `预热中，剩余 ${minutes} 分钟` };
  }
  return { icon: 'fire-fill', tone: 'info', text: '已过期，下次回复后重新预热' };
}

async function callHost(method, input) {
  if (!CALLBACK || !TOKEN) {
    throw Object.assign(new Error('service was not started by OpenChamber'), { status: 0 });
  }
  const response = await fetch(`${CALLBACK}/service/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ method, input }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message || `OpenChamber answered HTTP ${response.status}`),
      { status: response.status },
    );
  }
  return body?.result;
}

async function refreshSessions() {
  if (!OPENCODE_URL) return;
  try {
    const response = await fetch(`${OPENCODE_URL}/api/session`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      warn(`session list answered HTTP ${response.status}`);
      return;
    }
    const body = await response.json();
    const list = Array.isArray(body) ? body : (body?.data || body?.sessions || []);
    sessions = list
      .filter((session) => session && typeof session.id === 'string' && !session.parentID && !session.parentId)
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      .slice(0, MAX_SESSIONS)
      .map((session) => ({ id: session.id, title: session.title || '' }));
  } catch (error) {
    warn('cannot list sessions:', error.message);
  }
}

function enqueue(sessionId, mark) {
  const existing = queue.findIndex((item) => item.sessionId === sessionId);
  if (existing >= 0) queue.splice(existing, 1);
  queue.push({ sessionId, mark });
}

function refreshMarks() {
  const warming = readWarming();
  const now = Date.now();
  const known = new Set();
  const list = sessions.length > 0
    ? sessions
    : Object.keys(warming.sessions).map((id) => ({ id, title: '' }));
  for (const session of list) {
    known.add(session.id);
    const entry = warming.sessions[session.id];
    const warmUntil = entry && Object.prototype.hasOwnProperty.call(entry, 'warmUntil')
      ? entry.warmUntil
      : undefined;
    const mark = markFor(warmUntil, now);
    const text = mark.text.slice(0, MAX_TEXT);
    const normalized = { ...mark, text };
    const key = JSON.stringify(normalized);
    if (lastMarkKey.get(session.id) !== key) enqueue(session.id, normalized);
  }
  for (const sessionId of Array.from(lastMarkKey.keys())) {
    if (!known.has(sessionId)) enqueue(sessionId, null);
  }
}

async function flushMarks() {
  if (flushing) return;
  flushing = true;
  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await callHost('marks.set', { target: { sessionId: item.sessionId }, mark: item.mark });
      if (item.mark) lastMarkKey.set(item.sessionId, JSON.stringify(item.mark));
      else lastMarkKey.delete(item.sessionId);
    } catch (error) {
      warn(`cannot set mark for ${item.sessionId}:`, error.message);
      if (error.status === 429) {
        queue.unshift(item);
        await sleep(5000);
      }
    }
    await sleep(MARK_GAP_MS);
  }
  flushing = false;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: sessions.length, queued: queue.length }));
    return;
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      warmingFile: warmingPath,
      sessions: sessions,
      marks: Object.fromEntries(lastMarkKey),
      queued: queue.length,
      uptimeMs: Date.now() - startedAt,
    }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

async function main() {
  if (!PORT || !TOKEN || !CALLBACK) {
    warn('missing service environment; this process must be started by OpenChamber');
    process.exit(1);
  }
  server.listen(PORT, '127.0.0.1', () => {
    log(`listening on 127.0.0.1:${PORT}`);
  });
  warmingPath = findWarmingFile();
  log('warming state:', warmingPath || 'not found yet');
  await refreshSessions();
  refreshMarks();
  setInterval(refreshMarks, POLL_MS);
  setInterval(refreshSessions, SESSIONS_POLL_MS);
  setInterval(flushMarks, 1000);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main().catch((error) => {
  warn('fatal:', error.message);
  process.exit(1);
});
