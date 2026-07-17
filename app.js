const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const roleOptions = ['In-person', 'WFH', 'Booth Duty', 'Booth Duty (Form)', 'Booth Duty Back-up'];
const teamOptions = ['Audience Services Representative', 'Audience Services Associate'];
const shiftLocationOptions = ['Academy of Music', 'Kimmel Center', 'Miller Theater'];
const storageKey = 'agent-scheduler-state-v4';
const authUsersKey = 'agent-scheduler-users-v1';
const sessionKey = 'agent-scheduler-session-v1';
const availabilityRequestsKey = 'agent-scheduler-availability-requests-v1';
const availabilityInboxKey = 'agent-scheduler-availability-inbox-v1';
const availabilityRequestLedgerKey = 'agent-scheduler-availability-ledger-v1';
const passwordResetRequestsKey = 'agent-scheduler-password-reset-requests-v1';
const rememberedLoginKey = 'agent-scheduler-remembered-login-v1';
const emailOutboxKey = 'agent-scheduler-email-outbox-v1';
const emailDeliverySettingsKey = 'agent-scheduler-email-delivery-settings-v1';
const backendUrlKey = 'agent-scheduler-backend-url-v1';
const syncStatusKey = 'agent-scheduler-sync-status-v1';
const uiStateKey = 'agent-scheduler-ui-state-v1';
const fixedEmailSenderName = 'Audience Services Manager';
const emailDeliveryProviders = ['generic', 'sendgrid', 'mailgun'];
const shiftStatuses = {
  draft: 'draft',
  published: 'published'
};
const defaultBackendApiBase = 'https://scheduling-app-backend-l66q.onrender.com/api';
const sharedStorageKeys = [
  storageKey,
  authUsersKey,
  availabilityRequestsKey,
  availabilityInboxKey,
  availabilityRequestLedgerKey,
  passwordResetRequestsKey,
  emailOutboxKey,
  emailDeliverySettingsKey
];

function normalizeBackendUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function getBackendApiBase() {
  const fromWindow = normalizeBackendUrl(window.__SCHEDULER_API_URL__);
  if (fromWindow) return fromWindow;
  const fromLocalStorage = normalizeBackendUrl(localStorage.getItem(backendUrlKey));
  if (fromLocalStorage) return fromLocalStorage;
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocalHost ? 'http://localhost:8787/api' : defaultBackendApiBase;
}

const backendApiBase = getBackendApiBase();
let isApplyingRemoteSnapshot = false;
let lastRemoteSnapshotHash = '';
const pageMode = (() => {
  const queryMode = new URLSearchParams(window.location.search).get('view');
  if (queryMode === 'calendar') return 'calendar';
  if (queryMode === 'agents') return 'agents';
  if (queryMode === 'agent-requests') return 'agent-requests';
  if (queryMode === 'profile') return 'profile';
  if (queryMode === 'email-outbox') return 'email-outbox';
  if (queryMode === 'availability-requests') return 'availability-requests';
  const mode = document.body?.dataset?.page;
  if (mode === 'calendar') return 'calendar';
  if (mode === 'agents') return 'agents';
  if (mode === 'agent-requests') return 'agent-requests';
  if (mode === 'profile') return 'profile';
  if (mode === 'email-outbox') return 'email-outbox';
  if (mode === 'availability-requests') return 'availability-requests';
  return 'dashboard';
})();

const defaultState = {
  agents: [
    { id: 1, name: 'Maya', email: 'maya@scheduler.local', team: 'Audience Services Representative', role: 'In-person', payRate: 24, minHours: 0, maxHours: 40, availability: 'Available' },
    { id: 2, name: 'Luis', email: 'luis@scheduler.local', team: 'Audience Services Associate', role: 'WFH', payRate: 18, minHours: 0, maxHours: 40, availability: 'Available' },
    { id: 3, name: 'Nina', email: 'nina@scheduler.local', team: 'Audience Services Representative', role: 'Booth Duty', payRate: 15, minHours: 0, maxHours: 40, availability: 'Unavailable' }
  ],
  templates: [
    { id: 1, name: 'Full Time 6pm', start: '09:10', end: '18:00', durationHours: 8.8 },
    { id: 2, name: 'Full Time 8pm', start: '09:40', end: '18:40', durationHours: 9 },
    { id: 3, name: 'Part Time AM', start: '09:40', end: '15:00', durationHours: 5.3 },
    { id: 4, name: 'Part Time PM 6pm', start: '13:00', end: '18:00', durationHours: 5 },
    { id: 5, name: 'Part Time PM 8m', start: '15:00', end: '20:00', durationHours: 5 },
    { id: 6, name: 'Full Time Weekend', start: '10:50', end: '20:00', durationHours: 9.2 },
    { id: 7, name: 'Part Time Weekend AM', start: '10:50', end: '16:00', durationHours: 5.2 },
    { id: 8, name: 'Part Time Weekend PM', start: '15:00', end: '20:00', durationHours: 5 }
  ],
  shifts: [
    { id: 1, day: 'Mon', date: '2026-07-15', agentId: 1, role: 'In-person', start: '08:00', end: '16:00', durationHours: 8, location: 'Academy of Music', status: shiftStatuses.draft },
    { id: 2, day: 'Wed', date: '2026-07-17', agentId: 2, role: 'WFH', start: '16:00', end: '22:00', durationHours: 6, location: 'Academy of Music', status: shiftStatuses.draft }
  ],
  swapRequests: [],
  availabilityRequests: [],
  blackoutDates: [],
  roleColors: {},
  ui: {
    agentSearch: '',
    agentSort: 'name',
    agentRoleFilter: 'All',
    agentsCollapsed: false,
    availabilityRequestsCollapsed: false,
    swapAlertsCollapsed: false,
    agentScheduleView: 'week',
    agentScheduleDay: 'Mon',
    agentScheduleMonth: '',
    availabilityCalendarMonth: '',
    availabilityFrom: '',
    availabilityTo: '',
    accessMode: 'admin',
    currentAgentId: 1,
    calendar: {
      search: '',
      day: 'All',
      agentId: 'All',
      role: 'All',
      agentName: '',
      date: '',
      weekReference: '',
      location: 'All'
    }
  }
};

const defaultAuthUsers = [
  { id: 1001, username: 'admin', name: 'System Admin', jobTitle: 'Scheduling Administrator', email: 'admin@scheduler.local', phone: '215-555-0100', password: 'Admin123!', role: 'admin' },
  { id: 1002, username: 'maya', email: 'maya@scheduler.local', phone: '215-555-0101', password: 'Agent123!', role: 'agent', agentId: 1 },
  { id: 1003, username: 'luis', email: 'luis@scheduler.local', phone: '215-555-0102', password: 'Agent123!', role: 'agent', agentId: 2 },
  { id: 1004, username: 'nina', email: 'nina@scheduler.local', phone: '215-555-0103', password: 'Agent123!', role: 'agent', agentId: 3 }
];

const state = loadState();
let authUsers = loadAuthUsers();
let currentSession = loadSession();
let draggedShiftId = null;
let copiedShiftTemplate = null;
let selectedCalendarShiftIds = new Set();
let memoryAvailabilityInbox = [];
let memoryEmailOutbox = [];
let lastSuccessfulSyncAt = loadLastSuccessfulSyncAt();
let adminManagerNotice = null;
let adminProfileNotice = null;
const attemptedResetTokenLookups = new Set();
const defaultEmailDeliverySettings = {
  enabled: false,
  provider: 'generic',
  webhookUrl: '',
  authToken: '',
  fromEmail: 'no-reply@scheduler.local',
  fromName: fixedEmailSenderName
};
let emailDeliverySettings = loadEmailDeliverySettings();
let availabilitySubmitFallbackBound = false;
const root = document.getElementById('root');

function getDefaultUiState() {
  return {
    agentSearch: '',
    agentSort: 'name',
    agentRoleFilter: 'All',
    agentsCollapsed: false,
    availabilityRequestsCollapsed: false,
    swapAlertsCollapsed: false,
    agentScheduleView: 'week',
    agentScheduleDay: 'Mon',
    agentScheduleMonth: '',
    availabilityCalendarMonth: '',
    availabilityFrom: '',
    availabilityTo: '',
    accessMode: 'admin',
    currentAgentId: defaultState.agents[0]?.id ?? null,
    calendar: {
      search: '',
      day: 'All',
      agentId: 'All',
      role: 'All',
      agentName: '',
      date: '',
      weekReference: '',
      location: 'All'
    }
  };
}

function normalizeUiState(source) {
  const defaults = getDefaultUiState();
  return {
    agentSearch: source?.agentSearch || defaults.agentSearch,
    agentSort: source?.agentSort || defaults.agentSort,
    agentRoleFilter: source?.agentRoleFilter || defaults.agentRoleFilter,
    agentsCollapsed: Boolean(source?.agentsCollapsed),
    availabilityRequestsCollapsed: Boolean(source?.availabilityRequestsCollapsed),
    swapAlertsCollapsed: Boolean(source?.swapAlertsCollapsed),
    agentScheduleView: source?.agentScheduleView || defaults.agentScheduleView,
    agentScheduleDay: source?.agentScheduleDay || defaults.agentScheduleDay,
    agentScheduleMonth: source?.agentScheduleMonth || defaults.agentScheduleMonth,
    availabilityCalendarMonth: source?.availabilityCalendarMonth || defaults.availabilityCalendarMonth,
    availabilityFrom: source?.availabilityFrom || defaults.availabilityFrom,
    availabilityTo: source?.availabilityTo || defaults.availabilityTo,
    accessMode: source?.accessMode || defaults.accessMode,
    currentAgentId: source?.currentAgentId ?? defaults.currentAgentId,
    calendar: {
      search: source?.calendar?.search || defaults.calendar.search,
      day: source?.calendar?.day || defaults.calendar.day,
      agentId: source?.calendar?.agentId || defaults.calendar.agentId,
      role: source?.calendar?.role || defaults.calendar.role,
      agentName: source?.calendar?.agentName || defaults.calendar.agentName,
      date: source?.calendar?.date || defaults.calendar.date,
      weekReference: source?.calendar?.weekReference || defaults.calendar.weekReference,
      location: source?.calendar?.location || defaults.calendar.location
    }
  };
}

function loadUiState(legacyUi) {
  let localUi = null;
  try {
    const saved = localStorage.getItem(uiStateKey);
    if (saved) {
      localUi = JSON.parse(saved);
    }
  } catch {
    localUi = null;
  }
  return normalizeUiState(localUi || legacyUi || {});
}

function saveUiState() {
  try {
    localStorage.setItem(uiStateKey, JSON.stringify(normalizeUiState(state.ui)));
  } catch {
    // UI persistence is local-only and non-critical.
  }
}

function loadLastSuccessfulSyncAt() {
  try {
    const saved = localStorage.getItem(syncStatusKey);
    if (!saved) return '';
    const parsed = JSON.parse(saved);
    const at = String(parsed?.at || '');
    return at ? at : '';
  } catch {
    return '';
  }
}

function markSyncSuccess() {
  const nowIso = new Date().toISOString();
  lastSuccessfulSyncAt = nowIso;
  try {
    localStorage.setItem(syncStatusKey, JSON.stringify({ at: nowIso }));
  } catch {
    // Ignore storage write errors for sync metadata.
  }
}

function getLastSyncStatusText() {
  if (!backendApiBase) {
    return 'Sync status: Local-only mode (no shared backend configured).';
  }
  if (!lastSuccessfulSyncAt) {
    return 'Last synced: Waiting for first successful backend sync.';
  }
  const syncDate = new Date(lastSuccessfulSyncAt);
  if (Number.isNaN(syncDate.getTime())) {
    return 'Last synced: Waiting for first successful backend sync.';
  }
  return `Last synced: ${syncDate.toLocaleString()}`;
}

function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    if (!isApplyingRemoteSnapshot && sharedStorageKeys.includes(key)) {
      void pushSharedKeyToBackend(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

function syncSharedSnapshotToBackend() {
  if (!backendApiBase) return false;
  try {
    const store = {};
    sharedStorageKeys.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value !== null) {
        store[key] = value;
      }
    });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${backendApiBase}/snapshot`, false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ store }));
    return xhr.status >= 200 && xhr.status < 300;
  } catch {
    return false;
  }
}

async function requestBackend(path, options = {}) {
  if (!backendApiBase) return null;
  try {
    const response = await fetch(`${backendApiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
}

async function pushSharedKeyToBackend(key, rawValue) {
  if (!backendApiBase) return false;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${backendApiBase}/store/${encodeURIComponent(key)}`, false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ value: rawValue }));
    const ok = xhr.status >= 200 && xhr.status < 300;
    if (ok) {
      markSyncSuccess();
    }
    return ok;
  } catch {
    return false;
  }
}

async function fetchBackendSnapshot() {
  const response = await requestBackend('/snapshot');
  if (!response) return null;
  const payload = await response.json();
  return payload?.store && typeof payload.store === 'object' ? payload.store : null;
}

async function pushLocalSnapshotToBackend() {
  if (!backendApiBase) return false;
  const store = {};
  sharedStorageKeys.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) {
      store[key] = value;
    }
  });
  const response = await requestBackend('/snapshot', {
    method: 'PUT',
    body: JSON.stringify({ store })
  });
  return Boolean(response);
}

function getSnapshotHash(store) {
  try {
    return JSON.stringify(store || {});
  } catch {
    return '';
  }
}

function applyRemoteSnapshot(store) {
  if (!store || typeof store !== 'object') return;
  isApplyingRemoteSnapshot = true;
  try {
    sharedStorageKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(store, key)) return;
      const value = store[key];
      if (typeof value === 'string') {
        localStorage.setItem(key, value);
      }
    });
  } finally {
    isApplyingRemoteSnapshot = false;
  }
}

async function initializeBackendSync() {
  if (!backendApiBase) return;
  const remoteStore = await fetchBackendSnapshot();
  if (!remoteStore) return;

  const hasRemoteData = sharedStorageKeys.some((key) => typeof remoteStore[key] === 'string' && remoteStore[key].length > 0);
  const hasLocalData = sharedStorageKeys.some((key) => {
    const value = localStorage.getItem(key);
    return value !== null && value.length > 0;
  });

  if (hasRemoteData) {
    applyRemoteSnapshot(remoteStore);
    lastRemoteSnapshotHash = getSnapshotHash(remoteStore);
    markSyncSuccess();
    syncFromStorage();
  } else if (hasLocalData) {
    const pushed = await pushLocalSnapshotToBackend();
    if (pushed) {
      markSyncSuccess();
    }
  }
}

async function pollBackendSync() {
  if (!backendApiBase || document.hidden) return;
  const remoteStore = await fetchBackendSnapshot();
  if (!remoteStore) return;
  const nextHash = getSnapshotHash(remoteStore);
  if (!nextHash || nextHash === lastRemoteSnapshotHash) return;
  lastRemoteSnapshotHash = nextHash;
  applyRemoteSnapshot(remoteStore);
  markSyncSuccess();
  syncFromStorage();
  render();
}

if (loadAvailabilityRequestsFromStorage().length === 0 && Array.isArray(state.availabilityRequests) && state.availabilityRequests.length > 0) {
  safeSetLocalStorage(availabilityRequestsKey, JSON.stringify(mergeAvailabilityRequests(state.availabilityRequests)));
}

function syncFromStorage() {
  const latestState = loadState();
  Object.assign(state, latestState);
  state.availabilityRequests = getAllAvailabilityRequests();
  authUsers = loadAuthUsers();
  currentSession = loadSession();
  emailDeliverySettings = loadEmailDeliverySettings();
}

function createId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function loadAvailabilityRequestsFromStorage() {
  try {
    const saved = localStorage.getItem(availabilityRequestsKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadAvailabilityRequestsFromInbox() {
  try {
    const saved = localStorage.getItem(availabilityInboxKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadAvailabilityRequestsFromLedger() {
  try {
    const saved = localStorage.getItem(availabilityRequestLedgerKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAvailabilityRequestsToLedger(requests) {
  try {
    const existingLedger = loadAvailabilityRequestsFromLedger();
    const mergedLedger = mergeAvailabilityRequests(existingLedger, requests);
    safeSetLocalStorage(availabilityRequestLedgerKey, JSON.stringify(mergedLedger));
  } catch {
    // Keep primary availability stores working even if ledger write fails.
  }
}

function loadAvailabilityRequestsFromLegacyStateStorage() {
  try {
    const savedState = localStorage.getItem(storageKey);
    if (!savedState) return [];
    const parsedState = JSON.parse(savedState);
    return Array.isArray(parsedState?.availabilityRequests) ? parsedState.availabilityRequests : [];
  } catch {
    return [];
  }
}

function mergeAvailabilityRequests(...sources) {
  const merged = sources.flatMap((source) => (Array.isArray(source) ? source : []));
  const byId = new Map();
  merged.forEach((request, index) => {
    if (!request) return;
    const fallbackId = [
      request.agentId,
      request.requestedAt,
      request.unavailableDate,
      request.unavailableStart,
      request.unavailableEnd,
      request.unavailabilityType,
      request.note,
      index
    ].join('|');
    const requestId = request.id != null ? String(request.id) : fallbackId;
    byId.set(requestId, request.id == null ? { ...request, id: requestId } : request);
  });
  return Array.from(byId.values());
}

function getAllAvailabilityRequests() {
  const canonicalRequests = mergeAvailabilityRequests(
    loadAvailabilityRequestsFromLedger(),
    loadAvailabilityRequestsFromLegacyStateStorage(),
    loadAvailabilityRequestsFromStorage(),
    state.availabilityRequests,
    memoryAvailabilityInbox,
    loadAvailabilityRequestsFromInbox()
  );
  if (canonicalRequests.length > 0) {
    safeSetLocalStorage(availabilityInboxKey, JSON.stringify(canonicalRequests));
    safeSetLocalStorage(availabilityRequestsKey, JSON.stringify(canonicalRequests));
    saveAvailabilityRequestsToLedger(canonicalRequests);
  }
  state.availabilityRequests = canonicalRequests;
  memoryAvailabilityInbox = canonicalRequests;
  return canonicalRequests;
}

function saveAvailabilityRequests(requests) {
  const canonicalRequests = mergeAvailabilityRequests(requests);
  state.availabilityRequests = canonicalRequests;
  memoryAvailabilityInbox = canonicalRequests;
  safeSetLocalStorage(availabilityInboxKey, JSON.stringify(canonicalRequests));
  safeSetLocalStorage(availabilityRequestsKey, JSON.stringify(canonicalRequests));
  saveAvailabilityRequestsToLedger(canonicalRequests);
  try {
    const savedState = localStorage.getItem(storageKey);
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      parsedState.availabilityRequests = canonicalRequests;
      safeSetLocalStorage(storageKey, JSON.stringify(parsedState));
    }
  } catch {
    // Dedicated request storage remains the source of truth.
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').trim();
}

function getFallbackEmail(user) {
  const localPart = String(user?.username || `user${user?.id || createId()}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '');
  return `${localPart || 'user'}@scheduler.local`;
}

function createUniqueAgentUsername(email) {
  const localPart = String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[0]
    .replace(/[^a-z0-9._-]+/g, '') || 'agent';
  let candidate = localPart;
  let suffix = 1;
  while (authUsers.some((user) => String(user.username || '').toLowerCase() === candidate)) {
    candidate = `${localPart}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createUniqueAccountUsername(email, fallback = 'user') {
  const localPart = String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[0]
    .replace(/[^a-z0-9._-]+/g, '') || fallback;
  let candidate = localPart;
  let suffix = 1;
  while (authUsers.some((user) => String(user.username || '').toLowerCase() === candidate)) {
    candidate = `${localPart}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createTemporaryPassword() {
  return `Temp-${Math.random().toString(36).slice(2, 8)}A1!`;
}

function createCalendarFeedToken() {
  if (globalThis.crypto?.randomUUID) {
    return `cal-${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 16)}`;
}

function normalizeCalendarFeedToken(value) {
  const normalized = String(value || '').trim();
  return normalized || createCalendarFeedToken();
}

function getAgentCalendarFeedUrl(feedToken) {
  const normalizedApiBase = normalizeBackendUrl(backendApiBase);
  const normalizedToken = String(feedToken || '').trim();
  if (!normalizedApiBase || !normalizedToken) {
    return '';
  }
  return `${normalizedApiBase}/calendar-feed/${encodeURIComponent(normalizedToken)}.ics`;
}

async function copyTextValue(textValue) {
  const normalizedText = String(textValue || '').trim();
  if (!normalizedText) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalizedText);
      return true;
    } catch {
      // Fall through to execCommand fallback.
    }
  }
  const input = document.createElement('input');
  input.value = normalizedText;
  document.body.appendChild(input);
  input.select();
  let didCopy = false;
  try {
    didCopy = document.execCommand('copy');
  } catch {
    didCopy = false;
  }
  document.body.removeChild(input);
  return didCopy;
}

function withRequiredEmail(user) {
  const normalizedEmail = normalizeEmail(user?.email);
  const normalizedPhone = normalizePhone(user?.phone);
  const calendarFeedToken = normalizeCalendarFeedToken(user?.calendarFeedToken);
  return {
    ...user,
    email: normalizedEmail || getFallbackEmail(user),
    phone: normalizedPhone,
    calendarFeedToken,
    mustChangePassword: Boolean(user?.mustChangePassword),
    isActive: user?.isActive !== false
  };
}

function loadAuthUsers() {
  try {
    const saved = localStorage.getItem(authUsersKey);
    if (!saved) return defaultAuthUsers.map((user) => withRequiredEmail(user));
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return defaultAuthUsers.map((user) => withRequiredEmail(user));
    }
    return parsed.map((user) => withRequiredEmail(user));
  } catch {
    return defaultAuthUsers.map((user) => withRequiredEmail(user));
  }
}

function saveAuthUsers() {
  // Persist auth users through shared storage so profile edits sync across devices.
  const didSave = safeSetLocalStorage(authUsersKey, JSON.stringify(authUsers));
  if (didSave && !isApplyingRemoteSnapshot && backendApiBase) {
    // Auth updates are critical for login; push a full snapshot best-effort.
    void pushLocalSnapshotToBackend();
  }
  return didSave;
}

function loadPasswordResetRequests() {
  try {
    const saved = localStorage.getItem(passwordResetRequestsKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePasswordResetRequests(requests) {
  safeSetLocalStorage(passwordResetRequestsKey, JSON.stringify(requests));
}

function loadRememberedLogin() {
  try {
    const saved = localStorage.getItem(rememberedLoginKey);
    if (!saved) return { email: '', password: '' };
    const parsed = JSON.parse(saved);
    return {
      email: normalizeEmail(parsed?.email || ''),
      password: String(parsed?.password || '')
    };
  } catch {
    return { email: '', password: '' };
  }
}

function saveRememberedLogin(email, password, shouldRemember) {
  try {
    if (!shouldRemember) {
      localStorage.removeItem(rememberedLoginKey);
      return;
    }
    const normalizedEmail = normalizeEmail(email);
    const passwordValue = String(password || '');
    if (!normalizedEmail || !passwordValue) {
      localStorage.removeItem(rememberedLoginKey);
      return;
    }
    localStorage.setItem(rememberedLoginKey, JSON.stringify({
      email: normalizedEmail,
      password: passwordValue
    }));
  } catch {
    // Remembered-login storage failures should never block sign-in.
  }
}

function syncRememberedLoginPassword(user, nextPassword) {
  const rememberedLogin = loadRememberedLogin();
  const rememberedEmail = normalizeEmail(rememberedLogin.email);
  const userEmail = normalizeEmail(user?.email);
  if (!rememberedEmail || !userEmail || rememberedEmail !== userEmail) {
    return;
  }
  saveRememberedLogin(userEmail, nextPassword, true);
}

function loadEmailOutbox() {
  try {
    const saved = localStorage.getItem(emailOutboxKey);
    if (!saved) return [...memoryEmailOutbox];
    const parsed = JSON.parse(saved);
    const fromStorage = Array.isArray(parsed) ? parsed : [];
    const merged = [...memoryEmailOutbox, ...fromStorage];
    const deduped = [];
    const seen = new Set();
    merged.forEach((item) => {
      const key = String(item?.id || `${item?.to || ''}|${item?.subject || ''}|${item?.createdAt || ''}`);
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(item);
    });
    memoryEmailOutbox = deduped;
    return deduped;
  } catch {
    return [...memoryEmailOutbox];
  }
}

function saveEmailOutbox(messages) {
  memoryEmailOutbox = Array.isArray(messages) ? [...messages] : [];
  safeSetLocalStorage(emailOutboxKey, JSON.stringify(memoryEmailOutbox));
}

function normalizeWebhookUrl(value) {
  return String(value || '').trim();
}

function loadEmailDeliverySettings() {
  try {
    const saved = localStorage.getItem(emailDeliverySettingsKey);
    if (!saved) return { ...defaultEmailDeliverySettings };
    const parsed = JSON.parse(saved);
    const provider = String(parsed?.provider || 'generic').toLowerCase();
    return {
      enabled: Boolean(parsed?.enabled),
      provider: emailDeliveryProviders.includes(provider) ? provider : 'generic',
      webhookUrl: normalizeWebhookUrl(parsed?.webhookUrl),
      authToken: String(parsed?.authToken || '').trim(),
      fromEmail: normalizeEmail(parsed?.fromEmail || defaultEmailDeliverySettings.fromEmail),
      fromName: fixedEmailSenderName
    };
  } catch {
    return { ...defaultEmailDeliverySettings };
  }
}

function saveEmailDeliverySettings(nextSettings) {
  const provider = String(nextSettings?.provider || 'generic').toLowerCase();
  emailDeliverySettings = {
    enabled: Boolean(nextSettings?.enabled),
    provider: emailDeliveryProviders.includes(provider) ? provider : 'generic',
    webhookUrl: normalizeWebhookUrl(nextSettings?.webhookUrl),
    authToken: String(nextSettings?.authToken || '').trim(),
    fromEmail: normalizeEmail(nextSettings?.fromEmail || defaultEmailDeliverySettings.fromEmail),
    fromName: fixedEmailSenderName
  };
  safeSetLocalStorage(emailDeliverySettingsKey, JSON.stringify(emailDeliverySettings));
}

function updateOutboxMessageById(messageId, partial) {
  const outbox = loadEmailOutbox();
  const index = outbox.findIndex((message) => String(message.id) === String(messageId));
  if (index < 0) return;
  outbox[index] = {
    ...outbox[index],
    ...partial,
    updatedAt: new Date().toISOString()
  };
  saveEmailOutbox(outbox);
}

function getEmailAuthHeaderValue(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return '';
  if (/^(Bearer|Basic)\s+/i.test(trimmed)) {
    return trimmed;
  }
  return `Bearer ${trimmed}`;
}

function buildEmailDeliveryRequest(settings, message) {
  const htmlBody = String(message.body || '').replace(/\n/g, '<br />');
  if (settings.provider === 'sendgrid') {
    return {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: message.to }]
          }
        ],
        from: {
          email: settings.fromEmail,
          name: settings.fromName
        },
        subject: message.subject,
        content: [
          { type: 'text/plain', value: String(message.body || '') },
          { type: 'text/html', value: htmlBody }
        ],
        custom_args: {
          type: message.type,
          createdAt: message.createdAt
        }
      })
    };
  }

  if (settings.provider === 'mailgun') {
    const form = new URLSearchParams();
    form.set('from', `${settings.fromName} <${settings.fromEmail}>`);
    form.set('to', message.to);
    form.set('subject', message.subject);
    form.set('text', String(message.body || ''));
    form.set('html', htmlBody);
    form.set('o:tag', String(message.type || 'notification'));
    return {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
      body: form.toString()
    };
  }

  return {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({
      to: message.to,
      subject: message.subject,
      text: message.body,
      html: htmlBody,
      fromEmail: settings.fromEmail,
      fromName: settings.fromName,
      type: message.type,
      createdAt: message.createdAt
    })
  };
}

async function sendEmailThroughWebhook(message) {
  const settings = loadEmailDeliverySettings();
  if (!settings.enabled || !settings.webhookUrl) {
    return;
  }

  try {
    const request = buildEmailDeliveryRequest(settings, message);
    const headers = {
      'Content-Type': request.contentType
    };
    const authHeader = getEmailAuthHeaderValue(settings.authToken);
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    const response = await fetch(settings.webhookUrl, {
      method: request.method,
      headers,
      body: request.body
    });

    if (!response.ok) {
      throw new Error(`Webhook email failed (${response.status})`);
    }

    updateOutboxMessageById(message.id, {
      deliveryStatus: 'sent',
      deliveredAt: new Date().toISOString(),
      deliveryError: ''
    });
  } catch (error) {
    updateOutboxMessageById(message.id, {
      deliveryStatus: 'failed',
      deliveryError: String(error?.message || 'Email delivery failed')
    });
  }
}

function retryUndeliveredOutboxEmails() {
  const settings = loadEmailDeliverySettings();
  if (!settings.enabled || !settings.webhookUrl) {
    return { attempted: 0, skipped: true };
  }
  const retryableStatuses = new Set(['local-only', 'failed', 'pending']);
  const retryableMessages = loadEmailOutbox().filter((message) => retryableStatuses.has(String(message.deliveryStatus || 'local-only')));
  retryableMessages.forEach((message) => {
    updateOutboxMessageById(message.id, {
      deliveryStatus: 'pending',
      deliveryProvider: settings.provider || 'generic',
      deliveryError: ''
    });
    void sendEmailThroughWebhook(message);
  });
  return { attempted: retryableMessages.length, skipped: false };
}

function sendEmailNotification({ to, subject, body, type }) {
  const settings = loadEmailDeliverySettings();
  const shouldAttemptDelivery = settings.enabled && Boolean(settings.webhookUrl);
  const message = {
    id: createId(),
    to: to || '(no email on account)',
    subject,
    body,
    type: type || 'notification',
    createdAt: new Date().toISOString(),
    deliveryStatus: shouldAttemptDelivery ? 'pending' : 'local-only',
    deliveryProvider: settings.provider || 'generic',
    deliveryError: ''
  };
  const outbox = loadEmailOutbox();
  outbox.push(message);
  saveEmailOutbox(outbox);
  if (shouldAttemptDelivery) {
    void sendEmailThroughWebhook(message);
  }
  return message;
}

function getUserByAgentId(agentId) {
  const normalizedId = Number(agentId);
  return authUsers.find((user) => user.role === 'agent' && Number(user.agentId) === normalizedId) || null;
}

function sendAgentInviteEmail(agentUser, agentName, temporaryPassword = '') {
  if (!agentUser?.id || !agentUser?.email) {
    return null;
  }
  const signInLink = getAppLoginUrl();
  const inviteTempPassword = String(temporaryPassword || agentUser.password || '').trim();
  const inviteMessage = sendEmailNotification({
    to: normalizeEmail(agentUser.email),
    subject: 'You have been invited to Agent Scheduler',
    body: `Hi ${agentName || 'Agent'}, your agent account is ready.\n\nTemporary password: ${inviteTempPassword || '(not available)'}\nSign in: ${signInLink}\n\nAfter your first sign in, you will be prompted to create your own password.`,
    type: 'agent-invite'
  });
  return {
    signInLink,
    temporaryPassword: inviteTempPassword,
    deliveryStatus: inviteMessage?.deliveryStatus || 'local-only'
  };
}

function sendAdminInviteEmail(adminUser) {
  if (!adminUser?.id || !adminUser?.email) {
    return null;
  }
  const passwordResetRequests = loadPasswordResetRequests();
  const token = createResetToken();
  const resetLink = getResetLink(token);
  passwordResetRequests.push({
    id: createId(),
    token,
    userId: adminUser.id,
    email: normalizeEmail(adminUser.email),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
    used: false
  });
  savePasswordResetRequests(passwordResetRequests);
  const inviteMessage = sendEmailNotification({
    to: normalizeEmail(adminUser.email),
    subject: 'You have been invited as a manager',
    body: `Hi ${adminUser.name || adminUser.username || 'Manager'}, your manager account is ready. Use this link to create your password and sign in: ${resetLink}`,
    type: 'admin-invite'
  });
  return {
    resetLink,
    deliveryStatus: inviteMessage?.deliveryStatus || 'local-only'
  };
}

function sendShiftPublishedEmail(shift) {
  const agentId = Number(shift?.agentId);
  if (!agentId) return false;
  const agentUser = getUserByAgentId(agentId);
  const recipientEmail = normalizeEmail(agentUser?.email);
  if (!recipientEmail) return false;

  const agentName = getAgent(agentId)?.name || agentUser?.username || 'Agent';
  sendEmailNotification({
    to: recipientEmail,
    subject: 'New shift published',
    body: `Hi ${agentName}, your shift has been published: ${getShiftSummary(shift, true)}.`,
    type: 'shift-published'
  });
  return true;
}

function getAppLoginUrl() {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/index.html';
    }
    return url.toString();
  } catch {
    return window.location.href.split('?')[0];
  }
}

function createResetToken() {
  return `reset-${createId()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getResetLink(token) {
  try {
    const loginUrl = new URL(getAppLoginUrl());
    loginUrl.searchParams.set('resetToken', String(token || ''));
    return loginUrl.toString();
  } catch {
    const baseUrl = getAppLoginUrl();
    return `${baseUrl}?resetToken=${encodeURIComponent(token)}`;
  }
}

function loadSession() {
  try {
    const saved = localStorage.getItem(sessionKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return parsed && parsed.userId ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession() {
  safeSetLocalStorage(sessionKey, JSON.stringify(currentSession));
}

function clearSession() {
  currentSession = null;
  localStorage.removeItem(sessionKey);
}

if (!localStorage.getItem(authUsersKey)) {
  saveAuthUsers();
}

function getCurrentUser() {
  if (!currentSession?.userId) return null;
  return authUsers.find((user) => user.id === currentSession.userId) || null;
}

function getActiveAdminCount() {
  return authUsers.filter((user) => user.role === 'admin' && user.isActive !== false).length;
}

function applyAccessForUser(user) {
  if (user.role === 'admin') {
    const switchedIntoAdmin = state.ui.accessMode !== 'admin';
    state.ui.accessMode = 'admin';
    if (switchedIntoAdmin) {
      state.ui.availabilityFrom = '';
      state.ui.availabilityTo = '';
      state.ui.calendar = {
        ...(state.ui.calendar || {}),
        search: '',
        day: 'All',
        agentId: 'All',
        role: 'All',
        agentName: '',
        date: '',
        weekReference: state.ui.calendar?.weekReference || '',
        location: 'All'
      };
    }
    state.ui.availabilityRequestsCollapsed = false;
    state.ui.swapAlertsCollapsed = false;
    return;
  }
  state.ui.accessMode = 'agent';
  state.ui.currentAgentId = Number(user.agentId);
}

function getUserDisplayName(user) {
  if (!user) return '';
  if (user.role === 'agent') {
    return getAgent(Number(user.agentId))?.name || user.username;
  }
  return user.username;
}

function renderLoginPage(errorMessage = '', infoMessage = '', resetLink = '') {
  const rememberedLogin = loadRememberedLogin();
  const rememberedEmail = rememberedLogin.email || '';
  const rememberedPassword = rememberedLogin.password || '';
  const shouldPrefillRememberedLogin = Boolean(rememberedEmail && rememberedPassword);
  const query = new URLSearchParams(window.location.search);
  const resetToken = query.get('resetToken');
  if (resetToken) {
    const passwordResetRequests = loadPasswordResetRequests();
    const matchingRequest = passwordResetRequests.find((request) => request.token === resetToken);
    const isValidRequest = Boolean(
      matchingRequest
      && !matchingRequest.used
      && matchingRequest.expiresAt
      && matchingRequest.expiresAt > new Date().toISOString()
    );

    if (!isValidRequest) {
      if (backendApiBase && !attemptedResetTokenLookups.has(resetToken)) {
        attemptedResetTokenLookups.add(resetToken);
        root.innerHTML = `
          <div class="app" style="max-width:560px; padding-top:48px;">
            <div class="panel">
              <h1>Reset password</h1>
              <div class="muted">Checking your invite link...</div>
            </div>
          </div>
        `;
        void fetchBackendSnapshot().then((remoteStore) => {
          if (remoteStore) {
            applyRemoteSnapshot(remoteStore);
            syncFromStorage();
          }
          render();
        });
        return;
      }

      root.innerHTML = `
        <div class="app" style="max-width:560px; padding-top:48px;">
          <div class="panel">
            <h1>Reset password</h1>
            <div class="card" style="border-color:#ef4444; margin-bottom:12px;">This password reset link is invalid or has expired.</div>
            <a href="index.html" style="color:#fff; text-decoration:none;"><button type="button">Back to sign in</button></a>
          </div>
        </div>
      `;
      return;
    }

    root.innerHTML = `
      <div class="app" style="max-width:560px; padding-top:48px;">
        <div class="panel">
          <h1>Create a new password</h1>
          <p class="muted">Set a new password for ${escapeHtml(matchingRequest.email || 'your account')}.</p>
          <form id="reset-password-form" class="stack">
            <input name="newPassword" type="password" placeholder="New password" required autocomplete="new-password" />
            <input name="confirmPassword" type="password" placeholder="Confirm new password" required autocomplete="new-password" />
            <button type="submit">Reset password</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('reset-password-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const newPassword = formData.get('newPassword')?.toString() || '';
      const confirmPassword = formData.get('confirmPassword')?.toString() || '';

      if (newPassword.length < 8) {
        alert('New password must be at least 8 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        alert('New password and confirmation do not match.');
        return;
      }

      authUsers = authUsers.map((user) => user.id === Number(matchingRequest.userId)
        ? { ...user, password: newPassword }
        : user);
      saveAuthUsers();

      const updatedRequests = passwordResetRequests.map((request) => request.token === resetToken
        ? { ...request, used: true, usedAt: new Date().toISOString() }
        : request);
      savePasswordResetRequests(updatedRequests);
      attemptedResetTokenLookups.delete(resetToken);

      window.history.replaceState({}, '', window.location.pathname);
      renderLoginPage('', 'Password reset successful. You can now log in with your new password.');
    });
    return;
  }

  root.innerHTML = `
    <div class="app" style="max-width:560px; padding-top:48px;">
      <div class="panel">
        <h1>Sign in</h1>
        <p class="muted">Log in to access admin or agent scheduling pages.</p>
        ${errorMessage ? `<div class="card" style="border-color:#ef4444; margin-bottom:12px;">${escapeHtml(errorMessage)}</div>` : ''}
        ${infoMessage ? `<div class="card" style="border-color:#16a34a; margin-bottom:12px;">${escapeHtml(infoMessage)}${resetLink ? `<div style="margin-top:8px;"><a href="${escapeHtml(resetLink)}" style="color:#93c5fd;">Open reset link</a></div>` : ''}</div>` : ''}
        <form id="login-form" class="stack">
          <input name="email" type="email" placeholder="Email" required autocomplete="email" value="${escapeHtml(rememberedEmail)}" />
          <input name="password" type="password" placeholder="Password" required autocomplete="current-password" value="${escapeHtml(rememberedPassword)}" />
          <label class="row" style="justify-content:flex-start; align-items:center; gap:8px;">
            <input name="savePassword" type="checkbox" value="1" ${shouldPrefillRememberedLogin ? 'checked' : ''} />
            <span>Save password on this device</span>
          </label>
          <button type="submit">Log in</button>
        </form>
        ${shouldPrefillRememberedLogin ? '<button id="clear-saved-login" type="button" class="secondary" style="margin-top:10px;">Clear saved password on this device</button>' : ''}
        <form id="forgot-password-form" class="stack" style="margin-top:10px;">
          <input name="email" type="email" placeholder="Forgot password? Enter your email" required autocomplete="email" />
          <button type="submit" class="secondary">Send reset email</button>
        </form>
        <div class="muted" style="margin-top:8px;">Local mode note: this app generates a reset link you can open directly.</div>
      </div>
    </div>
  `;

  document.getElementById('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = normalizeEmail(formData.get('email'));
    const password = formData.get('password')?.toString() || '';
    const shouldRememberLogin = Boolean(formData.get('savePassword'));
    let foundUser = authUsers.find((user) => normalizeEmail(user.email) === email && user.password === password);
    if (!foundUser && backendApiBase) {
      // If local auth data is stale, refresh once from backend before failing login.
      const remoteStore = await fetchBackendSnapshot();
      if (remoteStore) {
        applyRemoteSnapshot(remoteStore);
        syncFromStorage();
        foundUser = authUsers.find((user) => normalizeEmail(user.email) === email && user.password === password);
      }
    }
    if (!foundUser) {
      renderLoginPage('Invalid email or password.');
      return;
    }
    if (foundUser.isActive === false) {
      renderLoginPage('This manager account has been deactivated. Contact another admin for access.');
      return;
    }
    if (foundUser.role === 'agent' && !state.agents.some((agent) => agent.id === Number(foundUser.agentId))) {
      renderLoginPage('This account is not linked to a valid agent record.');
      return;
    }
    saveRememberedLogin(email, password, shouldRememberLogin);
    currentSession = { userId: foundUser.id };
    saveSession();
    applyAccessForUser(foundUser);
    saveUiState();
    render();
  });

  document.getElementById('clear-saved-login')?.addEventListener('click', () => {
    saveRememberedLogin('', '', false);
    renderLoginPage('', 'Saved login was cleared on this device.');
  });

  document.getElementById('forgot-password-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = normalizeEmail(formData.get('email'));
    const foundUser = authUsers.find((user) => normalizeEmail(user.email) === email);

    if (!foundUser) {
      renderLoginPage('', 'If the account exists, a reset email has been sent.');
      return;
    }

    const passwordResetRequests = loadPasswordResetRequests();
    const token = createResetToken();
    const resetLink = getResetLink(token);
    const expiresAt = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
    const updatedRequests = [
      ...passwordResetRequests,
      {
        id: createId(),
        token,
        userId: foundUser.id,
        email,
        createdAt: new Date().toISOString(),
        expiresAt,
        used: false
      }
    ];
    savePasswordResetRequests(updatedRequests);
    sendEmailNotification({
      to: email,
      subject: 'Password reset request',
      body: `We received a request to reset your password. Use this link within 1 hour: ${resetLink}`,
      type: 'password-reset'
    });
    renderLoginPage('', 'Reset email sent. Open the link below to reset your password.', resetLink);
  });
}

function renderFirstLoginPasswordSetupPage(currentUser) {
  root.innerHTML = `
    <div class="app" style="max-width:560px; padding-top:48px;">
      <div class="panel">
        <h1>Set your password</h1>
        <p class="muted">For security, you must create your own password before continuing.</p>
        <form id="first-login-password-form" class="stack">
          <input name="newPassword" type="password" placeholder="New password" required autocomplete="new-password" />
          <input name="confirmPassword" type="password" placeholder="Confirm new password" required autocomplete="new-password" />
          <label class="row" style="justify-content:flex-start; align-items:center; gap:8px;">
            <input name="savePassword" type="checkbox" value="1" />
            <span>Save password on this device</span>
          </label>
          <button type="submit">Save password and continue</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('first-login-password-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newPassword = formData.get('newPassword')?.toString() || '';
    const confirmPassword = formData.get('confirmPassword')?.toString() || '';
    const shouldRememberLogin = Boolean(formData.get('savePassword'));

    if (newPassword.length < 8) {
      alert('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('New password and confirmation do not match.');
      return;
    }

    authUsers = authUsers.map((user) => user.id === currentUser.id
      ? {
          ...user,
          password: newPassword,
          mustChangePassword: false
        }
      : user);
    const didSaveAuthUsers = saveAuthUsers();
    if (!didSaveAuthUsers) {
      alert('Unable to save your new password right now. Please check browser storage settings and try again.');
      return;
    }
    const persistedUser = loadAuthUsers().find((user) => Number(user.id) === Number(currentUser.id));
    if (!persistedUser || persistedUser.password !== newPassword || persistedUser.mustChangePassword) {
      alert('Your new password did not persist correctly. Please try again.');
      return;
    }
    if (backendApiBase) {
      // Keep UI responsive; backend sync should be best-effort and non-blocking.
      void pushLocalSnapshotToBackend();
    }
    saveRememberedLogin(currentUser.email, newPassword, shouldRememberLogin);
    // Ensure we land on dashboard without a hard reload that can interrupt agent flow.
    window.history.replaceState({}, '', window.location.pathname);
    applyAccessForUser({ ...persistedUser, mustChangePassword: false });
    saveUiState();
    render();
  });
}

function createDefaultState() {
  return {
    ...defaultState,
    agents: defaultState.agents.map((agent) => ({ ...agent })),
    templates: defaultState.templates.map((template) => ({ ...template })),
    shifts: defaultState.shifts.map((shift) => ({ ...shift })),
    swapRequests: defaultState.swapRequests.map((request) => ({ ...request })),
    availabilityRequests: defaultState.availabilityRequests.map((request) => ({ ...request })),
    blackoutDates: [...defaultState.blackoutDates],
    roleColors: { ...defaultState.roleColors },
    ui: getDefaultUiState()
  };
}

function normalizeRoleLabel(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!normalizedRole) return roleOptions[0];
  const legacyRoleMap = {
    senior: 'In-person',
    mid: 'WFH',
    junior: 'Booth Duty',
    agent: 'WFH'
  };
  if (legacyRoleMap[normalizedRole]) {
    return legacyRoleMap[normalizedRole];
  }
  const matchedRole = roleOptions.find((item) => item.toLowerCase() === normalizedRole);
  return matchedRole || role;
}

function normalizeTeamLabel(team) {
  const normalizedTeam = String(team || '').trim().toLowerCase();
  if (!normalizedTeam) return teamOptions[0];
  const matchedTeam = teamOptions.find((item) => item.toLowerCase() === normalizedTeam);
  return matchedTeam || teamOptions[0];
}

function normalizeMinHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeMaxHours(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseCurrencyAmount(value) {
  const normalized = String(value || '').trim().replace(/[$,\s]/g, '');
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeBlackoutDates(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,]+/);
  const uniqueDates = new Set();
  source.forEach((item) => {
    const normalized = String(item || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return;
    uniqueDates.add(normalized);
  });
  return Array.from(uniqueDates).sort((left, right) => left.localeCompare(right));
}

function isBlackoutDate(dateValue) {
  const normalizedDate = String(dateValue || '').trim().slice(0, 10);
  if (!normalizedDate) return false;
  return normalizeBlackoutDates(state.blackoutDates).includes(normalizedDate);
}

function getBlackoutDateMarker(dateValue) {
  if (!isBlackoutDate(dateValue)) {
    return '';
  }
  return '<div class="chip" style="margin-top:6px; background:#AB5C57; color:#FFF1EF; border:1px solid rgba(255,255,255,0.2);">Blackout date</div>';
}

function getAgentAccountEmail(agentId) {
  const agent = getAgent(agentId);
  const agentEmail = normalizeEmail(agent?.email || '');
  if (agentEmail) {
    return agentEmail;
  }
  return normalizeEmail(getUserByAgentId(agentId)?.email || '');
}

function normalizeTemplates(templates) {
  const defaultTemplates = createDefaultState().templates;
  if (!Array.isArray(templates) || templates.length === 0) {
    return defaultTemplates;
  }

  const legacyTemplateNames = new Set(['Morning Support', 'Evening Support']);
  const incomingNames = templates.map((template) => String(template?.name || '').trim());
  const onlyLegacyTemplates = incomingNames.length > 0 && incomingNames.every((name) => legacyTemplateNames.has(name));

  if (onlyLegacyTemplates) {
    return defaultTemplates;
  }

  const existingNameSet = new Set(incomingNames);
  const missingDefaultTemplates = defaultTemplates
    .filter((template) => !existingNameSet.has(template.name))
    .map((template) => ({ ...template, id: createId() }));

  return [...templates, ...missingDefaultTemplates];
}

function loadState() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      return createDefaultState();
    }
    const parsed = JSON.parse(saved);
    const authUsersForLookup = loadAuthUsers();
    const normalizedAgents = Array.isArray(parsed.agents)
      ? parsed.agents.map((agent) => {
          const minHours = normalizeMinHours(agent.minHours);
          const maxHoursRaw = typeof agent.maxHours === 'undefined' ? 40 : agent.maxHours;
          const maxHours = normalizeMaxHours(maxHoursRaw);
          const linkedUserEmail = normalizeEmail(
            authUsersForLookup.find((user) => user.role === 'agent' && Number(user.agentId) === Number(agent.id))?.email || ''
          );
          return {
            ...agent,
            email: normalizeEmail(agent.email || linkedUserEmail),
            team: normalizeTeamLabel(agent.team),
            role: normalizeRoleLabel(agent.role),
            minHours,
            maxHours: Number.isFinite(maxHours) ? Math.max(maxHours, minHours) : maxHours
          };
        })
      : createDefaultState().agents;
    const roleByAgentId = normalizedAgents.reduce((acc, agent) => {
      acc[String(agent.id)] = agent.role;
      return acc;
    }, {});

    return {
      ...createDefaultState(),
      ...parsed,
      agents: normalizedAgents,
      templates: normalizeTemplates(parsed.templates),
      shifts: Array.isArray(parsed.shifts)
        ? parsed.shifts.map((shift) => {
            const normalizedShift = {
              ...shift,
              location: shiftLocationOptions.includes(String(shift.location || '').trim()) ? shift.location : '',
              role: normalizeRoleLabel(shift.role || roleByAgentId[String(shift.agentId)] || roleOptions[0]),
              status: shift.status === shiftStatuses.draft || shift.status === shiftStatuses.published
                ? shift.status
                : shiftStatuses.published
            };
            delete normalizedShift.title;
            delete normalizedShift.note;
            return normalizedShift;
          })
        : createDefaultState().shifts,
      swapRequests: Array.isArray(parsed.swapRequests)
        ? parsed.swapRequests.map((request) => {
            const isCompleted = request.status === 'completed' || request.status === 'approved';
            const isRejected = request.status === 'rejected';
            return {
              ...request,
              fromApproved: typeof request.fromApproved === 'boolean' ? request.fromApproved : (isCompleted || (!isRejected && request.status === 'pending')),
              toApproved: typeof request.toApproved === 'boolean' ? request.toApproved : isCompleted,
              status: isCompleted ? 'completed' : (isRejected ? 'rejected' : 'pending')
            };
          })
        : createDefaultState().swapRequests,
      availabilityRequests: mergeAvailabilityRequests(
        Array.isArray(parsed.availabilityRequests) ? parsed.availabilityRequests : createDefaultState().availabilityRequests
      ),
      blackoutDates: normalizeBlackoutDates(parsed.blackoutDates),
      roleColors: parsed.roleColors && typeof parsed.roleColors === 'object' ? parsed.roleColors : createDefaultState().roleColors,
      ui: loadUiState(parsed.ui)
    };
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  state.availabilityRequests = getAllAvailabilityRequests();
  memoryAvailabilityInbox = state.availabilityRequests;
  const { ui, ...sharedState } = state;
  const persistableState = {
    ...sharedState,
    availabilityRequests: state.availabilityRequests
  };
  safeSetLocalStorage(storageKey, JSON.stringify(persistableState));
  safeSetLocalStorage(availabilityInboxKey, JSON.stringify(state.availabilityRequests));
  safeSetLocalStorage(availabilityRequestsKey, JSON.stringify(state.availabilityRequests));
  saveUiState();
}

function getFilteredAvailabilityRequests(requests) {
  const fromDate = (state.ui.availabilityFrom || '').trim();
  const toDate = (state.ui.availabilityTo || '').trim();
  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const requestDate = (request.unavailableDate || '').slice(0, 10) || (request.requestedAt || '').slice(0, 10);
    const matchesFrom = !fromDate || (requestDate && requestDate >= fromDate);
    const matchesTo = !toDate || (requestDate && requestDate <= toDate);
    return matchesFrom && matchesTo;
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAgent(id) {
  const normalizedId = Number(id);
  return state.agents.find((agent) => Number(agent.id) === normalizedId);
}

const defaultRoleColorMap = {
  'in-person': '#D0645E',
  wfh: '#608186',
  'booth duty': '#7AACAF',
  'booth duty (form)': '#F4A997',
  'booth duty back-up': '#AB5C57',
  default: '#C49583'
};

function getGeneratedRoleColor(role) {
  const normalizedRole = String(role || '').toLowerCase();
  let hash = 0;
  for (let index = 0; index < normalizedRole.length; index += 1) {
    hash = normalizedRole.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

function getRoleColor(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const savedColor = state.roleColors?.[normalizedRole];
  if (savedColor) return savedColor;
  if (defaultRoleColorMap[normalizedRole]) return defaultRoleColorMap[normalizedRole];
  if (!normalizedRole) return defaultRoleColorMap.default;
  return getGeneratedRoleColor(normalizedRole);
}

function getShiftRoleColor(shift) {
  const role = shift.role || getAgent(shift.agentId)?.role;
  return getRoleColor(role);
}

function getShiftStyle(shift) {
  return `background:${getShiftRoleColor(shift)}; border-left:3px solid rgba(255,255,255,0.65);`;
}

function cloneShift(shift, dayOverride) {
  return {
    ...shift,
    id: createId(),
    day: dayOverride || shift.day,
    status: shiftStatuses.draft
  };
}

function getRoleLegendItems() {
  const normalizedBaseRoles = roleOptions.map((role) => String(role).trim()).filter(Boolean);
  const assignedRoles = state.agents.map((agent) => String(agent.role || '').trim()).filter(Boolean);
  return Array.from(new Set([...normalizedBaseRoles, ...assignedRoles]));
}

function getSwapApprovalText(request) {
  const fromStatus = request.fromApproved ? 'approved' : 'pending';
  const toStatus = request.toApproved ? 'approved' : 'pending';
  return `From: ${fromStatus}, To: ${toStatus}`;
}

function getDurationHours(start, end) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  const diff = endMinutes - startMinutes;
  return Math.max(1, Number((diff / 60).toFixed(1)) || 1);
}

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function getApprovedTimeOffConflicts(agentId, date, start, end) {
  const normalizedAgentId = Number(agentId);
  if (!normalizedAgentId || !date || !start || !end) {
    return [];
  }
  const shiftStart = toMinutes(start);
  const shiftEnd = toMinutes(end);
  if (!Number.isFinite(shiftStart) || !Number.isFinite(shiftEnd) || shiftEnd <= shiftStart) {
    return [];
  }

  return getAllAvailabilityRequests().filter((request) => {
    if (Number(request.agentId) !== normalizedAgentId) return false;
    if (request.status !== 'approved') return false;
    if ((request.unavailableDate || '') !== date) return false;

    const requestStart = request.unavailableStart ? toMinutes(request.unavailableStart) : null;
    const requestEnd = request.unavailableEnd ? toMinutes(request.unavailableEnd) : null;
    if (!Number.isFinite(requestStart) || !Number.isFinite(requestEnd) || requestEnd <= requestStart) {
      return true;
    }

    return shiftStart < requestEnd && requestStart < shiftEnd;
  });
}

function confirmShiftAssignmentWithTimeOffWarning(agentId, date, start, end, options = {}) {
  const activeUser = getCurrentUser();
  if (activeUser?.role !== 'admin') {
    return true;
  }

  const replacingShiftId = Number(options.replacingShiftId) || null;
  const durationHours = Number.isFinite(Number(options.durationHours)) ? Number(options.durationHours) : getDurationHours(start, end);

  const targetAgent = getAgent(agentId);
  const maxHours = normalizeMaxHours(targetAgent?.maxHours);
  if (Number.isFinite(maxHours) && maxHours >= 0) {
    let assignedHours = getAssignedHours(agentId);
    if (replacingShiftId) {
      const existingShift = state.shifts.find((shift) => Number(shift.id) === replacingShiftId);
      if (existingShift && Number(existingShift.agentId) === Number(agentId)) {
        assignedHours -= Number(existingShift.durationHours) || 0;
      }
    }
    const projectedHours = assignedHours + (Number(durationHours) || 0);
    if (projectedHours > maxHours + 0.0001) {
      alert(`${targetAgent?.name || 'This agent'} would be scheduled for ${projectedHours.toFixed(2)} hours, above the max of ${maxHours.toFixed(2)} hours.`);
      return false;
    }
  }

  const approvedTimeOffConflicts = getApprovedTimeOffConflicts(agentId, date, start, end);
  if (approvedTimeOffConflicts.length === 0) {
    return true;
  }

  const firstConflict = approvedTimeOffConflicts[0];
  const conflictWindow = formatTimeRange(firstConflict.unavailableStart || start, firstConflict.unavailableEnd || end);
  return confirm(
    `${getAgent(agentId)?.name || 'This agent'} has approved time off on ${date} (${conflictWindow}).\n\nDo you still want to schedule this shift?`
  );
}

function openShiftEditModal(shift, onSave) {
  const existingOverlay = document.getElementById('shift-edit-modal-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const roleChoices = Array.from(new Set([...(getRoleLegendItems() || []), shift.role || roleOptions[0]])).filter(Boolean);
  const safeStatus = shift.status === shiftStatuses.published ? shiftStatuses.published : shiftStatuses.draft;
  const overlay = document.createElement('div');
  overlay.id = 'shift-edit-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.72); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;';
  overlay.innerHTML = `
    <div style="width:min(720px, 100%); max-height:90vh; overflow:auto; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.18); border-radius:14px; padding:18px; box-shadow:0 24px 64px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 12px;">Edit shift</h2>
      <p class="muted" style="margin:0 0 14px;">Update all shift details in one place.</p>
      <form id="shift-edit-form" class="stack">
        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Agent</span>
            <select name="agentId" required>
              ${state.agents.map((agent) => `<option value="${agent.id}" ${Number(shift.agentId) === Number(agent.id) ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:180px; flex:1;">
            <span>Date</span>
            <input name="date" type="date" value="${escapeHtml(shift.date || '')}" required />
          </label>
        </div>

        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:150px; flex:1;">
            <span>Start</span>
            <input name="start" type="time" value="${escapeHtml(shift.start || '08:00')}" required />
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:150px; flex:1;">
            <span>End</span>
            <input name="end" type="time" value="${escapeHtml(shift.end || '16:00')}" required />
          </label>
        </div>

        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Role</span>
            <select name="role" required>
              ${roleChoices.map((role) => `<option value="${escapeHtml(role)}" ${String(shift.role || '') === String(role) ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Location</span>
            <select name="location">
              <option value="">No location</option>
              ${shiftLocationOptions.map((location) => `<option value="${escapeHtml(location)}" ${String(shift.location || '') === String(location) ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Status</span>
            <select name="status" required>
              <option value="${shiftStatuses.draft}" ${safeStatus === shiftStatuses.draft ? 'selected' : ''}>${shiftStatuses.draft}</option>
              <option value="${shiftStatuses.published}" ${safeStatus === shiftStatuses.published ? 'selected' : ''}>${shiftStatuses.published}</option>
            </select>
          </label>
        </div>

        <div class="row" style="justify-content:flex-end; margin-top:8px;">
          <button type="button" id="shift-edit-cancel" class="secondary">Cancel</button>
          <button type="submit">Save changes</button>
        </div>
      </form>
    </div>
  `;

  const closeModal = () => {
    document.removeEventListener('keydown', onEscape);
    overlay.remove();
  };

  const onEscape = (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  overlay.querySelector('#shift-edit-cancel')?.addEventListener('click', () => {
    closeModal();
  });

  overlay.querySelector('#shift-edit-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextAgentId = Number(formData.get('agentId'));
    if (!Number.isFinite(nextAgentId) || !getAgent(nextAgentId)) {
      alert('Select a valid agent.');
      return;
    }

    const nextDate = String(formData.get('date') || '').trim();
    const nextDay = getDayFromDate(nextDate);
    if (!nextDay) {
      alert('Enter a valid shift date.');
      return;
    }

    const nextStart = String(formData.get('start') || '').trim();
    const nextEnd = String(formData.get('end') || '').trim();
    if (!nextStart || !nextEnd || toMinutes(nextEnd) <= toMinutes(nextStart)) {
      alert('End time must be later than start time.');
      return;
    }

    const nextRole = normalizeRoleLabel(String(formData.get('role') || '').trim() || roleOptions[0]);
    const requestedLocation = String(formData.get('location') || '').trim();
    const nextLocation = requestedLocation && shiftLocationOptions.includes(requestedLocation) ? requestedLocation : '';
    const nextStatus = String(formData.get('status') || '').trim() === shiftStatuses.published ? shiftStatuses.published : shiftStatuses.draft;

    if (!confirmShiftAssignmentWithTimeOffWarning(nextAgentId, nextDate, nextStart, nextEnd, {
      replacingShiftId: Number(shift.id),
      durationHours: getDurationHours(nextStart, nextEnd)
    })) {
      return;
    }

    onSave({
      ...shift,
      agentId: nextAgentId,
      day: nextDay,
      date: nextDate,
      start: nextStart,
      end: nextEnd,
      role: nextRole,
      location: nextLocation,
      status: nextStatus,
      durationHours: getDurationHours(nextStart, nextEnd)
    });
    closeModal();
  });

  document.addEventListener('keydown', onEscape);
  document.body.appendChild(overlay);
}

function getDayFromDate(dateValue) {
  const parsedDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }
  const mondayBasedIndex = (parsedDate.getDay() + 6) % 7;
  return days[mondayBasedIndex] || '';
}

function formatIsoDateLocal(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return '';
  }
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

function getNextDateForWeekdayOnOrAfter(anchorDate, weekdayLabel) {
  const parsedDate = new Date(`${String(anchorDate || '').slice(0, 10)}T00:00:00`);
  const targetIndex = days.indexOf(String(weekdayLabel || ''));
  if (Number.isNaN(parsedDate.getTime()) || targetIndex < 0) {
    return '';
  }
  const currentIndex = (parsedDate.getDay() + 6) % 7;
  const deltaDays = (targetIndex - currentIndex + 7) % 7;
  parsedDate.setDate(parsedDate.getDate() + deltaDays);
  return formatIsoDateLocal(parsedDate);
}

function buildWeeklyRecurringDates(startDate, weekdayLabel, endDate, maxOccurrences = 104) {
  const normalizedStartDate = String(startDate || '').slice(0, 10);
  const normalizedEndDate = String(endDate || '').slice(0, 10);
  if (!normalizedStartDate || !normalizedEndDate || !days.includes(String(weekdayLabel || ''))) {
    return { dates: [], truncated: false };
  }

  const parsedStartDate = new Date(`${normalizedStartDate}T00:00:00`);
  const parsedEndDate = new Date(`${normalizedEndDate}T00:00:00`);
  if (Number.isNaN(parsedStartDate.getTime()) || Number.isNaN(parsedEndDate.getTime()) || parsedEndDate < parsedStartDate) {
    return { dates: [], truncated: false };
  }

  let cursor = getNextDateForWeekdayOnOrAfter(normalizedStartDate, weekdayLabel);
  if (!cursor) {
    return { dates: [], truncated: false };
  }

  const dates = [];
  let truncated = false;
  while (cursor && cursor <= normalizedEndDate) {
    dates.push(cursor);
    if (dates.length >= maxOccurrences) {
      truncated = true;
      break;
    }
    const nextDate = new Date(`${cursor}T00:00:00`);
    nextDate.setDate(nextDate.getDate() + 7);
    cursor = formatIsoDateLocal(nextDate);
  }

  return { dates, truncated };
}

function getAvailabilityRecurrenceLabel(request) {
  if (request?.recurrenceType !== 'weekly') {
    return 'One-time request';
  }
  const recurrenceDay = days.includes(String(request.recurrenceDay || ''))
    ? request.recurrenceDay
    : getDayFromDate(request.unavailableDate || '');
  const recurrenceEndDate = String(request.recurrenceEndDate || '').slice(0, 10);
  if (recurrenceDay && recurrenceEndDate) {
    return `Repeats weekly on ${recurrenceDay} through ${recurrenceEndDate}`;
  }
  if (recurrenceDay) {
    return `Repeats weekly on ${recurrenceDay}`;
  }
  return 'Recurring weekly';
}

function getWeeklySpend() {
  return state.shifts.reduce((sum, shift) => {
    const agent = getAgent(shift.agentId);
    return sum + (agent ? agent.payRate * shift.durationHours : 0);
  }, 0);
}

function getSpendByDay() {
  return days.reduce((acc, day) => {
    const spend = state.shifts.filter((shift) => shift.day === day).reduce((sum, shift) => {
      const agent = getAgent(shift.agentId);
      return sum + (agent ? agent.payRate * shift.durationHours : 0);
    }, 0);
    acc[day] = spend;
    return acc;
  }, {});
}

function getAssignedHours(agentId) {
  const normalizedAgentId = Number(agentId);
  return state.shifts.filter((shift) => Number(shift.agentId) === normalizedAgentId).reduce((sum, shift) => sum + shift.durationHours, 0);
}

function getApprovedPtoHours(agentId) {
  const normalizedAgentId = Number(agentId);
  return getAllAvailabilityRequests()
    .filter((request) => Number(request.agentId) === normalizedAgentId)
    .filter((request) => request.status === 'approved')
    .filter((request) => String(request.unavailabilityType || '').trim() === 'PTO')
    .reduce((sum, request) => sum + getDurationHours(request.unavailableStart, request.unavailableEnd), 0);
}

function getMinimumHoursCredit(agentId) {
  return getAssignedHours(agentId) + getApprovedPtoHours(agentId);
}

function getAvailabilityStats() {
  return {
    available: state.agents.filter((agent) => agent.availability === 'Available').length,
    unavailable: state.agents.filter((agent) => agent.availability === 'Unavailable').length,
    timeOff: state.agents.filter((agent) => agent.timeOff).length,
    pendingRequests: state.swapRequests.filter((request) => request.status === 'pending').length
  };
}

function getFilteredAgents() {
  const search = state.ui.agentSearch.trim().toLowerCase();
  const selectedRole = String(state.ui.agentRoleFilter || 'All');
  return state.agents.filter((agent) => {
    const matchesName = !search || String(agent.name || '').toLowerCase().includes(search);
    const matchesRole = selectedRole === 'All' || String(agent.role || '') === selectedRole;
    return matchesName && matchesRole;
  });
}

function getTeamBadgeStyle(team) {
  const normalizedTeam = normalizeTeamLabel(team);
  if (normalizedTeam === 'Audience Services Representative') {
    return 'background:#7AACAF; color:#17383B; border:1px solid rgba(23,56,59,0.25);';
  }
  if (normalizedTeam === 'Audience Services Associate') {
    return 'background:#F4A997; color:#4A2F2A; border:1px solid rgba(74,47,42,0.2);';
  }
  return 'background:#C49583; color:#2E2422; border:1px solid rgba(46,36,34,0.2);';
}

function getCurrentAgentId() {
  const currentId = Number(state.ui.currentAgentId);
  if (currentId && state.agents.some((agent) => Number(agent.id) === currentId)) {
    return currentId;
  }
  return Number(state.agents[0]?.id) || null;
}

function getViewAgent() {
  const currentId = getCurrentAgentId();
  return state.agents.find((agent) => Number(agent.id) === currentId) || null;
}

function isPublishedShift(shift) {
  return String(shift?.status || shiftStatuses.draft) === shiftStatuses.published;
}

function getShiftById(shiftId) {
  return state.shifts.find((shift) => Number(shift.id) === Number(shiftId)) || null;
}

function isSwapRequestVisibleToAgent(request, agentId) {
  const isParticipant = Number(request?.fromAgentId) === Number(agentId) || Number(request?.toAgentId) === Number(agentId);
  if (!isParticipant) return false;
  const linkedShift = getShiftById(request?.shiftId);
  return isPublishedShift(linkedShift);
}

function getAgentViewShifts(options = {}) {
  const currentId = getCurrentAgentId();
  const publishedOnly = options.publishedOnly !== false;
  return state.shifts.filter((shift) => {
    if (Number(shift.agentId) !== currentId) return false;
    if (!publishedOnly) return true;
    return isPublishedShift(shift);
  });
}

function getFilteredCalendarShifts() {
  const filters = state.ui.calendar || {};
  const search = (filters.search || '').trim().toLowerCase();
  const agentName = (filters.agentName || '').trim().toLowerCase();
  const selectedDate = (filters.date || '').trim();
  return state.shifts.filter((shift) => {
    const matchesDay = filters.day === 'All' || shift.day === filters.day;
    const matchesAgent = filters.agentId === 'All' || String(shift.agentId) === String(filters.agentId);
    const matchesRole = filters.role === 'All' || String(shift.role || '') === String(filters.role);
    const matchesAgentName = !agentName || (getAgent(shift.agentId)?.name || '').toLowerCase().includes(agentName);
    const matchesDate = !selectedDate || (shift.date || '') === selectedDate;
    const matchesLocation = filters.location === 'All' || shift.location === filters.location;
    if (!matchesDay || !matchesAgent || !matchesRole || !matchesAgentName || !matchesDate || !matchesLocation) return false;
    if (!search) return true;
    const agent = getAgent(shift.agentId);
    return [shift.role, shift.day, shift.location, shift.start, shift.end, agent?.name].join(' ').toLowerCase().includes(search);
  });
}

function formatTime12Hour(timeValue) {
  const [hoursPart, minutesPart] = String(timeValue || '').split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return '--:--';
  }
  const safeMinutes = String(Math.max(0, Math.min(59, minutes))).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const normalizedHours = hours % 12 || 12;
  return `${normalizedHours}:${safeMinutes} ${period}`;
}

function formatTimeRange(startTime, endTime) {
  return `${formatTime12Hour(startTime)} - ${formatTime12Hour(endTime)}`;
}

function getShiftSummary(shift, includeDay = true) {
  if (!shift) return 'Shift';
  const segments = [];
  if (includeDay && shift.day) {
    segments.push(shift.day);
  }
  segments.push(shift.role || roleOptions[0]);
  segments.push(formatTimeRange(shift.start, shift.end));
  segments.push(shift.location || 'No location');
  return segments.join(' | ');
}

function getAllLocations() {
  return Array.from(new Set(state.shifts.map((shift) => shift.location).filter(Boolean))).sort();
}

function getCalendarWeekDates(referenceDateValue) {
  const referenceDate = referenceDateValue ? new Date(`${referenceDateValue}T00:00:00`) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    return getCalendarWeekDates('');
  }

  const mondayBasedIndex = (referenceDate.getDay() + 6) % 7;
  const monday = new Date(referenceDate);
  monday.setDate(referenceDate.getDate() - mondayBasedIndex);

  return days.reduce((acc, day, index) => {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + index);
    acc[day] = {
      iso: dayDate.toISOString().slice(0, 10),
      label: dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    };
    return acc;
  }, {});
}

function getCalendarWeekLabel(weekDates) {
  const orderedDates = days
    .map((day) => weekDates?.[day]?.iso)
    .filter(Boolean);
  if (orderedDates.length === 0) return 'Current week';
  const firstDate = new Date(`${orderedDates[0]}T00:00:00`);
  const lastDate = new Date(`${orderedDates[orderedDates.length - 1]}T00:00:00`);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) {
    return 'Current week';
  }
  return `${firstDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${lastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function shiftIsInWeek(shift, weekDates) {
  const shiftDate = String(shift?.date || '').slice(0, 10);
  if (!shiftDate) return false;
  return days.some((day) => weekDates?.[day]?.iso === shiftDate);
}

function getShiftedWeekReference(referenceDateValue, dayOffset) {
  const baseDate = referenceDateValue ? new Date(`${referenceDateValue}T00:00:00`) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return '';
  }
  baseDate.setDate(baseDate.getDate() + dayOffset);
  return baseDate.toISOString().slice(0, 10);
}

function getActiveCalendarWeekReference() {
  return state.ui.calendar?.weekReference || state.ui.calendar?.date || new Date().toISOString().slice(0, 10);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scheduler-export.json';
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      Object.assign(state, parsed);
      state.roleColors = parsed.roleColors && typeof parsed.roleColors === 'object' ? parsed.roleColors : {};
      state.ui = loadUiState(parsed.ui);
      saveState();
      saveUiState();
      render();
    } catch {
      alert('The selected file is not a valid scheduler export.');
    }
  };
  reader.readAsText(file);
}

function renderCalendarPage(currentUser) {
  const spendByDay = getSpendByDay();
  const calendarFilters = state.ui.calendar || {};
  const weekReference = calendarFilters.weekReference || calendarFilters.date || new Date().toISOString().slice(0, 10);
  const weekDates = getCalendarWeekDates(weekReference);
  const weekLabel = getCalendarWeekLabel(weekDates);
  const locations = getAllLocations();
  const roleItems = getRoleLegendItems();
  const agentNameItems = state.agents.map((agent) => String(agent.name || '').trim()).filter(Boolean).sort((left, right) => left.localeCompare(right));
  const isAgentView = currentUser.role === 'agent';
  const viewAgent = getViewAgent();
  const baseCalendarShifts = getFilteredCalendarShifts();
  const scopedCalendarShifts = baseCalendarShifts.filter((shift) => shiftIsInWeek(shift, weekDates));
  const visibleCalendarShifts = isAgentView
    ? scopedCalendarShifts.filter((shift) => shift.agentId === viewAgent?.id && isPublishedShift(shift))
    : scopedCalendarShifts;
  const agentViewShifts = getAgentViewShifts();
  const visibleShiftIdSet = new Set(visibleCalendarShifts.map((shift) => Number(shift.id)));
  selectedCalendarShiftIds = new Set(Array.from(selectedCalendarShiftIds).filter((id) => visibleShiftIdSet.has(Number(id))));
  const selectedShiftCount = selectedCalendarShiftIds.size;

  root.innerHTML = `
    <div class="app calendar-view">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>${isAgentView ? 'My calendar' : 'Calendar view'}</h1>
          <p class="muted">${isAgentView ? 'Review your assigned shifts and request swaps.' : 'Filter shifts by day, agent, or location in a dedicated planning page.'}</p>
        </div>
        <div class="row">
          ${isAgentView ? '<a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a><a href="index.html?view=pending-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Pending requests</button></a><a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open my calendar</button></a><a href="index.html?view=agent-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Approved requests</button></a><a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">My profile</button></a>' : '<a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>'}
          ${!isAgentView ? '<a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open Calendar</button></a>' : ''}
          ${!isAgentView ? '<a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a>' : ''}
          ${!isAgentView ? '<a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a>' : ''}
          ${!isAgentView ? '<a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a>' : ''}
          ${!isAgentView ? '<a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>' : ''}
          ${!isAgentView ? '<button id="export-data-btn" class="secondary">Export JSON</button>' : ''}
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <div class="row" style="flex-wrap:wrap;">
          <input id="calendar-search" placeholder="Search shifts" value="${escapeHtml(calendarFilters.search)}" />
          <select id="calendar-agent-name-filter">
            <option value="" ${!calendarFilters.agentName ? 'selected' : ''}>All agent names</option>
            ${agentNameItems.map((name) => `<option value="${escapeHtml(name)}" ${String(calendarFilters.agentName || '') === String(name) ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
          <input id="calendar-date-filter" type="date" value="${escapeHtml(calendarFilters.date)}" />
          <select id="calendar-day-filter">
            <option value="All" ${calendarFilters.day === 'All' ? 'selected' : ''}>All days</option>
            ${days.map((day) => `<option value="${day}" ${calendarFilters.day === day ? 'selected' : ''}>${day}</option>`).join('')}
          </select>
          <select id="calendar-agent-filter">
            <option value="All" ${calendarFilters.agentId === 'All' ? 'selected' : ''}>All agents</option>
            ${state.agents.map((agent) => `<option value="${agent.id}" ${String(calendarFilters.agentId) === String(agent.id) ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`).join('')}
          </select>
          <select id="calendar-role-filter">
            <option value="All" ${calendarFilters.role === 'All' ? 'selected' : ''}>All roles</option>
            ${roleItems.map((role) => `<option value="${escapeHtml(role)}" ${String(calendarFilters.role || 'All') === String(role) ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('')}
          </select>
          <select id="calendar-location-filter">
            <option value="All" ${calendarFilters.location === 'All' ? 'selected' : ''}>All locations</option>
            ${locations.map((location) => `<option value="${location}" ${calendarFilters.location === location ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('')}
          </select>
          <button id="calendar-filters-apply" type="button">Apply filters</button>
          <button id="calendar-filters-reset" class="secondary" type="button">Reset filters</button>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <div class="row" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong>Week of ${escapeHtml(weekLabel)}</strong>
            <div class="muted">Use these controls to move between weeks without changing your date filter.</div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            <button id="calendar-previous-week" class="secondary" type="button">Previous week</button>
            <button id="calendar-current-week" class="secondary" type="button">Current week</button>
            <button id="calendar-next-week" class="secondary" type="button">Next week</button>
            <input id="calendar-week-reference" type="date" value="${escapeHtml(weekReference)}" />
          </div>
        </div>
      </div>

      ${!isAgentView ? `
        <div class="panel" style="margin-bottom:16px;">
          <h3>Create shift</h3>
          <form id="add-shift-form" class="stack">
            <div class="row">
              <select name="agentId" required>
                <option value="">Assign agent</option>
                ${state.agents.map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('')}
              </select>
              <select name="role" required>
                ${getRoleLegendItems().map((role) => `<option value="${role}">${escapeHtml(role)}</option>`).join('')}
              </select>
            </div>
            <div class="row">
              <input name="start" type="time" value="08:00" required />
              <input name="end" type="time" value="16:00" required />
              <select name="location">
                <option value="">No location</option>
                ${shiftLocationOptions.map((location) => `<option value="${location}">${escapeHtml(location)}</option>`).join('')}
              </select>
              <input name="date" type="date" required />
            </div>
            <button type="submit">Add shift</button>
          </form>
        </div>` : ''}

      ${isAgentView ? `
        <div class="panel" style="margin-bottom:16px;">
          <h3>Swap a shift</h3>
          <form id="swap-form" class="row" style="flex-wrap:wrap;">
            <input type="hidden" name="fromAgentId" value="${viewAgent?.id || ''}" />
            <select name="shiftId" required>
              <option value="">Select a shift</option>
              ${agentViewShifts.map((shift) => `<option value="${shift.id}">${escapeHtml(getShiftSummary(shift))}</option>`).join('')}
            </select>
            <select name="toAgentId" required>
              <option value="">Swap with</option>
              ${state.agents.filter((agent) => agent.id !== viewAgent?.id).map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('')}
            </select>
            <button type="submit">Request swap</button>
          </form>
        </div>` : ''}

      <div class="panel">
        ${!isAgentView ? `<div class="muted" style="margin-bottom:10px;">${copiedShiftTemplate ? `Copied: ${escapeHtml(getShiftSummary(copiedShiftTemplate))}` : 'Copy a shift, then use Paste here on any day.'}</div>` : ''}
        <div class="row" style="margin-bottom:10px;">
          ${getRoleLegendItems().map((role) => `
            <span class="chip" style="background:${getRoleColor(role)}; border:1px solid rgba(255,255,255,0.25);">${escapeHtml(role)}</span>
          `).join('')}
        </div>
        ${!isAgentView ? `<div class="row" style="margin-bottom:10px; justify-content:space-between; align-items:center;"><div class="muted">Selected shifts: ${selectedShiftCount}</div><div class="row"><button type="button" class="secondary" data-select-visible-shifts>Select all visible</button><button type="button" class="secondary" data-clear-selected-shifts ${selectedShiftCount === 0 ? 'disabled' : ''}>Clear</button><button type="button" class="success" data-publish-selected-shifts ${selectedShiftCount === 0 ? 'disabled' : ''}>Publish selected</button><button type="button" class="danger" data-remove-selected-shifts ${selectedShiftCount === 0 ? 'disabled' : ''}>Remove selected</button></div></div>` : ''}
        <div class="day-row">
          ${days.map((day) => `
            <div class="day-card" data-day="${day}" data-date="${escapeHtml(weekDates[day]?.iso || '')}">
              <div class="row" style="justify-content:space-between; margin-bottom:6px;">
                <div>
                  <h4 style="margin:0;">${day}</h4>
                  <div class="muted">${escapeHtml(weekDates[day]?.label || '')}</div>
                  ${getBlackoutDateMarker(weekDates[day]?.iso || '')}
                </div>
                ${!isAgentView ? `<button class="secondary" type="button" data-paste-shift-day="${day}" ${copiedShiftTemplate ? '' : 'disabled'}>Paste here</button>` : ''}
              </div>
              ${visibleCalendarShifts.filter((shift) => shift.day === day).map((shift) => `
                <div class="shift ${!isAgentView && selectedCalendarShiftIds.has(Number(shift.id)) ? 'selected' : ''}" draggable="true" data-shift-id="${shift.id}" style="${getShiftStyle(shift)}">
                  <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${escapeHtml(shift.role || roleOptions[0])}<br />${escapeHtml(shift.location || 'No location')}<br />${formatTimeRange(shift.start, shift.end)}
                  ${!isAgentView ? `<div class="muted" style="margin-top:6px; text-transform:capitalize;">${escapeHtml(shift.status || shiftStatuses.draft)}</div><div class="row" style="margin-top:6px;"><button type="button" class="secondary" data-toggle-shift-select="${shift.id}">${selectedCalendarShiftIds.has(Number(shift.id)) ? 'Selected' : 'Select'}</button><button type="button" class="secondary" data-edit-shift="${shift.id}">Edit</button><button type="button" class="secondary" data-copy-shift="${shift.id}">Copy</button><button type="button" class="secondary" data-duplicate-shift="${shift.id}">Duplicate</button>${shift.status !== shiftStatuses.published ? `<button type="button" class="success" data-publish-shift="${shift.id}">Publish</button>` : ''}<button type="button" class="danger" data-remove-shift="${shift.id}">Remove</button></div>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderProfilePage(currentUser) {
  const isAgentView = currentUser.role === 'agent';
  if (!isAgentView) {
    const adminUsers = authUsers
      .filter((user) => user.role === 'admin')
      .sort((left, right) => String(left.name || left.username || '').localeCompare(String(right.name || right.username || ''), undefined, { sensitivity: 'base' }));

    root.innerHTML = `
      <div class="app">
        <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
          <div>
            <h1>Admin profile</h1>
            <p class="muted">Review your admin account details.</p>
          </div>
          <div class="row">
            <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
            <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open Calendar</button></a>
            <a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a>
            <a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a>
            <a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a>
            <a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>
            <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
            <button id="logout-btn" class="secondary" type="button">Log out</button>
          </div>
        </div>

        ${adminProfileNotice ? `
          <div class="card" style="margin-bottom:12px; border-color:${adminProfileNotice.type === 'success' ? '#7AACAF' : '#AB5C57'};">
            <div>${escapeHtml(adminProfileNotice.text || '')}</div>
          </div>` : ''}

        <div class="grid" style="margin-top:16px; grid-template-columns:1fr;">
          <div class="stack">
            <div class="panel">
              <div class="card" style="margin-bottom:10px;">
                <div><strong>Name:</strong> ${escapeHtml(currentUser?.name || currentUser?.username || 'Not set')}</div>
                <div><strong>Job title:</strong> ${escapeHtml(currentUser?.jobTitle || 'Scheduling Administrator')}</div>
                <div><strong>Email:</strong> ${escapeHtml(currentUser?.email || 'Not set')}</div>
                <div><strong>Phone:</strong> ${escapeHtml(currentUser?.phone || 'Not set')}</div>
              </div>
            </div>

            <div class="panel">
              <h2>Edit profile</h2>
              <form id="admin-update-profile-form" class="stack" style="margin-top:10px;">
                <input name="name" placeholder="Name" value="${escapeHtml(currentUser?.name || currentUser?.username || '')}" required />
                <input name="jobTitle" placeholder="Job title" value="${escapeHtml(currentUser?.jobTitle || 'Scheduling Administrator')}" required />
                <input name="email" type="email" placeholder="Email" value="${escapeHtml(currentUser?.email || '')}" required autocomplete="email" />
                <input name="phone" type="tel" placeholder="Phone" value="${escapeHtml(currentUser?.phone || '')}" required autocomplete="tel" />
                <button type="submit">Save profile</button>
              </form>
            </div>

            <div class="panel">
              <h2>Managers</h2>
              <p class="muted">Add additional manager accounts so multiple admins can access the site.</p>
              ${adminManagerNotice ? `
                <div class="card" style="margin-bottom:12px; border-color:${adminManagerNotice.type === 'success' ? '#7AACAF' : '#AB5C57'};">
                  <div>${escapeHtml(adminManagerNotice.text || '')}</div>
                  ${adminManagerNotice.resetLink ? `<div style="margin-top:8px;"><a href="${escapeHtml(adminManagerNotice.resetLink)}" style="color:#17383B;">Open reset link</a></div>` : ''}
                </div>` : ''}
              <form id="add-admin-form" class="stack" style="margin-top:10px;">
                <input name="name" placeholder="Manager name" required />
                <input name="jobTitle" placeholder="Job title" value="Scheduling Manager" required />
                <input name="email" type="email" placeholder="Email" required autocomplete="email" />
                <input name="phone" type="tel" placeholder="Phone" required autocomplete="tel" />
                <button type="submit">Add manager</button>
              </form>
              <div class="request-list" style="margin-top:12px;">
                ${adminUsers.map((adminUser) => `
                  <div class="card">
                    <form class="stack" data-update-admin-form="${adminUser.id}">
                      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                        <strong>${escapeHtml(adminUser.name || adminUser.username || 'Manager')}</strong>
                        <div class="muted">Status: ${escapeHtml(adminUser.isActive === false ? 'Inactive' : 'Active')}</div>
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap;">
                        <input name="name" value="${escapeHtml(adminUser.name || '')}" placeholder="Manager name" required />
                        <input name="jobTitle" value="${escapeHtml(adminUser.jobTitle || 'Scheduling Manager')}" placeholder="Job title" required />
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap;">
                        <input name="email" type="email" value="${escapeHtml(adminUser.email || '')}" placeholder="Email" required autocomplete="email" />
                        <input name="phone" type="tel" value="${escapeHtml(adminUser.phone || '')}" placeholder="Phone" required autocomplete="tel" />
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                        <button type="submit" class="secondary">Save manager</button>
                        <button type="button" class="secondary" data-resend-admin-invite="${adminUser.id}">Resend invite</button>
                        <button type="button" class="secondary" data-toggle-admin-active="${adminUser.id}">${adminUser.isActive === false ? 'Reactivate' : 'Deactivate'}</button>
                        <button type="button" class="danger" data-remove-admin="${adminUser.id}">Remove</button>
                      </div>
                    </form>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="panel">
              <h2>Reset password</h2>
              <form id="admin-reset-password-form" class="stack" style="margin-top:10px;">
                <input name="currentPassword" type="password" placeholder="Current password" required autocomplete="current-password" />
                <input name="newPassword" type="password" placeholder="New password" required autocomplete="new-password" />
                <input name="confirmPassword" type="password" placeholder="Confirm new password" required autocomplete="new-password" />
                <button type="submit">Update password</button>
              </form>
            </div>

            <div class="panel">
              <h2>Email delivery</h2>
              <p class="muted">Configure provider mode and webhook endpoint for real email delivery. Without this, notifications stay local in Email outbox.</p>
              <form id="admin-email-delivery-form" class="stack" style="margin-top:10px;">
                <label class="row" style="align-items:center; justify-content:flex-start; gap:8px;">
                  <input name="enabled" type="checkbox" ${emailDeliverySettings.enabled ? 'checked' : ''} />
                  <span>Enable webhook delivery</span>
                </label>
                <select name="provider">
                  <option value="generic" ${emailDeliverySettings.provider === 'generic' ? 'selected' : ''}>Generic webhook JSON</option>
                  <option value="sendgrid" ${emailDeliverySettings.provider === 'sendgrid' ? 'selected' : ''}>SendGrid API payload</option>
                  <option value="mailgun" ${emailDeliverySettings.provider === 'mailgun' ? 'selected' : ''}>Mailgun API payload</option>
                </select>
                <input name="webhookUrl" type="url" placeholder="Webhook URL (https://...)" value="${escapeHtml(emailDeliverySettings.webhookUrl || '')}" />
                <input name="authToken" type="password" placeholder="Auth token (supports Bearer/BASIC prefix)" value="${escapeHtml(emailDeliverySettings.authToken || '')}" autocomplete="off" />
                <input name="fromEmail" type="email" placeholder="From email" value="${escapeHtml(emailDeliverySettings.fromEmail || '')}" />
                <input name="fromName" value="${escapeHtml(fixedEmailSenderName)}" readonly />
                <div class="muted">Sender name is fixed to ${escapeHtml(fixedEmailSenderName)} for all outgoing emails.</div>
                <div class="row">
                  <button type="submit">Save email settings</button>
                  <button type="button" id="send-test-email" class="secondary">Send test email</button>
                  <button type="button" id="retry-undelivered-email" class="secondary">Retry undelivered emails</button>
                </div>
              </form>
            </div>

            <div class="panel">
              <h2>Backend sync</h2>
              <p class="muted">Use a shared API URL so admin and agent data stays synchronized across devices.</p>
              <form id="admin-backend-sync-form" class="stack" style="margin-top:10px;">
                <input name="backendApiUrl" type="url" placeholder="https://your-backend.example.com/api" value="${escapeHtml(backendApiBase || '')}" />
                <div class="row">
                  <button type="submit">Save backend URL</button>
                  <button type="button" id="clear-backend-url" class="secondary">Use local fallback</button>
                </div>
                <div class="muted">Current backend: ${escapeHtml(backendApiBase || 'Not configured (local browser storage only)')}</div>
              </form>
            </div>

            <div class="panel">
              <h2>Blackout dates</h2>
              <p class="muted">Agents cannot submit time-off requests for these dates. Enter one date per line.</p>
              <form id="admin-blackout-dates-form" class="stack" style="margin-top:10px;">
                <textarea name="blackoutDates" rows="6" placeholder="2026-12-24&#10;2026-12-25">${escapeHtml(normalizeBlackoutDates(state.blackoutDates).join('\n'))}</textarea>
                <button type="submit">Save blackout dates</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('admin-update-profile-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const activeUser = getCurrentUser();
      if (!activeUser) return;

      const formData = new FormData(event.currentTarget);
      const name = formData.get('name')?.toString().trim() || '';
      const jobTitle = formData.get('jobTitle')?.toString().trim() || '';
      const email = normalizeEmail(formData.get('email'));
      const phone = normalizePhone(formData.get('phone'));

      if (!name || !jobTitle || !email || !phone) {
        alert('All profile fields are required.');
        return;
      }

      const emailInUse = authUsers.some((user) => user.id !== activeUser.id && normalizeEmail(user.email) === email);
      if (emailInUse) {
        alert('That email address is already in use by another account.');
        return;
      }

      authUsers = authUsers.map((user) => user.id === activeUser.id
        ? {
            ...user,
            name,
            jobTitle,
            email,
            phone
          }
        : user);
      saveAuthUsers();
      adminProfileNotice = {
        type: 'success',
        text: 'Admin profile updated successfully.'
      };
      render();
    });

    document.getElementById('add-admin-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const name = formData.get('name')?.toString().trim() || '';
      const jobTitle = formData.get('jobTitle')?.toString().trim() || '';
      const email = normalizeEmail(formData.get('email'));
      const phone = normalizePhone(formData.get('phone'));

      if (!name || !jobTitle || !email || !phone) {
        alert('All manager fields are required.');
        return;
      }

      const emailInUse = authUsers.some((user) => normalizeEmail(user.email) === email);
      if (emailInUse) {
        alert('That email address is already in use by another account.');
        return;
      }

      const nextAdminUser = withRequiredEmail({
        id: createId(),
        username: createUniqueAccountUsername(email, 'manager'),
        name,
        jobTitle,
        email,
        phone,
        password: createTemporaryPassword(),
        role: 'admin'
      });
      authUsers.push(nextAdminUser);
      saveAuthUsers();
      const inviteResult = sendAdminInviteEmail(nextAdminUser);
      const outboxCount = loadEmailOutbox().length;
      if (inviteResult?.deliveryStatus === 'local-only') {
        adminManagerNotice = {
          type: 'success',
          text: 'Manager added. Invite was queued in Email outbox (local-only) because webhook delivery is not enabled. Configure Admin Profile > Email delivery to send real emails.',
          resetLink: inviteResult.resetLink
        };
      } else {
        adminManagerNotice = {
          type: 'success',
          text: `Manager added. Invite email queued for delivery. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.`,
          resetLink: ''
        };
      }
      render();
    });

    document.querySelectorAll('[data-update-admin-form]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const adminId = Number(form.getAttribute('data-update-admin-form'));
        const adminUser = authUsers.find((user) => user.role === 'admin' && Number(user.id) === adminId);
        if (!adminUser) return;

        const formData = new FormData(form);
        const name = formData.get('name')?.toString().trim() || '';
        const jobTitle = formData.get('jobTitle')?.toString().trim() || '';
        const email = normalizeEmail(formData.get('email'));
        const phone = normalizePhone(formData.get('phone'));

        if (!name || !jobTitle || !email || !phone) {
          alert('All manager fields are required.');
          return;
        }

        const emailInUse = authUsers.some((user) => user.id !== adminId && normalizeEmail(user.email) === email);
        if (emailInUse) {
          alert('That email address is already in use by another account.');
          return;
        }

        authUsers = authUsers.map((user) => user.id === adminId
          ? {
              ...user,
              name,
              jobTitle,
              email,
              phone
            }
          : user);
        saveAuthUsers();
        adminManagerNotice = {
          type: 'success',
          text: 'Manager details updated successfully.',
          resetLink: ''
        };
        render();
      });
    });

    document.getElementById('admin-reset-password-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const activeUser = getCurrentUser();
      if (!activeUser) return;

      const formData = new FormData(event.currentTarget);
      const currentPassword = formData.get('currentPassword')?.toString() || '';
      const newPassword = formData.get('newPassword')?.toString() || '';
      const confirmPassword = formData.get('confirmPassword')?.toString() || '';

      if (currentPassword !== activeUser.password) {
        alert('Current password is incorrect.');
        return;
      }
      if (newPassword.length < 8) {
        alert('New password must be at least 8 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        alert('New password and confirmation do not match.');
        return;
      }

      authUsers = authUsers.map((user) => user.id === activeUser.id ? { ...user, password: newPassword } : user);
      saveAuthUsers();
      alert('Admin password updated successfully.');
      render();
    });

    document.getElementById('admin-email-delivery-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const enabled = formData.get('enabled') === 'on';
      const provider = String(formData.get('provider') || 'generic').toLowerCase();
      const webhookUrl = normalizeWebhookUrl(formData.get('webhookUrl'));
      const authToken = formData.get('authToken')?.toString() || '';
      const fromEmail = normalizeEmail(formData.get('fromEmail'));

      if (enabled && !webhookUrl) {
        alert('Webhook URL is required when delivery is enabled.');
        return;
      }
      if (enabled && !fromEmail) {
        alert('From email is required when delivery is enabled.');
        return;
      }
      if (enabled && (provider === 'sendgrid' || provider === 'mailgun') && !authToken.trim()) {
        alert('Auth token is recommended for SendGrid and Mailgun modes.');
        return;
      }

      saveEmailDeliverySettings({
        enabled,
        provider,
        webhookUrl,
        authToken,
        fromEmail,
        fromName: fixedEmailSenderName
      });
      const retryResult = retryUndeliveredOutboxEmails();
      if (retryResult.skipped) {
        alert('Email delivery settings saved. Delivery is still disabled or missing a webhook URL, so queued emails remain local-only.');
      } else if (retryResult.attempted > 0) {
        alert(`Email delivery settings saved. Retrying ${retryResult.attempted} undelivered email${retryResult.attempted === 1 ? '' : 's'}. Check Email outbox for results.`);
      } else {
        alert('Email delivery settings saved. There were no undelivered emails to retry.');
      }
      render();
    });

    document.getElementById('send-test-email')?.addEventListener('click', () => {
      const settings = loadEmailDeliverySettings();
      if (!settings.enabled || !settings.webhookUrl) {
        alert('Webhook delivery is not enabled. Save Email delivery settings with a valid webhook URL first.');
        return;
      }
      const activeUser = getCurrentUser();
      if (!activeUser?.email) {
        alert('No admin email is set for this account.');
        return;
      }
      sendEmailNotification({
        to: activeUser.email,
        subject: 'Test email from Agent Scheduler',
        body: `Test email sent at ${new Date().toLocaleString()}.`,
        type: 'test-email'
      });
      alert('Test email queued. Check Email outbox for delivery status.');
    });

    document.getElementById('retry-undelivered-email')?.addEventListener('click', () => {
      const retryResult = retryUndeliveredOutboxEmails();
      if (retryResult.skipped) {
        alert('Webhook delivery is not enabled. Save Email delivery settings with a valid webhook URL first.');
        return;
      }
      if (retryResult.attempted === 0) {
        alert('No undelivered emails were found to retry.');
        return;
      }
      alert(`Retry started for ${retryResult.attempted} undelivered email${retryResult.attempted === 1 ? '' : 's'}. Check Email outbox for updated status.`);
      render();
    });

    document.querySelectorAll('[data-resend-admin-invite]').forEach((button) => {
      button.addEventListener('click', () => {
        const adminId = Number(button.getAttribute('data-resend-admin-invite'));
        const adminUser = authUsers.find((user) => user.role === 'admin' && Number(user.id) === adminId);
        if (!adminUser?.email) {
          alert('This manager needs a valid email before sending an invite.');
          return;
        }
        const inviteResult = sendAdminInviteEmail(adminUser);
        const outboxCount = loadEmailOutbox().length;
        if (inviteResult?.deliveryStatus === 'local-only') {
          adminManagerNotice = {
            type: 'success',
            text: 'Invite was queued in Email outbox (local-only) because webhook delivery is not enabled. Configure Admin Profile > Email delivery to send real emails.',
            resetLink: inviteResult.resetLink
          };
        } else {
          adminManagerNotice = {
            type: 'success',
            text: `Manager invite email queued for delivery. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.`,
            resetLink: ''
          };
        }
        render();
      });
    });

    document.querySelectorAll('[data-toggle-admin-active]').forEach((button) => {
      button.addEventListener('click', () => {
        const adminId = Number(button.getAttribute('data-toggle-admin-active'));
        const activeUser = getCurrentUser();
        const adminUser = authUsers.find((user) => user.role === 'admin' && Number(user.id) === adminId);
        if (!adminUser) return;
        const isDeactivating = adminUser.isActive !== false;
        if (isDeactivating && getActiveAdminCount() <= 1) {
          alert('You cannot deactivate the last active admin account.');
          return;
        }
        const actionLabel = isDeactivating ? 'deactivate' : 'reactivate';
        const shouldProceed = confirm(`Are you sure you want to ${actionLabel} ${adminUser.name || adminUser.username || 'this manager'}?`);
        if (!shouldProceed) return;
        authUsers = authUsers.map((user) => user.id === adminId
          ? { ...user, isActive: !isDeactivating }
          : user);
        saveAuthUsers();
        if (activeUser?.id === adminId && isDeactivating) {
          clearSession();
          alert('Your manager account was deactivated.');
          render();
          return;
        }
        adminManagerNotice = {
          type: 'success',
          text: `Manager account ${isDeactivating ? 'deactivated' : 'reactivated'}.`,
          resetLink: ''
        };
        render();
      });
    });

    document.querySelectorAll('[data-remove-admin]').forEach((button) => {
      button.addEventListener('click', () => {
        const adminId = Number(button.getAttribute('data-remove-admin'));
        const activeUser = getCurrentUser();
        const adminUser = authUsers.find((user) => user.role === 'admin' && Number(user.id) === adminId);
        if (!adminUser) return;
        if (activeUser?.id === adminId) {
          alert('You cannot remove the manager account you are currently signed in with.');
          return;
        }
        const activeAdminCount = getActiveAdminCount();
        if (adminUser.isActive !== false && activeAdminCount <= 1) {
          alert('You cannot remove the last active admin account.');
          return;
        }
        const shouldRemove = confirm(`Remove manager ${adminUser.name || adminUser.username || 'this account'}?`);
        if (!shouldRemove) return;
        authUsers = authUsers.filter((user) => Number(user.id) !== adminId);
        saveAuthUsers();
        adminManagerNotice = {
          type: 'success',
          text: 'Manager account removed.',
          resetLink: ''
        };
        render();
      });
    });

    document.getElementById('admin-backend-sync-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const backendApiUrl = normalizeBackendUrl(formData.get('backendApiUrl'));
      if (!backendApiUrl) {
        alert('Enter a valid backend URL that ends with /api.');
        return;
      }
      safeSetLocalStorage(backendUrlKey, backendApiUrl);
      alert('Backend URL saved. The app will reload and sync to shared data.');
      window.location.reload();
    });

    document.getElementById('clear-backend-url')?.addEventListener('click', () => {
      localStorage.removeItem(backendUrlKey);
      alert('Backend URL cleared. The app will reload with local browser storage mode.');
      window.location.reload();
    });

    document.getElementById('admin-blackout-dates-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      state.blackoutDates = normalizeBlackoutDates(formData.get('blackoutDates'));
      saveState();
      adminProfileNotice = {
        type: 'success',
        text: 'Blackout dates saved. Agents cannot submit time-off requests for those dates.'
      };
      render();
    });

    document.getElementById('logout-btn')?.addEventListener('click', () => {
      clearSession();
      render();
    });
    return;
  }

  const viewAgent = getViewAgent();
  let activeAgentUser = currentUser;
  if (!String(activeAgentUser?.calendarFeedToken || '').trim()) {
    const nextCalendarFeedToken = createCalendarFeedToken();
    authUsers = authUsers.map((user) => user.id === activeAgentUser.id
      ? { ...user, calendarFeedToken: nextCalendarFeedToken }
      : user);
    saveAuthUsers();
    activeAgentUser = getCurrentUser() || { ...activeAgentUser, calendarFeedToken: nextCalendarFeedToken };
  }
  const calendarSyncUrl = getAgentCalendarFeedUrl(activeAgentUser.calendarFeedToken);

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>My profile</h1>
          <p class="muted">Review your account details. Only your phone number can be updated here; all other changes must be made by an admin.</p>
        </div>
        <div class="row">
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to scheduling</button></a>
          <a href="index.html?view=pending-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Pending requests</button></a>
          <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open my calendar</button></a>
          <a href="index.html?view=agent-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Approved requests</button></a>
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="grid" style="margin-top:16px; grid-template-columns:1fr;">
        <div class="stack">
          <div class="panel">
            <div class="card" style="margin-bottom:10px;">
              <div><strong>Name:</strong> ${escapeHtml(viewAgent?.name || 'Not set')}</div>
              <div><strong>Team:</strong> ${escapeHtml(viewAgent?.team || 'Not set')}</div>
              <div><strong>Pay rate:</strong> $${escapeHtml(viewAgent?.payRate ?? 0)}/hr</div>
              <div><strong>Minimum hours:</strong> ${escapeHtml(viewAgent?.minHours ?? 0)}</div>
              <div><strong>Minimum-hours credit:</strong> ${escapeHtml(getMinimumHoursCredit(viewAgent?.id || 0))} hrs</div>
              <div><strong>Maximum hours:</strong> ${escapeHtml(viewAgent?.maxHours ?? 'Not set')}</div>
              <div><strong>Email:</strong> ${escapeHtml(activeAgentUser?.email || 'Not set')}</div>
              <div><strong>Phone:</strong> ${escapeHtml(activeAgentUser?.phone || 'Not set')}</div>
            </div>
          </div>

          <div class="panel">
            <h2>Personal calendar sync</h2>
            <p class="muted">Subscribe to this URL in Google Calendar, Apple Calendar, or Outlook to keep your shifts in your personal calendar.</p>
            <div class="stack" style="margin-top:10px;">
              <input id="agent-calendar-sync-url" value="${escapeHtml(calendarSyncUrl)}" readonly />
              <div class="row">
                <button id="copy-agent-calendar-sync-url" type="button">Copy sync URL</button>
              </div>
              <div class="muted">Need changes to this URL? Contact an admin.</div>
            </div>
          </div>

          <div class="panel">
            <h2>Update phone number</h2>
            <form id="agent-update-phone-form" class="stack" style="margin-top:10px;">
              <input name="phone" type="tel" placeholder="Phone number" value="${escapeHtml(activeAgentUser?.phone || '')}" required autocomplete="tel" />
              <button type="submit">Save phone number</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderAgentRequestsPage(currentUser) {
  if (currentUser.role !== 'agent') {
    root.innerHTML = `
      <div class="app">
        <div class="panel">
          <h1>Approved requests</h1>
          <p class="muted">This page is available for agent accounts only.</p>
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
        </div>
      </div>
    `;
    return;
  }

  const viewAgent = getViewAgent();
  const currentAgentId = Number(viewAgent?.id);
  const allAvailabilityRequests = getAllAvailabilityRequests();
  const approvedAvailabilityRequests = allAvailabilityRequests.filter((request) => request.agentId === currentAgentId && request.status === 'approved');
  const approvedSwapRequests = state.swapRequests.filter((request) => isSwapRequestVisibleToAgent(request, currentAgentId) && request.status === 'completed');

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Approved requests</h1>
          <p class="muted">Your approved unavailability and completed swap requests.</p>
        </div>
        <div class="row">
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a>
          <a href="index.html?view=pending-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Pending requests</button></a>
          <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open my calendar</button></a>
          <a href="index.html?view=agent-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Approved requests</button></a>
          <a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">My profile</button></a>
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <h2>Approved unavailability requests</h2>
        <div class="request-list" style="margin-top:10px;">
          ${approvedAvailabilityRequests.map((request) => `
            <div class="card">
              <div class="muted">Type: ${escapeHtml(request.unavailabilityType || 'Availability')}</div>
              <div class="muted">Unavailability date: ${escapeHtml(request.unavailableDate || 'Not set')}</div>
              <div class="muted">Time: ${escapeHtml(request.unavailableStart || '--:--')} - ${escapeHtml(request.unavailableEnd || '--:--')}</div>
              <div class="muted">Pattern: ${escapeHtml(getAvailabilityRecurrenceLabel(request))}</div>
              <div class="muted">Approved: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
            </div>
          `).join('') || '<div class="muted">No approved unavailability requests yet.</div>'}
        </div>
      </div>

      <div class="panel">
        <h2>Approved swap requests</h2>
        <div class="request-list" style="margin-top:10px;">
          ${approvedSwapRequests.map((request) => `
            <div class="card">
              <div class="muted">${escapeHtml(getAgent(request.fromAgentId)?.name || 'Unknown')} → ${escapeHtml(getAgent(request.toAgentId)?.name || 'Unknown')}</div>
              <div class="muted">${escapeHtml(getShiftSummary(state.shifts.find((shift) => shift.id === request.shiftId) || {}))}</div>
              <div class="muted">Approved: ${escapeHtml(request.completedAt ? new Date(request.completedAt).toLocaleString() : (request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown'))}</div>
            </div>
          `).join('') || '<div class="muted">No approved swap requests yet.</div>'}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderPendingRequestsPage(currentUser) {
  if (currentUser.role !== 'agent') {
    root.innerHTML = `
      <div class="app">
        <div class="panel">
          <h1>Pending requests</h1>
          <p class="muted">This page is available for agent accounts only.</p>
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a>
        </div>
      </div>
    `;
    return;
  }

  const viewAgent = getViewAgent();
  const currentAgentId = Number(viewAgent?.id);
  const allAvailabilityRequests = getAllAvailabilityRequests();
  const pendingAvailabilityRequests = allAvailabilityRequests.filter((request) => request.agentId === currentAgentId && request.status === 'pending');
  const pendingSwapRequests = state.swapRequests.filter((request) => isSwapRequestVisibleToAgent(request, currentAgentId) && request.status === 'pending');

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Pending requests</h1>
          <p class="muted">Your current unavailability and swap requests waiting on approval.</p>
        </div>
        <div class="row">
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a>
          <a href="index.html?view=pending-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Pending requests</button></a>
          <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open my calendar</button></a>
          <a href="index.html?view=agent-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Approved requests</button></a>
          <a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">My profile</button></a>
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <h2>Pending availability requests</h2>
        <div class="request-list" style="margin-top:10px;">
          ${pendingAvailabilityRequests.map((request) => `
            <div class="card" style="border-left:4px solid #fef08a;">
              <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                  <strong>${escapeHtml(getAgent(request.agentId)?.name || 'Unknown')}</strong>
                  <div class="muted">Type: ${escapeHtml(request.unavailabilityType || 'Availability')}</div>
                  <div class="muted">Date: ${escapeHtml(request.unavailableDate || 'Not set')}</div>
                  <div class="muted">Time: ${escapeHtml(request.unavailableStart || '--:--')} - ${escapeHtml(request.unavailableEnd || '--:--')}</div>
                  <div class="muted">Pattern: ${escapeHtml(getAvailabilityRecurrenceLabel(request))}</div>
                  <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                </div>
                <span class="status-badge pending">pending</span>
              </div>
            </div>
          `).join('') || '<div class="muted">No pending availability requests.</div>'}
        </div>
      </div>

      <div class="panel">
        <h2>Pending swap requests</h2>
        <div class="request-list" style="margin-top:10px;">
          ${pendingSwapRequests.map((request) => `
            <div class="card" style="border-left:4px solid #fef08a;">
              <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                  <strong>${escapeHtml(getAgent(request.fromAgentId)?.name || 'Unknown')} → ${escapeHtml(getAgent(request.toAgentId)?.name || 'Unknown')}</strong>
                  <div class="muted">Shift: ${escapeHtml(getShiftSummary(state.shifts.find((shift) => shift.id === request.shiftId) || {}))}</div>
                  <div class="muted">Approval state: ${escapeHtml(getSwapApprovalText(request))}</div>
                  <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                </div>
                <span class="status-badge pending">pending</span>
              </div>
            </div>
          `).join('') || '<div class="muted">No pending swap requests.</div>'}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderEmailOutboxPage(currentUser) {
  const isAdminView = currentUser.role === 'admin';
  if (!isAdminView) {
    root.innerHTML = `
      <div class="app">
        <div class="panel">
          <h1>Email outbox</h1>
          <p class="muted">This page is available for admin accounts only.</p>
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
        </div>
      </div>
    `;
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      clearSession();
      render();
    });
    return;
  }

  const emailOutboxMessages = [...loadEmailOutbox()].sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Email outbox</h1>
          <p class="muted">Review email notifications sent by the scheduler.</p>
        </div>
        <div class="row">
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
          <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open Calendar</button></a>
          <a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a>
          <a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a>
          <a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a>
          <a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0;">Messages</h2>
          <button id="clear-email-outbox" class="secondary" type="button">Clear outbox</button>
        </div>
        <div class="muted" style="margin-bottom:8px;">${emailOutboxMessages.length} message${emailOutboxMessages.length === 1 ? '' : 's'}</div>
        <div class="request-list" style="margin-top:12px;">
          ${emailOutboxMessages.map((message) => `
            <div class="card">
              <div><strong>To:</strong> ${escapeHtml(message.to || 'Unknown')}</div>
              <div><strong>Subject:</strong> ${escapeHtml(message.subject || 'No subject')}</div>
              <div><strong>Delivery:</strong> ${escapeHtml(message.deliveryStatus || 'local-only')}</div>
              <div><strong>Provider:</strong> ${escapeHtml(message.deliveryProvider || 'generic')}</div>
              <div class="muted">Sent: ${escapeHtml(message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Unknown')}</div>
              ${message.deliveredAt ? `<div class="muted">Delivered: ${escapeHtml(new Date(message.deliveredAt).toLocaleString())}</div>` : ''}
              ${message.deliveryError ? `<div class="muted" style="color:#fca5a5;">Delivery error: ${escapeHtml(message.deliveryError)}</div>` : ''}
              <div class="muted" style="margin-top:6px;">${escapeHtml(message.body || '')}</div>
            </div>
          `).join('') || '<div class="muted">No emails sent yet.</div>'}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderAgentsPage(currentUser) {
  const isAdminView = currentUser.role === 'admin';
  if (!isAdminView) {
    root.innerHTML = `
      <div class="app">
        <div class="panel">
          <h1>Agents</h1>
          <p class="muted">This page is available for admin accounts only.</p>
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
        </div>
      </div>
    `;
    return;
  }

  const visibleAgents = getFilteredAgents();
  const agentSort = state.ui.agentSort === 'team' ? 'team' : 'name';
  const selectedAgentRoleFilter = String(state.ui.agentRoleFilter || 'All');
  const agentRoleOptions = Array.from(new Set(state.agents.map((agent) => String(agent.role || '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  const sortedAgents = [...visibleAgents].sort((left, right) => {
    if (agentSort === 'team') {
      const teamCompare = String(left.team || '').localeCompare(String(right.team || ''), undefined, { sensitivity: 'base' });
      if (teamCompare !== 0) return teamCompare;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
  });

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Agents</h1>
          <p class="muted">Manage agent records, team assignments, and pay rates.</p>
        </div>
        <div class="row">
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
          <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open Calendar</button></a>
          <a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a>
          <a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a>
          <a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a>
          <a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel">
        <div class="row" style="justify-content:space-between; margin-bottom:8px;">
          <h2 style="margin:0;">Agents</h2>
        </div>
        <div class="row" style="justify-content:space-between; margin-bottom:8px;">
          <input id="agent-search" placeholder="Search agents" value="${escapeHtml(state.ui.agentSearch)}" />
          <select id="agent-role-filter" style="max-width:220px;">
            <option value="All" ${selectedAgentRoleFilter === 'All' ? 'selected' : ''}>Filter: All roles</option>
            ${agentRoleOptions.map((role) => `<option value="${escapeHtml(role)}" ${selectedAgentRoleFilter === role ? 'selected' : ''}>Filter: ${escapeHtml(role)}</option>`).join('')}
          </select>
          <select id="agent-sort" style="max-width:220px;">
            <option value="name" ${agentSort === 'name' ? 'selected' : ''}>Sort: Name (A-Z)</option>
            <option value="team" ${agentSort === 'team' ? 'selected' : ''}>Sort: Team</option>
          </select>
        </div>
        <div class="muted" style="margin-bottom:8px;">Add an agent with email to automatically send a password setup invite.</div>
        <form id="add-agent-form" class="stack">
          <div class="row">
            <input name="name" placeholder="Name" required />
            <input name="email" type="email" placeholder="Email" required />
            <select name="team" required>
              ${teamOptions.map((team) => `<option value="${team}">${escapeHtml(team)}</option>`).join('')}
            </select>
            <input name="payRate" type="text" inputmode="decimal" placeholder="$15.45" />
            <input name="minHours" type="number" inputmode="decimal" step="0.25" min="0" placeholder="Min hrs" />
            <input name="maxHours" type="number" inputmode="decimal" step="0.25" min="0" placeholder="Max hrs" />
            <button type="submit">Add agent</button>
          </div>
        </form>
        <div class="agent-list" style="margin-top:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:8px;">
          ${sortedAgents.map((agent) => `
            <div class="card" style="padding:10px;">
              <form class="stack" data-update-agent="${agent.id}" style="gap:8px;">
                <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                  <div>
                    <strong>${escapeHtml(agent.name)}</strong> <span class="chip" style="${getTeamBadgeStyle(agent.team)}">${escapeHtml(agent.team || teamOptions[0])}</span>
                    <div class="muted">Assigned hours: ${getAssignedHours(agent.id)} hrs</div>
                    <div class="muted">Minimum-hours credit: ${getMinimumHoursCredit(agent.id)} hrs (shifts + approved PTO)</div>
                    <div class="muted">Hours target: min ${escapeHtml(agent.minHours ?? 0)} / max ${escapeHtml(agent.maxHours ?? 'Not set')}</div>
                    <div class="muted">Email: ${escapeHtml(getAgentAccountEmail(agent.id) || 'No login email')}</div>
                  </div>
                  <button class="danger" data-remove-agent="${agent.id}" type="button">Remove</button>
                </div>
                <div class="row" style="gap:8px;">
                  <input name="name" value="${escapeHtml(agent.name)}" required />
                  <input name="email" type="email" value="${escapeHtml(getAgentAccountEmail(agent.id) || '')}" placeholder="Email" required />
                  <select name="team" required>
                    ${teamOptions.map((team) => `<option value="${team}" ${(agent.team || teamOptions[0]) === team ? 'selected' : ''}>${escapeHtml(team)}</option>`).join('')}
                  </select>
                  <input name="payRate" type="text" inputmode="decimal" value="${escapeHtml(Number(agent.payRate || 0).toFixed(2))}" />
                  <input name="minHours" type="number" inputmode="decimal" step="0.25" min="0" value="${escapeHtml(agent.minHours ?? 0)}" />
                  <input name="maxHours" type="number" inputmode="decimal" step="0.25" min="0" value="${escapeHtml(agent.maxHours ?? '')}" />
                </div>
                <div class="row" style="gap:8px; justify-content:flex-end;">
                  <button class="secondary" type="submit">Save agent</button>
                  <button class="secondary" type="button" data-resend-agent-invite="${agent.id}">Resend invite</button>
                </div>
              </form>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function getAvailabilityStatusStyles(status) {
  if (status === 'approved') {
    return 'background:#7AACAF; color:#17383B;';
  }
  if (status === 'rejected') {
    return 'background:#AB5C57; color:#FFF1EF;';
  }
  return 'background:#FDD592; color:#4B3A1F;';
}

function getAvailabilityCalendarCells(monthValue, requests) {
  const normalizedMonth = monthValue || new Date().toISOString().slice(0, 7);
  const monthStart = new Date(`${normalizedMonth}-01T00:00:00`);
  if (Number.isNaN(monthStart.getTime())) {
    return { label: 'Invalid month', cells: [] };
  }

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekDay = monthStart.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const requestsByDate = (Array.isArray(requests) ? requests : []).reduce((acc, request) => {
    const key = (request.unavailableDate || '').slice(0, 10) || (request.requestedAt || '').slice(0, 10);
    if (!key) return acc;
    acc[key] = acc[key] || [];
    acc[key].push(request);
    return acc;
  }, {});

  const cells = [];
  for (let index = 0; index < firstWeekDay; index += 1) {
    cells.push({ key: `empty-start-${index}`, empty: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = `${normalizedMonth}-${String(day).padStart(2, '0')}`;
    cells.push({
      key: isoDate,
      empty: false,
      day,
      date: isoDate,
      requests: requestsByDate[isoDate] || []
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-end-${cells.length}`, empty: true });
  }

  return {
    label: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    cells
  };
}

function renderAvailabilityRequestsPage(currentUser) {
  const isAdminView = currentUser.role === 'admin';
  if (!isAdminView) {
    root.innerHTML = `
      <div class="app">
        <div class="panel">
          <h1>Availability requests</h1>
          <p class="muted">This page is available for admin accounts only.</p>
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
        </div>
      </div>
    `;
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      clearSession();
      render();
    });
    return;
  }

  const allAvailabilityRequests = getAllAvailabilityRequests();
  const filteredAvailabilityRequests = getFilteredAvailabilityRequests(allAvailabilityRequests);
  const visibleAvailabilityRequests = [...(filteredAvailabilityRequests.length > 0 ? filteredAvailabilityRequests : allAvailabilityRequests)]
    .sort((left, right) => (right.requestedAt || '').localeCompare(left.requestedAt || ''));
  const visibleSwapRequests = [...(Array.isArray(state.swapRequests) ? state.swapRequests : [])]
    .sort((left, right) => (right.requestedAt || '').localeCompare(left.requestedAt || ''));
  const pendingCount = visibleAvailabilityRequests.filter((request) => request.status === 'pending').length;
  const pendingSwapCount = visibleSwapRequests.filter((request) => request.status === 'pending').length;
  const selectedMonth = state.ui.availabilityCalendarMonth || new Date().toISOString().slice(0, 7);
  const calendarData = getAvailabilityCalendarCells(selectedMonth, visibleAvailabilityRequests);

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Availability requests</h1>
          <p class="muted">Review all submitted requests by date and manage approvals.</p>
        </div>
        <div class="row">
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
          <a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open Calendar</button></a>
          <a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a>
          <a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a>
          <a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a>
          <a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <div class="row" style="margin-bottom:8px;">
          <input id="availability-from-filter" type="date" value="${escapeHtml(state.ui.availabilityFrom || '')}" />
          <input id="availability-to-filter" type="date" value="${escapeHtml(state.ui.availabilityTo || '')}" />
          <button id="availability-filters-apply" type="button">Apply filters</button>
          <button id="availability-filters-reset" class="secondary" type="button">Reset filters</button>
        </div>
        <div class="muted">Total requests loaded: ${allAvailabilityRequests.length}</div>
        <div class="muted">Visible requests: ${visibleAvailabilityRequests.length} (${pendingCount} pending)</div>
        <div class="muted">Swap requests: ${visibleSwapRequests.length} (${pendingSwapCount} pending)</div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h2 style="margin:0;">Request calendar (${escapeHtml(calendarData.label)})</h2>
          <input id="availability-calendar-month" type="month" value="${escapeHtml(selectedMonth)}" />
        </div>
        <div class="row" style="gap:8px; margin-bottom:10px;">
          <span class="chip" style="background:#FDD592; color:#4B3A1F; border:1px solid rgba(0,0,0,0.2);">Pending</span>
          <span class="chip" style="background:#7AACAF; color:#17383B; border:1px solid rgba(255,255,255,0.2);">Approved</span>
          <span class="chip" style="background:#AB5C57; color:#FFF1EF; border:1px solid rgba(255,255,255,0.2);">Denied</span>
          <span class="chip" style="background:#AB5C57; color:#FFF1EF; border:1px solid rgba(255,255,255,0.2);">Blackout date</span>
        </div>
        <div style="display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:8px; margin-bottom:8px;">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel) => `<div class="muted" style="text-align:center;">${dayLabel}</div>`).join('')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:8px;">
          ${calendarData.cells.map((cell) => {
            if (cell.empty) {
              return '<div class="card" style="min-height:96px; opacity:0.25;"></div>';
            }
            const blackoutDate = isBlackoutDate(cell.date);
            return `
              <div class="card" style="min-height:96px; padding:8px; ${blackoutDate ? 'border-color:#AB5C57; box-shadow:inset 0 0 0 1px rgba(171,92,87,0.55);' : ''}">
                <div style="font-weight:600; margin-bottom:6px;">${cell.day}</div>
                ${blackoutDate ? '<div class="chip" style="margin-bottom:6px; background:#AB5C57; color:#FFF1EF; border:1px solid rgba(255,255,255,0.2);">Blackout date</div>' : ''}
                <div style="display:flex; flex-direction:column; gap:4px;">
                  ${(cell.requests || []).slice(0, 3).map((request) => `
                    <div title="${escapeHtml((getAgent(request.agentId)?.name || 'Unknown'))} - ${escapeHtml(request.status || 'pending')}" style="padding:3px 6px; border-radius:999px; font-size:12px; ${getAvailabilityStatusStyles(request.status || 'pending')}">
                      ${escapeHtml(getAgent(request.agentId)?.name || 'Unknown')} • ${escapeHtml(request.status || 'pending')}
                    </div>
                  `).join('')}
                  ${(cell.requests || []).length > 3 ? `<div class="muted">+${(cell.requests || []).length - 3} more</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="panel">
        <h2>All requests</h2>
        <div class="request-list" style="margin-top:12px;">
          ${visibleAvailabilityRequests.map((request) => `
            <div class="card" style="border-left:4px solid ${request.status === 'approved' ? '#7AACAF' : request.status === 'rejected' ? '#AB5C57' : '#FDD592'};">
              <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                  <strong>${escapeHtml(getAgent(request.agentId)?.name || 'Unknown')}</strong>
                  <div class="muted">Type: ${escapeHtml(request.unavailabilityType || 'Availability')}</div>
                  <div class="muted">Requested unavailability date: ${escapeHtml(request.unavailableDate || 'Not set')}</div>
                  <div class="muted">Time: ${escapeHtml(request.unavailableStart || '--:--')} - ${escapeHtml(request.unavailableEnd || '--:--')}</div>
                  <div class="muted">Pattern: ${escapeHtml(getAvailabilityRecurrenceLabel(request))}</div>
                  <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                  ${request.note ? `<div class="muted">Note: ${escapeHtml(request.note)}</div>` : ''}
                </div>
                <span class="status-badge ${request.status || 'pending'}">${request.status || 'pending'}</span>
              </div>
              ${request.status === 'pending' ? `
                <div class="row" style="margin-top:8px;">
                  <button class="success" data-approve-availability-request="${request.id}">Approve</button>
                  <button class="danger" data-reject-availability-request="${request.id}">Deny</button>
                </div>` : ''}
            </div>
          `).join('') || '<div class="muted">No unavailability requests yet.</div>'}
        </div>
      </div>

      <div class="panel" style="margin-top:16px;">
        <h2>Swap requests</h2>
        <div class="request-list" style="margin-top:12px;">
          ${visibleSwapRequests.map((request) => {
            const fromAgent = getAgent(request.fromAgentId)?.name || 'Unknown';
            const toAgent = getAgent(request.toAgentId)?.name || 'Unknown';
            const shiftSummary = getShiftSummary(state.shifts.find((shift) => shift.id === request.shiftId) || {});
            return `
              <div class="card" style="border-left:4px solid ${request.status === 'completed' ? '#7AACAF' : request.status === 'rejected' ? '#AB5C57' : '#FDD592'};">
                <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                  <div>
                    <strong>${escapeHtml(fromAgent)} → ${escapeHtml(toAgent)}</strong>
                    <div class="muted">Shift: ${escapeHtml(shiftSummary)}</div>
                    <div class="muted">Approval state: ${escapeHtml(getSwapApprovalText(request))}</div>
                    <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                  </div>
                  <span class="status-badge ${request.status || 'pending'}">${request.status || 'pending'}</span>
                </div>
              </div>
            `;
          }).join('') || '<div class="muted">No swap requests yet.</div>'}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function render() {
  syncFromStorage();
  bindAvailabilitySubmitFallback();
  const currentUser = getCurrentUser();
  if (!currentUser) {
    renderLoginPage();
    return;
  }
  if (currentUser.role === 'agent' && !state.agents.some((agent) => agent.id === Number(currentUser.agentId))) {
    clearSession();
    renderLoginPage('Your linked agent profile no longer exists. Contact an admin.');
    return;
  }
  if (currentUser.role === 'agent' && currentUser.mustChangePassword) {
    renderFirstLoginPasswordSetupPage(currentUser);
    return;
  }
  applyAccessForUser(currentUser);

  if (pageMode === 'profile') {
    renderProfilePage(currentUser);
    return;
  }

  if (pageMode === 'email-outbox') {
    renderEmailOutboxPage(currentUser);
    return;
  }

  if (pageMode === 'agents') {
    renderAgentsPage(currentUser);
    return;
  }

  if (pageMode === 'pending-requests') {
    renderPendingRequestsPage(currentUser);
    return;
  }

  if (pageMode === 'agent-requests') {
    renderAgentRequestsPage(currentUser);
    return;
  }

  if (pageMode === 'availability-requests') {
    renderAvailabilityRequestsPage(currentUser);
    return;
  }

  if (pageMode === 'calendar') {
    renderCalendarPage(currentUser);
    return;
  }

  const spendByDay = getSpendByDay();
  const stats = getAvailabilityStats();
  const visibleAgents = getFilteredAgents();
  const isAgentView = currentUser.role === 'agent';
  if (!isAgentView) {
    state.ui.calendar = {
      ...(state.ui.calendar || {}),
      agentId: 'All',
      role: 'All',
      agentName: '',
      date: '',
      weekReference: state.ui.calendar?.weekReference || '',
      location: 'All',
      search: state.ui.calendar?.search || '',
      day: state.ui.calendar?.day || 'All'
    };
  }
  const viewAgent = getViewAgent();
  const currentAgentId = Number(viewAgent?.id);
  const visibleShifts = isAgentView ? getAgentViewShifts() : [];
  const blackoutDates = normalizeBlackoutDates(state.blackoutDates);
  const plannerWeekReference = getActiveCalendarWeekReference();
  const plannerWeekDates = getCalendarWeekDates(plannerWeekReference);
  const plannerWeekLabel = getCalendarWeekLabel(plannerWeekDates);
  const adminWeeklyShifts = isAgentView
    ? []
    : getFilteredCalendarShifts().filter((shift) => shift.status === shiftStatuses.published && shiftIsInWeek(shift, plannerWeekDates));
  const swapAlertCount = state.swapRequests.length;
  const agentViewShifts = getAgentViewShifts();
  const todayDay = days[(new Date().getDay() + 6) % 7] || 'Mon';
  const selectedAgentScheduleView = ['day', 'week', 'month'].includes(state.ui.agentScheduleView) ? state.ui.agentScheduleView : 'week';
  const selectedAgentScheduleDay = days.includes(state.ui.agentScheduleDay) ? state.ui.agentScheduleDay : todayDay;
  const selectedAgentScheduleMonth = state.ui.agentScheduleMonth || new Date().toISOString().slice(0, 7);
  const monthShifts = visibleShifts
    .filter((shift) => String(shift.date || '').slice(0, 7) === selectedAgentScheduleMonth)
    .sort((a, b) => {
      const left = `${a.date || ''} ${a.start || ''}`;
      const right = `${b.date || ''} ${b.start || ''}`;
      return left.localeCompare(right);
    });

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>${isAgentView ? 'My scheduling view' : 'Agent Scheduling Hub'}</h1>
          <p class="muted">${isAgentView ? 'View your schedule and request swaps without the admin management tools.' : 'A fuller staffing workspace for agents, templates, drag-and-drop scheduling, pay tracking, and swap alerts.'}</p>
          <p class="muted">${escapeHtml(getLastSyncStatusText())}</p>
        </div>
        <div class="row">
          ${isAgentView
            ? '<a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a><a href="index.html?view=pending-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Pending requests</button></a><a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open my calendar</button></a><a href="index.html?view=agent-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Approved requests</button></a><a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">My profile</button></a>'
            : '<a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Open Calendar</button></a><a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a><a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a><a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a><a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>'}
          ${!isAgentView ? '<button id="export-data-btn" class="secondary">Export JSON</button>' : ''}
          ${!isAgentView ? `<label class="secondary" style="display:inline-flex; align-items:center; padding:10px 12px; border-radius:10px; cursor:pointer;">
            <input id="import-data-input" type="file" accept="application/json" hidden />
            Import JSON
          </label>` : ''}
          <span class="chip">${escapeHtml(getUserDisplayName(currentUser))} (${escapeHtml(currentUser.role)})</span>
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      ${!isAgentView ? `
        <div class="stats">
          <div class="stat"><strong>${state.agents.length}</strong><div class="muted">Agents</div></div>
          <div class="stat"><strong>${state.shifts.length}</strong><div class="muted">Shifts</div></div>
          <div class="stat"><strong>${stats.available}</strong><div class="muted">Available</div></div>
          <div class="stat"><strong>$${getWeeklySpend()}</strong><div class="muted">Weekly spend</div></div>
        </div>` : `
        <div class="panel" style="margin-bottom:16px;">
          <strong>${escapeHtml(viewAgent?.name || 'Agent')}</strong>
          <div class="muted">You can review your assignments and request changes here.</div>
        </div>`}

      <div class="grid" style="margin-top:16px;${!isAgentView ? ' grid-template-columns:1fr;' : ''}">
        <div class="stack">
          ${!isAgentView ? `
            <div style="display:grid; gap:12px; grid-template-columns:1fr; align-items:start;">
              <div class="stack">
                <div class="panel">
                  <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <h2 style="margin:0;">Role colors</h2>
                    <button id="reset-role-colors" class="secondary" type="button">Reset role colors</button>
                  </div>
                  <div style="display:grid; grid-template-columns:repeat(${getRoleLegendItems().length}, minmax(0, 1fr)); gap:10px; align-items:center; width:100%;">
                    ${getRoleLegendItems().map((role) => `
                      <label class="row" style="justify-content:space-between; gap:8px; width:100%; margin:0;">
                        <span class="chip" style="background:${getRoleColor(role)}; border:1px solid rgba(255,255,255,0.25);">${escapeHtml(role)}</span>
                        <input type="color" data-role-color="${escapeHtml(role)}" value="${escapeHtml(getRoleColor(role))}" style="width:56px; padding:4px;" />
                      </label>
                    `).join('')}
                  </div>
                </div>

                <div class="panel">
                  <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <h2 style="margin:0;">Swap alerts</h2>
                    <button id="toggle-swap-alerts" class="secondary" type="button">${state.ui.swapAlertsCollapsed ? 'Show alerts' : 'Hide alerts'}</button>
                  </div>
                  <div class="muted" style="margin-bottom:8px;">${swapAlertCount} alert${swapAlertCount === 1 ? '' : 's'}</div>
                  ${state.ui.swapAlertsCollapsed ? '<div class="muted">Swap alerts are hidden.</div>' : `
                    <div class="request-list" style="margin-top:12px;">
                      ${state.swapRequests.map((request) => `
                        <div class="card">
                          <div class="row" style="justify-content:space-between;">
                            <div>
                              <strong>${escapeHtml(getAgent(request.fromAgentId)?.name || 'Unknown')} → ${escapeHtml(getAgent(request.toAgentId)?.name || 'Unknown')}</strong>
                              <div class="muted">${escapeHtml(getShiftSummary(state.shifts.find((shift) => shift.id === request.shiftId) || {}))}</div>
                              <div class="muted">Approval state: ${escapeHtml(getSwapApprovalText(request))}</div>
                              <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                            </div>
                            <span class="status-badge ${request.status || 'pending'}">${request.status || 'pending'}</span>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  `}
                </div>

              </div>
            </div>

            </div>` : `
            <div class="panel">
              <h2>My schedule</h2>
              <div class="muted">Showing shifts for ${escapeHtml(viewAgent?.name || 'your selected agent')}.</div>
              <div class="row" style="margin-top:10px; margin-bottom:10px;">
                <select id="agent-schedule-view">
                  <option value="day" ${selectedAgentScheduleView === 'day' ? 'selected' : ''}>Day</option>
                  <option value="week" ${selectedAgentScheduleView === 'week' ? 'selected' : ''}>Week</option>
                  <option value="month" ${selectedAgentScheduleView === 'month' ? 'selected' : ''}>Month</option>
                </select>
                ${selectedAgentScheduleView === 'day' ? `<select id="agent-schedule-day">${days.map((day) => `<option value="${day}" ${selectedAgentScheduleDay === day ? 'selected' : ''}>${day}</option>`).join('')}</select>` : ''}
                ${selectedAgentScheduleView === 'month' ? `<input id="agent-schedule-month" type="month" value="${escapeHtml(selectedAgentScheduleMonth)}" />` : ''}
              </div>
              ${selectedAgentScheduleView === 'day' ? `
                <div class="day-row" style="margin-top:12px; grid-template-columns:repeat(1, minmax(0, 1fr));">
                  <div class="day-card" data-day="${selectedAgentScheduleDay}">
                    <h4>${selectedAgentScheduleDay}</h4>
                    ${getBlackoutDateMarker(weekDates[selectedAgentScheduleDay]?.iso || '')}
                    ${visibleShifts.filter((shift) => shift.day === selectedAgentScheduleDay).map((shift) => `
                      <div class="shift" draggable="true" data-shift-id="${shift.id}">
                        <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${escapeHtml(shift.role || roleOptions[0])}<br />${escapeHtml(shift.location || 'No location')}<br />${formatTimeRange(shift.start, shift.end)}
                      </div>
                    `).join('') || '<div class="muted">No shifts for this day.</div>'}
                  </div>
                </div>
              ` : ''}
              ${selectedAgentScheduleView === 'week' ? `
                <div class="day-row" style="margin-top:12px;">
                  ${days.map((day) => `
                    <div class="day-card" data-day="${day}">
                      <h4>${day}</h4>
                      ${getBlackoutDateMarker(weekDates[day]?.iso || '')}
                      ${visibleShifts.filter((shift) => shift.day === day).map((shift) => `
                        <div class="shift" draggable="true" data-shift-id="${shift.id}">
                          <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${escapeHtml(shift.role || roleOptions[0])}<br />${escapeHtml(shift.location || 'No location')}<br />${formatTimeRange(shift.start, shift.end)}
                        </div>
                      `).join('')}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${selectedAgentScheduleView === 'month' ? `
                <div class="request-list" style="margin-top:12px;">
                  ${monthShifts.map((shift) => `
                    <div class="card">
                      <strong>${escapeHtml(shift.date || shift.day || 'Date not set')}</strong>
                      <div class="muted">${escapeHtml(shift.day || '')} • ${formatTimeRange(shift.start, shift.end)}</div>
                      <div class="muted">${escapeHtml(shift.role || roleOptions[0])} • ${escapeHtml(shift.location || 'No location')}</div>
                    </div>
                  `).join('') || '<div class="muted">No shifts in this month.</div>'}
                </div>
              ` : ''}
            </div>`}
        </div>

        <div class="stack">
          ${!isAgentView ? '' : `
            <div class="panel">
              <h2>Time Off</h2>
              ${blackoutDates.length > 0 ? `
                <div style="margin-bottom:10px;">
                  <div class="muted" style="margin-bottom:6px;">Blackout dates</div>
                  <div class="row" style="gap:6px; flex-wrap:wrap;">
                    ${blackoutDates.map((dateValue) => `<span class="chip" style="background:#AB5C57; color:#FFF1EF; border:1px solid rgba(255,255,255,0.2);">${escapeHtml(dateValue)}</span>`).join('')}
                  </div>
                </div>` : ''}
              <form id="agent-availability-form" class="stack">
                <select name="unavailabilityType" required>
                  <option value="Availability">Availability</option>
                  <option value="PTO">PTO</option>
                </select>
                <input name="unavailableDate" type="date" required />
                <div class="row">
                  <input name="unavailableStart" type="time" required />
                  <input name="unavailableEnd" type="time" required />
                </div>
                <div class="row">
                  <select name="recurrenceType">
                    <option value="once">One-time</option>
                    <option value="weekly">Weekly recurring</option>
                  </select>
                  <select name="recurrenceDay">
                    <option value="">Match selected date</option>
                    ${days.map((day) => `<option value="${day}">${day}</option>`).join('')}
                  </select>
                  <input name="recurrenceEndDate" type="date" />
                </div>
                <div class="muted" style="font-size:12px;">For weekly recurring requests, choose an end date (example: every Thu, 3:00 PM-6:00 PM).</div>
                <input name="note" placeholder="Reason or note" required />
                <button type="submit">Submit request</button>
              </form>
            </div>

            <div class="panel">
              <h2>Swap a shift</h2>
              <form id="swap-form" class="stack">
                <input type="hidden" name="fromAgentId" value="${viewAgent?.id || ''}" />
                <select name="shiftId" required>
                  <option value="">Select a shift</option>
                  ${agentViewShifts.map((shift) => `<option value="${shift.id}">${escapeHtml(getShiftSummary(shift))}</option>`).join('')}
                </select>
                <select name="toAgentId" required>
                  <option value="">Swap with</option>
                  ${state.agents.filter((agent) => agent.id !== viewAgent?.id).map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('')}
                </select>
                <button type="submit">Request swap</button>
              </form>
            </div>`}

          ${!isAgentView ? `<div class="panel">
            <h2>Weekly planner</h2>
            <div class="row" style="margin-bottom:8px;">
              <input id="shift-search" placeholder="Search shifts" value="${escapeHtml(state.ui.calendar?.search || '')}" />
              <select id="day-filter">
                <option value="All" ${(state.ui.calendar?.day || 'All') === 'All' ? 'selected' : ''}>All days</option>
                ${days.map((day) => `<option value="${day}" ${(state.ui.calendar?.day || 'All') === day ? 'selected' : ''}>${day}</option>`).join('')}
              </select>
              <button id="weekly-filters-apply" type="button">Apply filters</button>
              <button id="weekly-filters-reset" class="secondary" type="button">Reset filters</button>
            </div>
            <div class="row" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
              <div>
                <strong>Week of ${escapeHtml(plannerWeekLabel)}</strong>
                <div class="muted">Move between weeks without leaving the dashboard.</div>
              </div>
              <div class="row" style="gap:8px; flex-wrap:wrap;">
                <button id="weekly-previous-week" class="secondary" type="button">Previous week</button>
                <button id="weekly-current-week" class="secondary" type="button">Current week</button>
                <button id="weekly-next-week" class="secondary" type="button">Next week</button>
                <input id="weekly-week-reference" type="date" value="${escapeHtml(plannerWeekReference)}" />
              </div>
            </div>
            <div class="row" style="margin-bottom:8px;">
              ${getRoleLegendItems().map((role) => `
                <span class="chip" style="background:${getRoleColor(role)}; border:1px solid rgba(255,255,255,0.25);">${escapeHtml(role)}</span>
              `).join('')}
            </div>
            <div class="day-row">
              ${days.map((day) => `
                <div class="day-card" data-day="${day}">
                  <h4>${day}</h4>
                  <div class="muted">${escapeHtml(plannerWeekDates[day]?.label || '')}</div>
                  ${getBlackoutDateMarker(plannerWeekDates[day]?.iso || '')}
                  ${adminWeeklyShifts.filter((shift) => shift.day === day).map((shift) => `
                    <div class="shift" draggable="true" data-shift-id="${shift.id}" style="${getShiftStyle(shift)}">
                      <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${escapeHtml(shift.role || roleOptions[0])}<br />${escapeHtml(shift.location || 'No location')}<br />${formatTimeRange(shift.start, shift.end)}
                    </div>
                  `).join('')}
                </div>
              `).join('')}
            </div>
          </div>` : ''}

        </div>
      </div>
    </div>
  `;

  bindEvents();
}

window.addEventListener('storage', (event) => {
  if (![storageKey, authUsersKey, sessionKey, availabilityRequestsKey, availabilityInboxKey, availabilityRequestLedgerKey].includes(event.key)) return;
  syncFromStorage();
  render();
});

function submitAvailabilityRequest(formElement) {
  const currentId = getCurrentAgentId();
  if (!currentId) {
    alert('Unable to submit request: no agent is selected.');
    return false;
  }
  const currentUser = getCurrentUser();
  if (!currentUser) {
    alert('Unable to submit request: no active user session.');
    return false;
  }

  const formData = new FormData(formElement);
  const unavailabilityType = formData.get('unavailabilityType')?.toString() || 'Availability';
  const unavailableDate = formData.get('unavailableDate')?.toString() || '';
  const unavailableStart = formData.get('unavailableStart')?.toString() || '';
  const unavailableEnd = formData.get('unavailableEnd')?.toString() || '';
  const recurrenceTypeInput = formData.get('recurrenceType')?.toString() || 'once';
  const recurrenceDayInput = formData.get('recurrenceDay')?.toString() || '';
  const recurrenceEndDate = formData.get('recurrenceEndDate')?.toString() || '';
  const note = formData.get('note')?.toString().trim() || '';
  if (!unavailabilityType || !unavailableDate || !unavailableStart || !unavailableEnd || !note) {
    alert('Please complete all request fields before submitting.');
    return false;
  }

  const recurrenceType = recurrenceTypeInput === 'weekly' ? 'weekly' : 'once';
  const derivedDayFromDate = getDayFromDate(unavailableDate);
  const recurrenceDay = recurrenceType === 'weekly'
    ? (days.includes(recurrenceDayInput) ? recurrenceDayInput : derivedDayFromDate)
    : '';
  if (recurrenceType === 'weekly' && !recurrenceEndDate) {
    alert('Choose an end date for weekly recurring unavailability.');
    return false;
  }
  if (recurrenceType === 'weekly' && !recurrenceDay) {
    alert('Choose a valid recurring day or select a valid unavailable date.');
    return false;
  }

  const recurrencePlan = recurrenceType === 'weekly'
    ? buildWeeklyRecurringDates(unavailableDate, recurrenceDay, recurrenceEndDate)
    : { dates: [unavailableDate], truncated: false };
  if (!recurrencePlan.dates.length) {
    alert('No recurring dates were generated. Make sure the end date is on or after the start date.');
    return false;
  }

  const blockedBlackoutDates = recurrencePlan.dates.filter((dateValue) => isBlackoutDate(dateValue));
  if (blockedBlackoutDates.length > 0) {
    alert('cannot submit due to blackout dates. please check in with your manager directly');
    return false;
  }

  const recurrenceGroupId = recurrenceType === 'weekly'
    ? `weekly-${currentId}-${Date.now()}-${createId()}`
    : '';
  const requesterName = getAgent(currentId)?.name || currentUser.username || 'Agent';
  const requestTimestamp = new Date().toISOString();

  const nextRequests = recurrencePlan.dates.map((dateValue, index) => ({
    id: createId(),
    agentId: currentId,
    requesterUserId: currentUser.id,
    requesterEmail: currentUser.email || '',
    requesterName,
    availability: 'Unavailable',
    unavailabilityType,
    unavailableDate: dateValue,
    unavailableStart,
    unavailableEnd,
    note,
    recurrenceType,
    recurrenceDay,
    recurrenceEndDate: recurrenceType === 'weekly' ? String(recurrenceEndDate).slice(0, 10) : '',
    recurrenceGroupId,
    recurrenceInstance: index + 1,
    recurrenceTotal: recurrencePlan.dates.length,
    requestedAt: requestTimestamp,
    status: 'pending'
  }));

  const nextAvailabilityRequests = [...getAllAvailabilityRequests(), ...nextRequests];
  saveAvailabilityRequests(nextAvailabilityRequests);
  saveState();

  const recurrenceSummary = recurrenceType === 'weekly'
    ? `weekly every ${recurrenceDay} through ${String(recurrenceEndDate).slice(0, 10)}`
    : unavailableDate;

  sendEmailNotification({
    to: currentUser.email || '',
    subject: 'Unavailability request received',
    body: `Hi ${requesterName}, your unavailability request (${recurrenceSummary}, ${formatTimeRange(unavailableStart, unavailableEnd)}) has been submitted successfully.`,
    type: 'availability-submitted'
  });

  const outboxCount = loadEmailOutbox().length;
  const submittedCount = nextRequests.length;
  const requestLabel = submittedCount === 1 ? 'request' : 'requests';
  const truncationNote = recurrencePlan.truncated
    ? ' For safety, recurring requests are capped at 104 weekly entries per submission.'
    : '';
  alert(`${submittedCount} unavailability ${requestLabel} submitted. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.${truncationNote}`);
  render();
  return true;
}

function bindAvailabilitySubmitFallback() {
  if (availabilitySubmitFallbackBound) return;
  document.addEventListener('submit', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return;
    if (target.id !== 'agent-availability-form') return;
    if (target.dataset.availabilityHandled === '1') {
      delete target.dataset.availabilityHandled;
      return;
    }
    event.preventDefault();
    submitAvailabilityRequest(target);
  });
  availabilitySubmitFallbackBound = true;
}

function bindEvents() {
  document.getElementById('add-agent-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get('name')?.toString().trim();
    const email = normalizeEmail(formData.get('email'));
    const payRateRaw = formData.get('payRate')?.toString().trim() || '0';
    const payRate = parseCurrencyAmount(payRateRaw);
    const minHours = normalizeMinHours(formData.get('minHours'));
    const maxHours = normalizeMaxHours(formData.get('maxHours'));
    if (!name || !email) {
      alert('Name and email are required to add an agent.');
      return;
    }
    if (!Number.isFinite(payRate) || payRate < 0) {
      alert('Pay rate must be a valid non-negative amount (example: $15.45).');
      return;
    }
    if (Number.isFinite(maxHours) && maxHours < minHours) {
      alert('Maximum hours must be greater than or equal to minimum hours.');
      return;
    }
    const emailInUse = authUsers.some((user) => normalizeEmail(user.email) === email);
    if (emailInUse) {
      alert('That email is already in use by another account.');
      return;
    }
    const agentId = createId();
    state.agents.push({
      id: agentId,
      name,
      email,
      team: normalizeTeamLabel(formData.get('team')?.toString().trim() || teamOptions[0]),
      payRate,
      minHours,
      maxHours,
      availability: 'Available'
    });

    const nextUser = withRequiredEmail({
      id: createId(),
      username: createUniqueAgentUsername(email),
      email,
      phone: '',
      password: createTemporaryPassword(),
      mustChangePassword: true,
      calendarFeedToken: createCalendarFeedToken(),
      role: 'agent',
      agentId
    });
    authUsers.push(nextUser);
    saveAuthUsers();
    const inviteResult = sendAgentInviteEmail(nextUser, name, nextUser.password);

    saveState();
    const outboxCount = loadEmailOutbox().length;
    if (inviteResult?.deliveryStatus === 'local-only') {
      alert(`Agent added. Invite was queued in Email outbox (local-only) because webhook delivery is not enabled. Configure Admin Profile > Email delivery to send real emails.\n\nTemporary password: ${inviteResult?.temporaryPassword || '(not available)'}\nSign-in link: ${inviteResult?.signInLink || getAppLoginUrl()}`);
    } else {
      alert(`Agent added and invitation email queued for delivery. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.`);
    }
    render();
  });

  document.getElementById('add-shift-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const agentId = formData.get('agentId') ? Number(formData.get('agentId')) : null;
    const role = normalizeRoleLabel(formData.get('role')?.toString().trim() || getAgent(agentId)?.role || roleOptions[0]);
    const start = formData.get('start')?.toString();
    const end = formData.get('end')?.toString();
    const requestedLocation = formData.get('location')?.toString().trim() || '';
    const location = requestedLocation && shiftLocationOptions.includes(requestedLocation) ? requestedLocation : '';
    const date = formData.get('date')?.toString() || '';
    const day = getDayFromDate(date);
    if (!day || !agentId || !role || !start || !end || !date) return;
    if (!confirmShiftAssignmentWithTimeOffWarning(agentId, date, start, end, {
      durationHours: getDurationHours(start, end)
    })) return;

    state.shifts.push({ id: createId(), day, date, agentId, role, start, end, durationHours: getDurationHours(start, end), location, status: shiftStatuses.draft });
    saveState();
    render();
  });

  document.getElementById('swap-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fromAgentId = Number(formData.get('fromAgentId')) || Number(state.ui.currentAgentId);
    const toAgentId = Number(formData.get('toAgentId'));
    const shiftId = Number(formData.get('shiftId'));
    if (!fromAgentId || !toAgentId || !shiftId) {
      alert('Select both a shift and an agent to swap with before submitting.');
      return;
    }
    if (fromAgentId === toAgentId) {
      alert('Choose a different agent for the swap request.');
      return;
    }
    state.swapRequests.push({
      id: createId(),
      fromAgentId,
      toAgentId,
      shiftId,
      requestedAt: new Date().toISOString(),
      fromApproved: true,
      toApproved: false,
      status: 'pending'
    });
    saveState();
    alert('Swap request submitted. Admin can review it in Swap alerts and Availability Requests.');
    render();
  });

  document.getElementById('agent-search')?.addEventListener('input', (event) => {
    state.ui.agentSearch = event.target.value;
    saveUiState();
    render();
  });

  document.getElementById('agent-role-filter')?.addEventListener('change', (event) => {
    state.ui.agentRoleFilter = event.target.value || 'All';
    saveUiState();
    render();
  });

  document.getElementById('agent-sort')?.addEventListener('change', (event) => {
    state.ui.agentSort = event.target.value === 'team' ? 'team' : 'name';
    saveUiState();
    render();
  });

  document.getElementById('toggle-availability-requests')?.addEventListener('click', () => {
    state.ui.availabilityRequestsCollapsed = !state.ui.availabilityRequestsCollapsed;
    saveUiState();
    render();
  });

  document.getElementById('toggle-swap-alerts')?.addEventListener('click', () => {
    state.ui.swapAlertsCollapsed = !state.ui.swapAlertsCollapsed;
    saveUiState();
    render();
  });

  document.getElementById('clear-email-outbox')?.addEventListener('click', () => {
    saveEmailOutbox([]);
    render();
  });

  document.getElementById('weekly-filters-apply')?.addEventListener('click', () => {
    const searchInput = document.getElementById('shift-search');
    const daySelect = document.getElementById('day-filter');
    state.ui.calendar.search = searchInput?.value || '';
    state.ui.calendar.day = daySelect?.value || 'All';
    saveUiState();
    render();
  });

  document.getElementById('weekly-filters-reset')?.addEventListener('click', () => {
    state.ui.calendar.search = '';
    state.ui.calendar.day = 'All';
    saveUiState();
    render();
  });

  document.getElementById('agent-schedule-view')?.addEventListener('change', (event) => {
    state.ui.agentScheduleView = event.target.value;
    saveUiState();
    render();
  });

  document.getElementById('agent-schedule-day')?.addEventListener('change', (event) => {
    state.ui.agentScheduleDay = event.target.value;
    saveUiState();
    render();
  });

  document.getElementById('agent-schedule-month')?.addEventListener('change', (event) => {
    state.ui.agentScheduleMonth = event.target.value;
    saveUiState();
    render();
  });

  document.getElementById('availability-calendar-month')?.addEventListener('change', (event) => {
    state.ui.availabilityCalendarMonth = event.target.value;
    saveUiState();
    render();
  });

  document.getElementById('availability-filters-apply')?.addEventListener('click', () => {
    const fromInput = document.getElementById('availability-from-filter');
    const toInput = document.getElementById('availability-to-filter');
    state.ui.availabilityFrom = fromInput?.value || '';
    state.ui.availabilityTo = toInput?.value || '';
    saveUiState();
    render();
  });

  document.getElementById('availability-filters-reset')?.addEventListener('click', () => {
    state.ui.availabilityFrom = '';
    state.ui.availabilityTo = '';
    saveUiState();
    render();
  });

  document.getElementById('calendar-filters-apply')?.addEventListener('click', () => {
    const searchInput = document.getElementById('calendar-search');
    const daySelect = document.getElementById('calendar-day-filter');
    const agentNameSelect = document.getElementById('calendar-agent-name-filter');
    const dateInput = document.getElementById('calendar-date-filter');
    const agentSelect = document.getElementById('calendar-agent-filter');
    const roleSelect = document.getElementById('calendar-role-filter');
    const locationSelect = document.getElementById('calendar-location-filter');
    state.ui.calendar.search = searchInput?.value || '';
    state.ui.calendar.day = daySelect?.value || 'All';
    state.ui.calendar.agentName = agentNameSelect?.value || '';
    state.ui.calendar.date = dateInput?.value || '';
    state.ui.calendar.agentId = agentSelect?.value || 'All';
    state.ui.calendar.role = roleSelect?.value || 'All';
    state.ui.calendar.location = locationSelect?.value || 'All';
    saveUiState();
    render();
  });

  document.getElementById('calendar-filters-reset')?.addEventListener('click', () => {
    state.ui.calendar.search = '';
    state.ui.calendar.day = 'All';
    state.ui.calendar.agentId = 'All';
    state.ui.calendar.role = 'All';
    state.ui.calendar.agentName = '';
    state.ui.calendar.date = '';
    state.ui.calendar.weekReference = '';
    state.ui.calendar.location = 'All';
    saveUiState();
    render();
  });

  document.getElementById('calendar-week-reference')?.addEventListener('change', (event) => {
    state.ui.calendar.weekReference = event.target.value || '';
    saveUiState();
    render();
  });

  document.getElementById('calendar-previous-week')?.addEventListener('click', () => {
    state.ui.calendar.weekReference = getShiftedWeekReference(getActiveCalendarWeekReference(), -7);
    saveUiState();
    render();
  });

  document.getElementById('calendar-current-week')?.addEventListener('click', () => {
    state.ui.calendar.weekReference = new Date().toISOString().slice(0, 10);
    saveUiState();
    render();
  });

  document.getElementById('calendar-next-week')?.addEventListener('click', () => {
    state.ui.calendar.weekReference = getShiftedWeekReference(getActiveCalendarWeekReference(), 7);
    saveUiState();
    render();
  });

  document.getElementById('weekly-week-reference')?.addEventListener('change', (event) => {
    state.ui.calendar.weekReference = event.target.value || '';
    saveUiState();
    render();
  });

  document.getElementById('weekly-previous-week')?.addEventListener('click', () => {
    state.ui.calendar.weekReference = getShiftedWeekReference(getActiveCalendarWeekReference(), -7);
    saveUiState();
    render();
  });

  document.getElementById('weekly-current-week')?.addEventListener('click', () => {
    state.ui.calendar.weekReference = new Date().toISOString().slice(0, 10);
    saveUiState();
    render();
  });

  document.getElementById('weekly-next-week')?.addEventListener('click', () => {
    state.ui.calendar.weekReference = getShiftedWeekReference(getActiveCalendarWeekReference(), 7);
    saveUiState();
    render();
  });

  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearSession();
    render();
  });

  document.getElementById('agent-update-phone-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const formData = new FormData(event.currentTarget);
    const phone = normalizePhone(formData.get('phone'));
    if (!phone) {
      alert('Phone number is required.');
      return;
    }

    authUsers = authUsers.map((user) => user.id === currentUser.id ? { ...user, phone } : user);
    saveAuthUsers();
    alert('Phone number updated successfully.');
    render();
  });

  document.getElementById('copy-agent-calendar-sync-url')?.addEventListener('click', async () => {
    const input = document.getElementById('agent-calendar-sync-url');
    const syncUrl = input instanceof HTMLInputElement ? input.value : '';
    if (!syncUrl) {
      alert('No calendar sync URL is available yet.');
      return;
    }
    const didCopy = await copyTextValue(syncUrl);
    if (!didCopy) {
      alert('Unable to copy automatically. Please copy the URL manually.');
      return;
    }
    alert('Calendar sync URL copied.');
  });

  document.querySelectorAll('[data-role-color]').forEach((input) => {
    input.addEventListener('input', () => {
      const roleName = String(input.getAttribute('data-role-color') || '').trim().toLowerCase();
      if (!roleName) return;
      state.roleColors = {
        ...(state.roleColors || {}),
        [roleName]: input.value
      };
      saveState();
      render();
    });
  });

  document.getElementById('reset-role-colors')?.addEventListener('click', () => {
    state.roleColors = {};
    saveState();
    render();
  });

  document.getElementById('export-data-btn')?.addEventListener('click', exportData);
  document.getElementById('import-data-input')?.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (file) importData(file);
  });

  document.querySelectorAll('[data-remove-agent]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-remove-agent'));
      const agent = getAgent(id);
      if (!agent) return;
      const linkedShiftCount = state.shifts.filter((shift) => Number(shift.agentId) === id).length;
      const linkedSwapCount = state.swapRequests.filter((request) => Number(request.fromAgentId) === id || Number(request.toAgentId) === id).length;
      const shouldDelete = confirm(
        `Delete agent ${agent.name}? This will also remove ${linkedShiftCount} shift${linkedShiftCount === 1 ? '' : 's'} and ${linkedSwapCount} swap request${linkedSwapCount === 1 ? '' : 's'}.`
      );
      if (!shouldDelete) return;

      state.agents = state.agents.filter((agent) => Number(agent.id) !== id);
      state.shifts = state.shifts.filter((shift) => Number(shift.agentId) !== id);
      state.swapRequests = state.swapRequests.filter((request) => Number(request.fromAgentId) !== id && Number(request.toAgentId) !== id);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-update-agent]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = Number(form.getAttribute('data-update-agent'));
      const formData = new FormData(form);
      const name = formData.get('name')?.toString().trim();
      const email = normalizeEmail(formData.get('email'));
      const team = normalizeTeamLabel(formData.get('team')?.toString().trim() || teamOptions[0]);
      const payRateRaw = formData.get('payRate')?.toString().trim() || '0';
      const payRate = parseCurrencyAmount(payRateRaw);
      const minHours = normalizeMinHours(formData.get('minHours'));
      const maxHours = normalizeMaxHours(formData.get('maxHours'));
      if (!name || !email) {
        alert('Name and email are required for each agent.');
        return;
      }
      if (!Number.isFinite(payRate) || payRate < 0) {
        alert('Pay rate must be a valid non-negative amount (example: $15.45).');
        return;
      }
      if (Number.isFinite(maxHours) && maxHours < minHours) {
        alert('Maximum hours must be greater than or equal to minimum hours.');
        return;
      }
      const emailInUse = authUsers.some((user) => normalizeEmail(user.email) === email && Number(user.agentId) !== id);
      if (emailInUse) {
        alert('That email is already in use by another account.');
        return;
      }
      state.agents = state.agents.map((agent) => Number(agent.id) === id
        ? {
            ...agent,
            id,
            name,
            email,
            team,
            payRate,
            minHours,
            maxHours
          }
        : agent);

      const existingAgentUser = getUserByAgentId(id);
      if (existingAgentUser) {
        authUsers = authUsers.map((user) => user.id === existingAgentUser.id
          ? {
              ...user,
              email
            }
          : user);
      } else {
        authUsers.push(withRequiredEmail({
          id: createId(),
          username: createUniqueAgentUsername(email),
          email,
          phone: '',
          password: createTemporaryPassword(),
          mustChangePassword: true,
          calendarFeedToken: createCalendarFeedToken(),
          role: 'agent',
          agentId: id
        }));
      }
      saveAuthUsers();
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-resend-agent-invite]').forEach((button) => {
    button.addEventListener('click', () => {
      const agentId = Number(button.getAttribute('data-resend-agent-invite'));
      const agent = getAgent(agentId);
      const agentUser = getUserByAgentId(agentId);
      if (!agent || !agentUser?.email) {
        alert('This agent needs a valid email before sending an invite.');
        return;
      }
      const temporaryPassword = createTemporaryPassword();
      authUsers = authUsers.map((user) => user.id === agentUser.id
        ? {
            ...user,
            password: temporaryPassword,
            mustChangePassword: true
          }
        : user);
      saveAuthUsers();
      const refreshedAgentUser = getUserByAgentId(agentId) || { ...agentUser, password: temporaryPassword, mustChangePassword: true };
      const inviteResult = sendAgentInviteEmail(refreshedAgentUser, agent.name, temporaryPassword);
      const outboxCount = loadEmailOutbox().length;
      if (inviteResult?.deliveryStatus === 'local-only') {
        alert(`Invite was queued in Email outbox (local-only) because webhook delivery is not enabled. Configure Admin Profile > Email delivery to send real emails.\n\nTemporary password: ${inviteResult?.temporaryPassword || temporaryPassword}\nSign-in link: ${inviteResult?.signInLink || getAppLoginUrl()}`);
      } else {
        alert(`Invite email queued for delivery. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.`);
      }
      render();
    });
  });

  document.getElementById('agent-availability-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!(formElement instanceof HTMLFormElement)) return;
    formElement.dataset.availabilityHandled = '1';
    submitAvailabilityRequest(formElement);
  });

  document.querySelectorAll('[data-remove-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-remove-shift'));
      const shift = state.shifts.find((item) => Number(item.id) === id);
      if (!shift) return;
      const shouldDelete = confirm(
        `Delete this shift for ${getAgent(shift.agentId)?.name || 'the assigned agent'} on ${shift.date || shift.day || 'selected date'} (${formatTimeRange(shift.start, shift.end)})?`
      );
      if (!shouldDelete) return;

      selectedCalendarShiftIds.delete(id);
      state.shifts = state.shifts.filter((shift) => shift.id !== id);
      state.swapRequests = state.swapRequests.filter((request) => request.shiftId !== id);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-toggle-shift-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-toggle-shift-select'));
      if (!id) return;
      if (selectedCalendarShiftIds.has(id)) {
        selectedCalendarShiftIds.delete(id);
      } else {
        selectedCalendarShiftIds.add(id);
      }
      render();
    });
  });

  document.querySelector('[data-select-visible-shifts]')?.addEventListener('click', () => {
    selectedCalendarShiftIds = new Set(getFilteredCalendarShifts().map((shift) => Number(shift.id)));
    render();
  });

  document.querySelector('[data-clear-selected-shifts]')?.addEventListener('click', () => {
    selectedCalendarShiftIds.clear();
    render();
  });

  document.querySelector('[data-publish-selected-shifts]')?.addEventListener('click', () => {
    if (selectedCalendarShiftIds.size === 0) return;
    const shiftsToNotify = state.shifts
      .filter((shift) => selectedCalendarShiftIds.has(Number(shift.id)) && shift.status !== shiftStatuses.published)
      .map((shift) => ({ ...shift, status: shiftStatuses.published }));

    state.shifts = state.shifts.map((shift) => (selectedCalendarShiftIds.has(Number(shift.id))
      ? { ...shift, status: shiftStatuses.published }
      : shift));

    shiftsToNotify.forEach((shift) => {
      sendShiftPublishedEmail(shift);
    });

    saveState();
    render();
  });

  document.querySelector('[data-remove-selected-shifts]')?.addEventListener('click', () => {
    if (selectedCalendarShiftIds.size === 0) return;
    const selectedCount = selectedCalendarShiftIds.size;
    const shouldDelete = confirm(`Delete ${selectedCount} selected shift${selectedCount === 1 ? '' : 's'}?`);
    if (!shouldDelete) return;

    const selectedIds = new Set(Array.from(selectedCalendarShiftIds));
    state.shifts = state.shifts.filter((shift) => !selectedIds.has(Number(shift.id)));
    state.swapRequests = state.swapRequests.filter((request) => !selectedIds.has(Number(request.shiftId)));
    selectedCalendarShiftIds.clear();
    saveState();
    render();
  });

  document.querySelectorAll('[data-edit-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-edit-shift'));
      const shift = state.shifts.find((item) => item.id === id);
      if (!shift) return;
      openShiftEditModal(shift, (updatedShift) => {
        const shouldNotify = shift.status !== shiftStatuses.published && updatedShift.status === shiftStatuses.published;
        state.shifts = state.shifts.map((item) => item.id === id ? updatedShift : item);
        if (shouldNotify) {
          sendShiftPublishedEmail(updatedShift);
        }
        saveState();
        render();
      });
    });
  });

  document.querySelectorAll('[data-publish-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-publish-shift'));
      const shiftToPublish = state.shifts.find((shift) => shift.id === id);
      if (!shiftToPublish) return;

      state.shifts = state.shifts.map((shift) => shift.id === id ? { ...shift, status: shiftStatuses.published } : shift);
      if (shiftToPublish.status !== shiftStatuses.published) {
        sendShiftPublishedEmail({ ...shiftToPublish, status: shiftStatuses.published });
      }
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-approve-availability-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-approve-availability-request'));
      const allAvailabilityRequests = getAllAvailabilityRequests();
      const request = allAvailabilityRequests.find((item) => item.id === id);
      if (!request) return;
      state.agents = state.agents.map((agent) => agent.id === request.agentId
        ? {
            ...agent,
            availability: 'Unavailable'
          }
        : agent);
      const nextAvailabilityRequests = allAvailabilityRequests.map((item) => item.id === id ? { ...item, status: 'approved' } : item);
      saveAvailabilityRequests(nextAvailabilityRequests);
      saveState();
      const requestOwner = getUserByAgentId(request.agentId);
      const recipientEmail = request.requesterEmail || requestOwner?.email || '';
      const recipientName = request.requesterName || requestOwner?.username || 'Agent';
      if (recipientEmail) {
        sendEmailNotification({
          to: recipientEmail,
          subject: 'Unavailability request approved',
          body: `Hi ${recipientName}, your unavailability request for ${request.unavailableDate || 'the selected date'} (${formatTimeRange(request.unavailableStart, request.unavailableEnd)}) has been approved.`,
          type: 'availability-approved'
        });
      }
      const outboxCount = loadEmailOutbox().length;
      alert(`Request approved. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.`);
      render();
    });
  });

  document.querySelectorAll('[data-reject-availability-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-reject-availability-request'));
      const allAvailabilityRequests = getAllAvailabilityRequests();
      const nextAvailabilityRequests = allAvailabilityRequests.map((item) => item.id === id ? { ...item, status: 'rejected' } : item);
      saveAvailabilityRequests(nextAvailabilityRequests);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-approve-swap-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-approve-swap-request'));
      const currentUser = getCurrentUser();
      const currentAgentId = Number(currentUser?.agentId);
      if (!currentAgentId) return;

      state.swapRequests = state.swapRequests.map((request) => {
        if (request.id !== id || request.status !== 'pending') return request;
        if (request.fromAgentId === currentAgentId && !request.fromApproved) {
          return { ...request, fromApproved: true };
        }
        if (request.toAgentId === currentAgentId && !request.toApproved) {
          return { ...request, toApproved: true };
        }
        return request;
      });

      const updatedRequest = state.swapRequests.find((request) => request.id === id);
      if (updatedRequest?.status === 'pending' && updatedRequest.fromApproved && updatedRequest.toApproved) {
        state.shifts = state.shifts.map((shift) => shift.id === updatedRequest.shiftId ? { ...shift, agentId: updatedRequest.toAgentId } : shift);
        state.swapRequests = state.swapRequests.map((request) => request.id === id
          ? { ...request, status: 'completed', completedAt: new Date().toISOString() }
          : request);
      }

      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-reject-swap-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-reject-swap-request'));
      const currentUser = getCurrentUser();
      const currentAgentId = Number(currentUser?.agentId);
      if (!currentAgentId) return;

      state.swapRequests = state.swapRequests.map((request) => {
        if (request.id !== id || request.status !== 'pending') return request;
        if (request.fromAgentId !== currentAgentId && request.toAgentId !== currentAgentId) return request;
        return {
          ...request,
          status: 'rejected',
          rejectedBy: currentAgentId,
          rejectedAt: new Date().toISOString()
        };
      });

      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-copy-shift]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const id = Number(button.getAttribute('data-copy-shift'));
      const shift = state.shifts.find((item) => item.id === id);
      if (!shift) return;
      copiedShiftTemplate = { ...shift };
      render();
    });
  });

  document.querySelectorAll('[data-duplicate-shift]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const id = Number(button.getAttribute('data-duplicate-shift'));
      const shift = state.shifts.find((item) => item.id === id);
      if (!shift) return;
      const duplicatedShift = cloneShift(shift);
      if (!confirmShiftAssignmentWithTimeOffWarning(duplicatedShift.agentId, duplicatedShift.date, duplicatedShift.start, duplicatedShift.end, {
        durationHours: duplicatedShift.durationHours
      })) return;
      state.shifts.push(duplicatedShift);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-paste-shift-day]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const day = button.getAttribute('data-paste-shift-day');
      if (!copiedShiftTemplate || !day) return;
      const pastedShift = cloneShift(copiedShiftTemplate, day);
      if (!confirmShiftAssignmentWithTimeOffWarning(pastedShift.agentId, pastedShift.date, pastedShift.start, pastedShift.end, {
        durationHours: pastedShift.durationHours
      })) return;
      state.shifts.push(pastedShift);
      saveState();
      render();
    });
  });

  document.querySelectorAll('.shift').forEach((shiftElement) => {
    shiftElement.addEventListener('dragstart', (event) => {
      draggedShiftId = Number(shiftElement.getAttribute('data-shift-id'));
      event.dataTransfer?.setData('text/plain', String(draggedShiftId));
    });
    shiftElement.addEventListener('dragend', () => {
      draggedShiftId = null;
      document.querySelectorAll('.day-card').forEach((card) => card.classList.remove('drag-over'));
    });
  });

  document.querySelectorAll('.day-card').forEach((card) => {
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('drag-over');
      const shiftId = draggedShiftId ?? Number(event.dataTransfer?.getData('text/plain'));
      if (!shiftId) return;

      const shiftToMove = state.shifts.find((shift) => Number(shift.id) === Number(shiftId));
      if (!shiftToMove) return;

      const targetDay = card.getAttribute('data-day') || shiftToMove.day;
      const targetDate = card.getAttribute('data-date') || shiftToMove.date || '';
      const movedToNewDate = String(shiftToMove.date || '') !== String(targetDate || '');

      if (movedToNewDate && !confirmShiftAssignmentWithTimeOffWarning(shiftToMove.agentId, targetDate, shiftToMove.start, shiftToMove.end, {
        replacingShiftId: Number(shiftToMove.id),
        durationHours: Number(shiftToMove.durationHours) || getDurationHours(shiftToMove.start, shiftToMove.end)
      })) {
        return;
      }

      state.shifts = state.shifts.map((shift) => shift.id === shiftId
        ? {
            ...shift,
            day: targetDay,
            date: targetDate || shift.date
          }
        : shift);
      saveState();
      render();
    });
  });
}

void initializeBackendSync().finally(() => {
  render();
  if (backendApiBase) {
    window.setInterval(() => {
      void pollBackendSync();
    }, 5000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void pollBackendSync();
      }
    });

    window.addEventListener('focus', () => {
      void pollBackendSync();
    });

    window.addEventListener('online', () => {
      void pollBackendSync();
    });
  }
});
