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

function parseJsonString(rawValue, fallbackValue) {
  if (typeof rawValue !== 'string') return fallbackValue;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function formatUtcDateTimeForIcs(dateValue) {
  return dateValue.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatLocalDateTimeForIcs(dateValue, timeValue) {
  const normalizedDate = String(dateValue || '').slice(0, 10);
  const normalizedTime = String(timeValue || '').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !/^\d{2}:\d{2}$/.test(normalizedTime)) {
    return '';
  }
  return `${normalizedDate.replace(/-/g, '')}T${normalizedTime.replace(':', '')}00`;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildAgentCalendarFeed(store, token) {
  const parsedUsers = parseJsonString(store['agent-scheduler-users-v1'], []);
  const parsedState = parseJsonString(store['agent-scheduler-state-v4'], {});
  if (!Array.isArray(parsedUsers)) {
    return { status: 404, ics: '' };
  }

  const agentUser = parsedUsers.find((user) => user?.role === 'agent' && String(user?.calendarFeedToken || '').trim() === token);
  if (!agentUser) {
    return { status: 404, ics: '' };
  }

  const shifts = Array.isArray(parsedState?.shifts) ? parsedState.shifts : [];
  const agentShifts = shifts
    .filter((shift) => Number(shift?.agentId) === Number(agentUser.agentId))
    .filter((shift) => /^\d{4}-\d{2}-\d{2}$/.test(String(shift?.date || '')))
    .sort((left, right) => `${left.date || ''}${left.start || ''}`.localeCompare(`${right.date || ''}${right.start || ''}`));

  const nowStamp = formatUtcDateTimeForIcs(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Audience Services Scheduling//Agent Schedule//EN',
    `X-WR-CALNAME:${escapeIcsText(`${agentUser.name || agentUser.username || 'Agent'} - Work Schedule`)}`,
    'X-WR-TIMEZONE:UTC'
  ];

  agentShifts.forEach((shift, index) => {
    const dtStart = formatLocalDateTimeForIcs(shift.date, shift.start);
    const dtEnd = formatLocalDateTimeForIcs(shift.date, shift.end);
    if (!dtStart || !dtEnd) {
      return;
    }
    const uid = `${shift.id || index}-${agentUser.id || agentUser.agentId}@audience-services-scheduling`;
    const summary = `Work Shift - ${shift.role || 'Scheduled Shift'}`;
    const statusText = shift.status ? `Status: ${shift.status}` : 'Status: scheduled';
    const description = [
      shift.day ? `Day: ${shift.day}` : '',
      statusText,
      shift.location ? `Location: ${shift.location}` : ''
    ].filter(Boolean).join('\\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(uid)}`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (description) {
      lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    }
    if (shift.location) {
      lines.push(`LOCATION:${escapeIcsText(shift.location)}`);
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return { status: 200, ics: `${lines.join('\r\n')}\r\n` };
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

app.get('/api/calendar-feed/:token.ics', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) {
    res.status(400).send('Missing token');
    return;
  }

  const store = readStore();
  const payload = buildAgentCalendarFeed(store, token);
  if (payload.status !== 200) {
    res.status(404).send('Calendar feed not found');
    return;
  }

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(payload.ics);
});

app.listen(port, () => {
  console.log(`Scheduler backend running on http://localhost:${port}`);
});
