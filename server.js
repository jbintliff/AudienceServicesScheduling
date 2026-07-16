import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFilePath = path.join(__dirname, 'backend', 'data.json');
const port = Number(process.env.PORT || 8787);

const allowedKeys = new Set([
  'agent-scheduler-state-v4',
  'agent-scheduler-users-v1',
  'agent-scheduler-availability-requests-v1',
  'agent-scheduler-availability-inbox-v1',
  'agent-scheduler-availability-ledger-v1',
  'agent-scheduler-password-reset-requests-v1',
  'agent-scheduler-email-outbox-v1',
  'agent-scheduler-email-delivery-settings-v1'
]);

function ensureDataFile() {
  const dataDir = path.dirname(dataFilePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, JSON.stringify({ store: {} }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.store && typeof parsed.store === 'object' ? parsed.store : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  ensureDataFile();
  const next = { store };
  fs.writeFileSync(dataFilePath, JSON.stringify(next, null, 2), 'utf8');
}

function filterAllowedStore(store) {
  const next = {};
  Object.entries(store || {}).forEach(([key, value]) => {
    if (!allowedKeys.has(key)) return;
    if (typeof value !== 'string') return;
    next[key] = value;
  });
  return next;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/snapshot', (_req, res) => {
  res.json({ store: readStore() });
});

app.put('/api/snapshot', (req, res) => {
  const incomingStore = filterAllowedStore(req.body?.store || {});
  writeStore(incomingStore);
  res.json({ ok: true, keys: Object.keys(incomingStore).length });
});

app.put('/api/store/:key', (req, res) => {
  const key = String(req.params.key || '');
  if (!allowedKeys.has(key)) {
    res.status(400).json({ ok: false, error: 'Unsupported key' });
    return;
  }

  const value = req.body?.value;
  if (typeof value !== 'string') {
    res.status(400).json({ ok: false, error: 'Value must be a JSON string' });
    return;
  }

  const store = readStore();
  store[key] = value;
  writeStore(store);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Scheduler backend running on http://localhost:${port}`);
});
