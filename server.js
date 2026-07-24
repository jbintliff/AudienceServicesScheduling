import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFilePath = path.join(__dirname, 'backend', 'data.json');
const policyFilesDirPath = path.join(__dirname, 'backend', 'policy-files');
const port = Number(process.env.PORT || 8787);

const allowedKeys = new Set([
  'agent-scheduler-state-v4',
  'agent-scheduler-users-v1',
  'agent-scheduler-availability-requests-v1',
  'agent-scheduler-availability-inbox-v1',
  'agent-scheduler-availability-ledger-v1',
  'agent-scheduler-password-reset-requests-v1',
  'agent-scheduler-app-login-url-v1',
  'agent-scheduler-profile-photos-v1',
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

function ensurePolicyFilesDir() {
  if (!fs.existsSync(policyFilesDirPath)) {
    fs.mkdirSync(policyFilesDirPath, { recursive: true });
  }
}

function getPolicyFileRecordPath(policyId) {
  const safeId = String(policyId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return '';
  return path.join(policyFilesDirPath, `${safeId}.json`);
}

function writePolicyFileRecord(policyId, payload) {
  const recordPath = getPolicyFileRecordPath(policyId);
  if (!recordPath) return false;
  ensurePolicyFilesDir();
  try {
    fs.writeFileSync(recordPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function readPolicyFileRecord(policyId) {
  const recordPath = getPolicyFileRecordPath(policyId);
  if (!recordPath || !fs.existsSync(recordPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(recordPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function deletePolicyFileRecord(policyId) {
  const recordPath = getPolicyFileRecordPath(policyId);
  if (!recordPath || !fs.existsSync(recordPath)) {
    return true;
  }
  try {
    fs.unlinkSync(recordPath);
    return true;
  } catch {
    return false;
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

function getEventSyncMetadata(shift, fallbackDate) {
  const source = String(
    shift?.updatedAt
    || shift?.publishedAt
    || shift?.createdAt
    || ''
  ).trim();
  const parsed = source ? new Date(source) : null;
  const validDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallbackDate;
  const millis = validDate instanceof Date ? validDate.getTime() : Date.now();
  const sequence = Math.max(0, Math.floor((Number.isFinite(millis) ? millis : Date.now()) / 1000));
  return {
    lastModified: formatUtcDateTimeForIcs(validDate instanceof Date ? validDate : new Date()),
    sequence
  };
}

function parseShiftLocalDateTimeParts(dateValue, timeValue) {
  const normalizedDate = String(dateValue || '').slice(0, 10);
  const normalizedTime = String(timeValue || '').trim();
  const match = normalizedTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !match) {
    return '';
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }
  return {
    date: normalizedDate,
    hours,
    minutes
  };
}

function addDaysToIsoDate(dateValue, dayCount) {
  const parsed = new Date(`${String(dateValue || '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  parsed.setDate(parsed.getDate() + Number(dayCount || 0));
  return parsed.toISOString().slice(0, 10);
}

function formatShiftLocalDateTimeForIcs(localParts) {
  if (!localParts || !localParts.date) return '';
  const ymd = String(localParts.date || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(ymd)) return '';
  const hh = String(Number(localParts.hours)).padStart(2, '0');
  const mm = String(Number(localParts.minutes)).padStart(2, '0');
  return `${ymd}T${hh}${mm}00`;
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

  const agentUser = parsedUsers.find((user) => {
    const hasAgentId = Number.isFinite(Number(user?.agentId));
    const role = String(user?.role || '').trim().toLowerCase();
    const isAgentLikeRole = role === 'agent' || role === 'team-lead';
    return hasAgentId && isAgentLikeRole && String(user?.calendarFeedToken || '').trim() === token;
  });
  if (!agentUser) {
    return { status: 404, ics: '' };
  }

  const shifts = Array.isArray(parsedState?.shifts) ? parsedState.shifts : [];
  const agentShifts = shifts
    .filter((shift) => Number(shift?.agentId) === Number(agentUser.agentId))
    .filter((shift) => /^\d{4}-\d{2}-\d{2}$/.test(String(shift?.date || '')))
    .sort((left, right) => `${left.date || ''}${left.start || ''}`.localeCompare(`${right.date || ''}${right.start || ''}`));

  const nowStamp = formatUtcDateTimeForIcs(new Date());
  const generatedAtIso = new Date().toISOString();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Audience Services Scheduling//Agent Schedule//EN',
    `X-WR-CALNAME:${escapeIcsText(`${agentUser.name || agentUser.username || 'Agent'} - Work Schedule`)}`,
    `X-WR-CALDESC:${escapeIcsText(`Auto-updating personal schedule feed. Generated at ${generatedAtIso} (UTC).`)}`,
    `X-AUDIENCE-SCHEDULING-FEED-BUILD:${escapeIcsText(nowStamp)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT5M',
    'X-PUBLISHED-TTL:PT5M',
    'X-WR-TIMEZONE:America/New_York',
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'X-LIC-LOCATION:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];

  agentShifts.forEach((shift, index) => {
    const startParts = parseShiftLocalDateTimeParts(shift.date, shift.start);
    const endParts = parseShiftLocalDateTimeParts(shift.date, shift.end);
    if (!startParts || !endParts) {
      return;
    }
    const startMinutes = (startParts.hours * 60) + startParts.minutes;
    const endMinutes = (endParts.hours * 60) + endParts.minutes;
    const endDateValue = endMinutes <= startMinutes
      ? addDaysToIsoDate(startParts.date, 1)
      : startParts.date;
    const resolvedEndParts = {
      ...endParts,
      date: endDateValue || startParts.date
    };
    const dtStart = formatShiftLocalDateTimeForIcs(startParts);
    const dtEnd = formatShiftLocalDateTimeForIcs(resolvedEndParts);
    if (!dtStart || !dtEnd) {
      return;
    }
    const uid = `${shift.id || `${agentUser.id || agentUser.agentId}-${index}`}@audience-services-scheduling`;
    const summary = `Work Shift - ${shift.role || 'Scheduled Shift'}`;
    const syncMetadata = getEventSyncMetadata(shift, new Date());
    const statusText = shift.status ? `Status: ${shift.status}` : 'Status: scheduled';
    const description = [
      shift.day ? `Day: ${shift.day}` : '',
      statusText,
      shift.location ? `Location: ${shift.location}` : ''
    ].filter(Boolean).join('\\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(uid)}`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`LAST-MODIFIED:${syncMetadata.lastModified}`);
    lines.push(`SEQUENCE:${syncMetadata.sequence}`);
    lines.push(`DTSTART;TZID=America/New_York:${dtStart}`);
    lines.push(`DTEND;TZID=America/New_York:${dtEnd}`);
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
app.use(express.json({ limit: '40mb' }));

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

app.put('/api/policy-files/:id', (req, res) => {
  const policyId = String(req.params.id || '').trim();
  if (!policyId) {
    res.status(400).json({ ok: false, error: 'Missing policy id' });
    return;
  }

  const mimeType = String(req.body?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  const contentBase64 = String(req.body?.contentBase64 || '').trim();
  if (!contentBase64) {
    res.status(400).json({ ok: false, error: 'Missing contentBase64' });
    return;
  }

  const didWrite = writePolicyFileRecord(policyId, {
    id: policyId,
    mimeType,
    contentBase64,
    updatedAt: new Date().toISOString()
  });
  if (!didWrite) {
    res.status(500).json({ ok: false, error: 'Failed to persist policy file' });
    return;
  }

  res.json({ ok: true });
});

app.get('/api/policy-files/:id', (req, res) => {
  const policyId = String(req.params.id || '').trim();
  if (!policyId) {
    res.status(400).json({ ok: false, error: 'Missing policy id' });
    return;
  }

  const record = readPolicyFileRecord(policyId);
  if (!record || !record.contentBase64) {
    res.status(404).json({ ok: false, error: 'Policy file not found' });
    return;
  }

  res.json({
    ok: true,
    id: policyId,
    mimeType: String(record.mimeType || 'application/octet-stream'),
    contentBase64: String(record.contentBase64 || ''),
    updatedAt: String(record.updatedAt || '')
  });
});

app.get('/api/policy-files/:id/raw', (req, res) => {
  const policyId = String(req.params.id || '').trim();
  if (!policyId) {
    res.status(400).send('Missing policy id');
    return;
  }

  const record = readPolicyFileRecord(policyId);
  if (!record || !record.contentBase64) {
    res.status(404).send('Policy file not found');
    return;
  }

  const mimeType = String(record.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  let fileBytes;
  try {
    fileBytes = Buffer.from(String(record.contentBase64 || ''), 'base64');
  } catch {
    res.status(500).send('Invalid policy file encoding');
    return;
  }

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(fileBytes.length));
  res.setHeader('Content-Disposition', `inline; filename="policy-${policyId}"`);
  res.send(fileBytes);
});

app.delete('/api/policy-files/:id', (req, res) => {
  const policyId = String(req.params.id || '').trim();
  if (!policyId) {
    res.status(400).json({ ok: false, error: 'Missing policy id' });
    return;
  }

  const didDelete = deletePolicyFileRecord(policyId);
  if (!didDelete) {
    res.status(500).json({ ok: false, error: 'Failed to delete policy file' });
    return;
  }

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
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(payload.ics);
});

app.listen(port, () => {
  console.log(`Scheduler backend running on http://localhost:${port}`);
});
