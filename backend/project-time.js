export const projectTimeEntriesKey = 'agent-scheduler-project-time-entries-v1';

function parseEntries(raw) {
  const entries = JSON.parse(raw || '[]');
  if (!Array.isArray(entries) || entries.some((entry) => (
    !entry || typeof entry.id !== 'string' || !entry.id
    || !Number.isInteger(entry.agentId) || entry.agentId <= 0
    || typeof entry.project !== 'string' || !entry.project.trim() || entry.project.length > 160
    || typeof entry.details !== 'string' || entry.details.length > 4000
    || !['running', 'paused', 'stopped'].includes(entry.status)
    || !Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0
    || !Number.isInteger(entry.revision) || entry.revision < 1
    || !Number.isFinite(Date.parse(entry.startedAt))
    || !Number.isFinite(Date.parse(entry.updatedAt))
    || (entry.status === 'running' && !Number.isFinite(Date.parse(entry.runningSince)))
    || (entry.status === 'stopped' && !Number.isFinite(Date.parse(entry.stoppedAt)))
  ))) {
    throw new Error('Invalid project time entries.');
  }
  return entries;
}

// Snapshots from different agents must not erase each other's time entries or restore older timer states.
export function mergeProjectTimeStore(currentStore, incomingStore) {
  const nextStore = { ...currentStore, ...incomingStore };
  if (!Object.hasOwn(incomingStore, projectTimeEntriesKey)) return nextStore;
  const entries = new Map(parseEntries(currentStore[projectTimeEntriesKey]).map((entry) => [entry.id, entry]));
  for (const entry of parseEntries(incomingStore[projectTimeEntriesKey])) {
    const previous = entries.get(entry.id);
    if (previous && previous.agentId !== entry.agentId) {
      throw new Error('A project time entry cannot change agents.');
    }
    if (!previous || entry.revision > previous.revision
      || (entry.revision === previous.revision && entry.updatedAt > previous.updatedAt)) {
      entries.set(entry.id, entry);
    }
  }
  nextStore[projectTimeEntriesKey] = JSON.stringify([...entries.values()]);
  return nextStore;
}

export function registerProjectTimeRoutes(app, { readStore, writeStore }) {
  app.get('/api/project-time-entries', (_req, res) => {
    try {
      const entries = parseEntries(readStore()[projectTimeEntriesKey]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ entries });
    } catch (error) {
      console.error('Unable to read stored project time entries.', error);
      res.status(500).json({ ok: false, error: 'Unable to read stored project time entries.' });
    }
  });

  app.put('/api/project-time-entries', (req, res) => {
    let entries;
    try {
      if (!Array.isArray(req.body?.entries)) throw new Error('Entries must be an array.');
      entries = parseEntries(JSON.stringify(req.body.entries));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
    try {
      const nextStore = mergeProjectTimeStore(readStore(), {
        [projectTimeEntriesKey]: JSON.stringify(entries)
      });
      writeStore(nextStore);
      const storedEntries = parseEntries(readStore()[projectTimeEntriesKey]);
      res.json({ ok: true, entries: storedEntries });
    } catch (error) {
      console.error('Unable to persist project time entries.', error);
      res.status(409).json({ ok: false, error: error.message || 'Unable to persist project time entries.' });
    }
  });
}
