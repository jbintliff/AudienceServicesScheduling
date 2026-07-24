const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const roleOptions = ['In-person', 'WFH', 'Booth Duty', 'Booth Duty (Form)', 'Booth Duty Back-up'];
const teamOptions = ['Audience Services Representative', 'Audience Services Associate', 'Audience Services Management'];
const agentSkillOptions = [
  { value: 'single-tickets', label: 'Single tickets' },
  { value: 'subscrptions', label: 'Subscrptions' },
  { value: 'emails', label: 'Emails' },
  { value: 'booth-duty', label: 'Booth duty' },
  { value: 'groups', label: 'Groups' }
];
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
const profilePhotosKey = 'agent-scheduler-profile-photos-v1';
const maxPolicyUploadBytes = 25 * 1024 * 1024;
const policyFilesDbName = 'agent-scheduler-policy-files-v1';
const policyFilesStoreName = 'policy-files';
const backendUrlKey = 'agent-scheduler-backend-url-v1';
const appLoginUrlKey = 'agent-scheduler-app-login-url-v1';
const syncStatusKey = 'agent-scheduler-sync-status-v1';
const uiStateKey = 'agent-scheduler-ui-state-v1';
const fixedEmailSenderName = 'Audience Services Manager';
const emailDeliveryProviders = ['generic', 'sendgrid', 'mailgun'];
const agentPasswordMaxAgeDays = 90;
const defaultPasswordUpdatedAt = '2026-01-01T00:00:00.000Z';
const shiftStatuses = {
  draft: 'draft',
  published: 'published'
};
const shiftAbsenceReasonOptions = ['sick', 'emergency', 'no reason', 'transportation issue'];
const userRoles = {
  admin: 'admin',
  agent: 'agent',
  teamLead: 'team-lead'
};
const defaultBackendApiBase = 'https://scheduling-app-backend-l66q.onrender.com/api';
const sharedStorageKeys = [
  storageKey,
  authUsersKey,
  availabilityRequestsKey,
  availabilityInboxKey,
  availabilityRequestLedgerKey,
  passwordResetRequestsKey,
  appLoginUrlKey,
  profilePhotosKey,
  emailOutboxKey,
  emailDeliverySettingsKey
];
let policyFilesDbPromise = null;

function openPolicyFilesDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (policyFilesDbPromise) {
    return policyFilesDbPromise;
  }
  policyFilesDbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(policyFilesDbName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(policyFilesStoreName)) {
          database.createObjectStore(policyFilesStoreName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return policyFilesDbPromise;
}

function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (!source.length) return '';
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < source.length; index += chunkSize) {
    const chunk = source.subarray(index, Math.min(source.length, index + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64Value) {
  const base64 = String(base64Value || '').trim();
  if (!base64) return null;
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function savePolicyFileBytes(policyId, mimeType, bytes) {
  const normalizedId = String(policyId || '').trim();
  if (!normalizedId || !(bytes instanceof Uint8Array) || bytes.length === 0) {
    return false;
  }
  const database = await openPolicyFilesDb();
  const normalizedMimeType = String(mimeType || 'application/octet-stream').trim() || 'application/octet-stream';

  if (!database) {
    return uploadPolicyFileToBackend(normalizedId, normalizedMimeType, bytes);
  }

  const didSaveLocal = await new Promise((resolve) => {
    try {
      const transaction = database.transaction(policyFilesStoreName, 'readwrite');
      const store = transaction.objectStore(policyFilesStoreName);
      store.put({
        id: normalizedId,
        mimeType: normalizedMimeType,
        bytes,
        updatedAt: getCurrentIsoTimestamp()
      });
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });

  if (!didSaveLocal) return false;
  if (!isApplyingRemoteSnapshot && backendApiBase) {
    const didSyncRemote = await uploadPolicyFileToBackend(normalizedId, normalizedMimeType, bytes);
    if (!didSyncRemote) {
      return false;
    }
  }
  return true;
}

async function loadPolicyFileBytes(policyId) {
  const normalizedId = String(policyId || '').trim();
  if (!normalizedId) return null;
  const database = await openPolicyFilesDb();

  if (database) {
    const localBytes = await new Promise((resolve) => {
      try {
        const transaction = database.transaction(policyFilesStoreName, 'readonly');
        const store = transaction.objectStore(policyFilesStoreName);
        const request = store.get(normalizedId);
        request.onsuccess = () => {
          const record = request.result;
          if (record?.bytes instanceof Uint8Array) {
            resolve(record.bytes);
            return;
          }
          if (record?.bytes instanceof ArrayBuffer) {
            resolve(new Uint8Array(record.bytes));
            return;
          }
          resolve(null);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (localBytes && localBytes.length > 0) {
      return localBytes;
    }
  }

  const remoteFile = await fetchPolicyFileFromBackend(normalizedId);
  if (!remoteFile?.bytes || remoteFile.bytes.length === 0) {
    return null;
  }
  if (database) {
    await savePolicyFileBytes(normalizedId, remoteFile.mimeType || 'application/octet-stream', remoteFile.bytes);
  }
  return remoteFile.bytes;
}

async function deletePolicyFileBytes(policyId) {
  const normalizedId = String(policyId || '').trim();
  if (!normalizedId) return true;
  const database = await openPolicyFilesDb();
  if (!database) {
    return deletePolicyFileFromBackend(normalizedId);
  }

  const didDeleteLocal = await new Promise((resolve) => {
    try {
      const transaction = database.transaction(policyFilesStoreName, 'readwrite');
      const store = transaction.objectStore(policyFilesStoreName);
      store.delete(normalizedId);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  if (!didDeleteLocal) return false;
  void deletePolicyFileFromBackend(normalizedId);
  return true;
}

function sanitizePoliciesForStorage(policies) {
  return (Array.isArray(policies) ? policies : [])
    .map((policy) => ({
      id: Number(policy?.id) || createId(),
      name: String(policy?.name || '').trim(),
      mimeType: String(policy?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
      sizeBytes: Number(policy?.sizeBytes) || 0,
      uploadedAt: String(policy?.uploadedAt || '').trim() || getCurrentIsoTimestamp()
    }))
    .filter((policy) => policy.name);
}

async function migrateLegacyPolicyContentToIndexedDb() {
  const policies = Array.isArray(state.policies) ? state.policies : [];
  if (!policies.length) return;
  let didMigrateAny = false;

  for (const policy of policies) {
    const policyId = Number(policy?.id) || 0;
    if (!policyId) continue;
    const existingBytes = await loadPolicyFileBytes(policyId);
    if (existingBytes && existingBytes.length > 0) continue;
    const legacyBase64 = String(policy?.legacyContentBase64 || policy?.contentBase64 || '').trim();
    if (!legacyBase64) continue;
    const legacyBytes = base64ToBytes(legacyBase64);
    if (!legacyBytes) continue;
    const didSave = await savePolicyFileBytes(policyId, policy?.mimeType || 'application/octet-stream', legacyBytes);
    if (didSave) {
      didMigrateAny = true;
    }
  }

  if (didMigrateAny) {
    state.policies = sanitizePoliciesForStorage(state.policies);
    saveState();
  }
}

function normalizeBackendUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function getCurrentIsoTimestamp() {
  return new Date().toISOString();
}

function getTimestampScore(value) {
  const parsed = new Date(String(value || ''));
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getAuthUserPrimaryUpdatedAtScore(user) {
  const candidateValues = [user?.profileUpdatedAt, user?.updatedAt, user?.createdAt];
  let best = 0;
  candidateValues.forEach((value) => {
    const timestamp = getTimestampScore(value);
    if (timestamp > best) {
      best = timestamp;
    }
  });
  return best;
}

function getAuthUserPasswordUpdatedAtScore(user) {
  return getTimestampScore(user?.passwordUpdatedAt);
}

function parseAuthUsersForMerge(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeAuthUsersSnapshotByRecency(localRawValue, remoteRawValue) {
  const localUsers = parseAuthUsersForMerge(localRawValue);
  const remoteUsers = parseAuthUsersForMerge(remoteRawValue);
  const mergedById = new Map();

  remoteUsers.forEach((user) => {
    const id = String(user?.id ?? '');
    if (!id) return;
    mergedById.set(id, user);
  });

  localUsers.forEach((localUser) => {
    const id = String(localUser?.id ?? '');
    if (!id) return;
    const remoteUser = mergedById.get(id);
    if (!remoteUser) {
      mergedById.set(id, localUser);
      return;
    }

    // Prefer explicit profile/account update timestamps over password-only timestamps.
    const localPrimaryScore = getAuthUserPrimaryUpdatedAtScore(localUser);
    const remotePrimaryScore = getAuthUserPrimaryUpdatedAtScore(remoteUser);
    if (localPrimaryScore > 0 || remotePrimaryScore > 0) {
      if (localPrimaryScore >= remotePrimaryScore) {
        mergedById.set(id, localUser);
      }
      return;
    }

    const localScore = getAuthUserPasswordUpdatedAtScore(localUser);
    const remoteScore = getAuthUserPasswordUpdatedAtScore(remoteUser);
    if (localScore >= remoteScore) {
      mergedById.set(id, localUser);
    }
  });

  return JSON.stringify(Array.from(mergedById.values()));
}

function parseProfilePhotosForMerge(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function mergeProfilePhotosSnapshotByRecency(localPhotosRawValue, remotePhotosRawValue, localAuthUsersRawValue, remoteAuthUsersRawValue) {
  const localPhotos = parseProfilePhotosForMerge(localPhotosRawValue);
  const remotePhotos = parseProfilePhotosForMerge(remotePhotosRawValue);
  const localUsersById = new Map(parseAuthUsersForMerge(localAuthUsersRawValue).map((user) => [String(user?.id ?? ''), user]));
  const remoteUsersById = new Map(parseAuthUsersForMerge(remoteAuthUsersRawValue).map((user) => [String(user?.id ?? ''), user]));

  const mergedPhotos = { ...remotePhotos };
  const allIds = new Set([...Object.keys(localPhotos), ...Object.keys(remotePhotos)]);

  allIds.forEach((id) => {
    if (!id) return;
    const localPhoto = String(localPhotos[id] || '').trim();
    const remotePhoto = String(remotePhotos[id] || '').trim();
    if (localPhoto === remotePhoto) {
      if (localPhoto) {
        mergedPhotos[id] = localPhoto;
      } else {
        delete mergedPhotos[id];
      }
      return;
    }

    const localUser = localUsersById.get(id);
    const remoteUser = remoteUsersById.get(id);
    const localScore = getAuthUserPrimaryUpdatedAtScore(localUser);
    const remoteScore = getAuthUserPrimaryUpdatedAtScore(remoteUser);

    if (localScore > remoteScore) {
      if (localPhoto) {
        mergedPhotos[id] = localPhoto;
      } else {
        delete mergedPhotos[id];
      }
      return;
    }
    if (remoteScore > localScore) {
      if (remotePhoto) {
        mergedPhotos[id] = remotePhoto;
      } else {
        delete mergedPhotos[id];
      }
      return;
    }

    // Fallback when timestamps are equal or missing: prefer the side that still has photo data.
    if (localPhoto && !remotePhoto) {
      mergedPhotos[id] = localPhoto;
    } else if (!localPhoto && remotePhoto) {
      mergedPhotos[id] = remotePhoto;
    } else if (localPhoto && remotePhoto) {
      mergedPhotos[id] = localPhoto.length >= remotePhoto.length ? localPhoto : remotePhoto;
    } else {
      delete mergedPhotos[id];
    }
  });

  return JSON.stringify(mergedPhotos);
}

function normalizePasswordUpdatedAt(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return defaultPasswordUpdatedAt;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return defaultPasswordUpdatedAt;
  return parsed.toISOString();
}

function isAgentPasswordExpired(user) {
  if (!isAgentLikeUser(user)) return false;
  const updatedAt = normalizePasswordUpdatedAt(user?.passwordUpdatedAt);
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return false;
  const expiresAt = new Date(parsed.getTime() + (agentPasswordMaxAgeDays * 24 * 60 * 60 * 1000));
  return Date.now() >= expiresAt.getTime();
}

function normalizeAppLoginUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    if (!parsed.pathname || parsed.pathname.endsWith('/')) {
      parsed.pathname = `${parsed.pathname || '/'}index.html`.replace(/\/+/g, '/');
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function loadConfiguredAppLoginUrl() {
  const fromWindow = normalizeAppLoginUrl(window.__SCHEDULER_APP_LOGIN_URL__);
  if (fromWindow) return fromWindow;
  return normalizeAppLoginUrl(localStorage.getItem(appLoginUrlKey));
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
  if (queryMode === 'pending-requests') return 'pending-requests';
  if (queryMode === 'agent-requests') return 'agent-requests';
  if (queryMode === 'profile') return 'profile';
  if (queryMode === 'email-outbox') return 'email-outbox';
  if (queryMode === 'availability-requests') return 'availability-requests';
  if (queryMode === 'admin-options') return 'admin-options';
  if (queryMode === 'policies') return 'policies';
  const mode = document.body?.dataset?.page;
  if (mode === 'calendar') return 'calendar';
  if (mode === 'agents') return 'agents';
  if (mode === 'pending-requests') return 'pending-requests';
  if (mode === 'agent-requests') return 'agent-requests';
  if (mode === 'profile') return 'profile';
  if (mode === 'email-outbox') return 'email-outbox';
  if (mode === 'availability-requests') return 'availability-requests';
  if (mode === 'admin-options') return 'admin-options';
  if (mode === 'policies') return 'policies';
  return 'dashboard';
})();

const defaultState = {
  agents: [
    { id: 1, name: 'Maya', email: 'maya@scheduler.local', team: 'Audience Services Representative', role: 'In-person', payRate: 24, attendancePoints: 0, maxInOfficeShifts: null, availability: 'Available' },
    { id: 2, name: 'Luis', email: 'luis@scheduler.local', team: 'Audience Services Associate', role: 'WFH', payRate: 18, attendancePoints: 0, maxInOfficeShifts: null, availability: 'Available' },
    { id: 3, name: 'Nina', email: 'nina@scheduler.local', team: 'Audience Services Representative', role: 'Booth Duty', payRate: 15, attendancePoints: 0, maxInOfficeShifts: null, availability: 'Unavailable' }
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
  policies: [],
  blackoutDates: [],
  roleColors: {},
  roleCatalog: [...roleOptions],
  locationCatalog: [...shiftLocationOptions],
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
    availabilityAllDate: '',
    availabilityAllFrom: '',
    availabilityAllTo: '',
    availabilityAllAgentId: 'All',
    availabilityAllStatus: 'All',
    availabilityAllRequestsHidden: false,
    availabilitySwapDate: '',
    availabilitySwapFrom: '',
    availabilitySwapTo: '',
    availabilitySwapAgentId: 'All',
    availabilitySwapStatus: 'All',
    availabilitySwapRequestsHidden: false,
    availabilityDebugToolsVisible: false,
    availabilityDebugAgentId: '',
    swapRequestToAgentId: '',
    swapRequestToShiftId: '',
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
  { id: 1001, username: 'admin', name: 'System Admin', jobTitle: 'Scheduling Administrator', email: 'admin@scheduler.local', phone: '215-555-0100', password: 'Admin123!', passwordUpdatedAt: defaultPasswordUpdatedAt, role: userRoles.admin },
  { id: 1002, username: 'maya', email: 'maya@scheduler.local', phone: '215-555-0101', password: 'Agent123!', passwordUpdatedAt: defaultPasswordUpdatedAt, role: userRoles.agent, agentId: 1 },
  { id: 1003, username: 'luis', email: 'luis@scheduler.local', phone: '215-555-0102', password: 'Agent123!', passwordUpdatedAt: defaultPasswordUpdatedAt, role: userRoles.agent, agentId: 2 },
  { id: 1004, username: 'nina', email: 'nina@scheduler.local', phone: '215-555-0103', password: 'Agent123!', passwordUpdatedAt: defaultPasswordUpdatedAt, role: userRoles.agent, agentId: 3 }
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
const pendingSharedWriteKeys = new Set();
let adminManagerNotice = null;
let adminProfileNotice = null;
const attemptedResetTokenLookups = new Set();
let activePolicyPreviewBlobUrl = '';
let activePolicyPreviewRequestId = 0;
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

function normalizeOptionCatalog(values, fallbackValues = []) {
  const source = Array.isArray(values) ? values : [];
  const normalized = source
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const fallback = Array.isArray(fallbackValues)
    ? fallbackValues.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
}

function normalizeRoleCatalog(values) {
  return normalizeOptionCatalog(values, roleOptions);
}

function normalizeShiftAbsenceReason(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return shiftAbsenceReasonOptions.includes(normalized) ? normalized : '';
}

function normalizeUserRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === userRoles.admin) return userRoles.admin;
  if (normalized === userRoles.teamLead || normalized === 'absence-manager') return userRoles.teamLead;
  return userRoles.agent;
}

function isAdminUser(user) {
  return normalizeUserRole(user?.role) === userRoles.admin;
}

function isAgentUser(user) {
  return normalizeUserRole(user?.role) === userRoles.agent;
}

function isTeamLeadUser(user) {
  return normalizeUserRole(user?.role) === userRoles.teamLead;
}

function isAgentLikeUser(user) {
  return isAgentUser(user) || isTeamLeadUser(user);
}

function isAbsenceManagerUser(user) {
  return isTeamLeadUser(user);
}

function canMarkShiftAbsences(user) {
  return isAdminUser(user) || isTeamLeadUser(user);
}

function canManageSchedule(user) {
  return isAdminUser(user);
}

function normalizeLocationCatalog(values) {
  return normalizeOptionCatalog(values, shiftLocationOptions);
}

function getRoleCatalog() {
  return normalizeRoleCatalog(state?.roleCatalog);
}

function getPrimaryRole() {
  return getRoleCatalog()[0] || roleOptions[0];
}

function getLocationCatalog() {
  return normalizeLocationCatalog(state?.locationCatalog);
}

function isTemplateActive(template) {
  return template?.active !== false;
}

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
    availabilityAllDate: '',
    availabilityAllFrom: '',
    availabilityAllTo: '',
    availabilityAllAgentId: 'All',
    availabilityAllStatus: 'All',
    availabilityAllRequestsHidden: false,
    availabilitySwapDate: '',
    availabilitySwapFrom: '',
    availabilitySwapTo: '',
    availabilitySwapAgentId: 'All',
    availabilitySwapStatus: 'All',
    availabilitySwapRequestsHidden: false,
    availabilityDebugToolsVisible: false,
    availabilityDebugAgentId: '',
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
    availabilityAllDate: source?.availabilityAllDate || defaults.availabilityAllDate,
    availabilityAllFrom: source?.availabilityAllFrom || defaults.availabilityAllFrom,
    availabilityAllTo: source?.availabilityAllTo || defaults.availabilityAllTo,
    availabilityAllAgentId: source?.availabilityAllAgentId || defaults.availabilityAllAgentId,
    availabilityAllStatus: source?.availabilityAllStatus || defaults.availabilityAllStatus,
    availabilityAllRequestsHidden: Boolean(source?.availabilityAllRequestsHidden),
    availabilitySwapDate: source?.availabilitySwapDate || defaults.availabilitySwapDate,
    availabilitySwapFrom: source?.availabilitySwapFrom || defaults.availabilitySwapFrom,
    availabilitySwapTo: source?.availabilitySwapTo || defaults.availabilitySwapTo,
    availabilitySwapAgentId: source?.availabilitySwapAgentId || defaults.availabilitySwapAgentId,
    availabilitySwapStatus: source?.availabilitySwapStatus || defaults.availabilitySwapStatus,
    availabilitySwapRequestsHidden: Boolean(source?.availabilitySwapRequestsHidden),
    availabilityDebugToolsVisible: Boolean(source?.availabilityDebugToolsVisible),
    availabilityDebugAgentId: source?.availabilityDebugAgentId || defaults.availabilityDebugAgentId,
    swapRequestToAgentId: source?.swapRequestToAgentId || defaults.swapRequestToAgentId,
    swapRequestToShiftId: source?.swapRequestToShiftId || defaults.swapRequestToShiftId,
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
      pendingSharedWriteKeys.add(key);
      void pushSharedKeyToBackend(key, value).then((didPush) => {
        if (didPush) {
          pendingSharedWriteKeys.delete(key);
        }
      });
    }
    return true;
  } catch {
    return false;
  }
}

async function syncSharedSnapshotToBackend() {
  if (!backendApiBase) return false;
  try {
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
    const didSync = Boolean(response);
    if (didSync) {
      pendingSharedWriteKeys.clear();
      markSyncSuccess();
    }
    return didSync;
  } catch {
    return false;
  }
}

async function requestBackend(path, options = {}) {
  if (!backendApiBase) return null;
  try {
    const method = String(options.method || 'GET').trim().toUpperCase() || 'GET';
    const nextHeaders = {
      ...(options.headers || {})
    };
    const hasBody = options.body !== undefined && options.body !== null;
    const hasContentTypeHeader = Object.keys(nextHeaders).some((headerName) => headerName.toLowerCase() === 'content-type');
    if (hasBody && method !== 'GET' && method !== 'HEAD' && !hasContentTypeHeader) {
      nextHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${backendApiBase}${path}`, {
      ...options,
      method,
      headers: nextHeaders
    });
    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
}

async function uploadPolicyFileToBackend(policyId, mimeType, bytes) {
  if (!backendApiBase || !(bytes instanceof Uint8Array) || bytes.length === 0) return false;
  const response = await requestBackend(`/policy-files/${encodeURIComponent(String(policyId || ''))}`, {
    method: 'PUT',
    body: JSON.stringify({
      mimeType: String(mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
      contentBase64: bytesToBase64(bytes)
    })
  });
  const didSync = Boolean(response);
  if (didSync) {
    markSyncSuccess();
  }
  return didSync;
}

async function fetchPolicyFileFromBackend(policyId) {
  if (!backendApiBase) return null;
  const response = await requestBackend(`/policy-files/${encodeURIComponent(String(policyId || ''))}`);
  if (!response) return null;
  try {
    const payload = await response.json();
    const bytes = base64ToBytes(payload?.contentBase64);
    if (!bytes || bytes.length === 0) return null;
    return {
      mimeType: String(payload?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
      bytes
    };
  } catch {
    return null;
  }
}

async function deletePolicyFileFromBackend(policyId) {
  if (!backendApiBase) return true;
  const response = await requestBackend(`/policy-files/${encodeURIComponent(String(policyId || ''))}`, {
    method: 'DELETE'
  });
  const didDelete = Boolean(response);
  if (didDelete) {
    markSyncSuccess();
  }
  return didDelete;
}

async function pushSharedKeyToBackend(key, rawValue) {
  if (!backendApiBase) return false;
  try {
    const response = await requestBackend(`/store/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: rawValue })
    });
    const ok = Boolean(response);
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
  const didSync = Boolean(response);
  if (didSync) {
    pendingSharedWriteKeys.clear();
  }
  return didSync;
}

function mergeRemoteSnapshotWithPendingLocal(remoteStore) {
  if (!remoteStore || typeof remoteStore !== 'object') {
    return { store: remoteStore, preservedLocalKeys: [] };
  }
  const mergedStore = { ...remoteStore };
  const preservedLocalKeys = [];

  // Auth users are critical for profile persistence; keep the most recently updated version per account.
  const localAuthUsers = localStorage.getItem(authUsersKey);
  const remoteAuthUsers = typeof remoteStore[authUsersKey] === 'string' ? remoteStore[authUsersKey] : null;
  if (localAuthUsers !== null && remoteAuthUsers !== null && localAuthUsers !== remoteAuthUsers) {
    mergedStore[authUsersKey] = mergeAuthUsersSnapshotByRecency(localAuthUsers, remoteAuthUsers);
  }

  // Profile photos are stored separately from auth users; merge by account recency to avoid stale snapshot overwrites.
  const localProfilePhotos = localStorage.getItem(profilePhotosKey);
  const remoteProfilePhotos = typeof remoteStore[profilePhotosKey] === 'string' ? remoteStore[profilePhotosKey] : null;
  const effectiveLocalAuthUsers = localAuthUsers;
  const effectiveRemoteAuthUsers = remoteAuthUsers;
  if (localProfilePhotos !== null && remoteProfilePhotos !== null && localProfilePhotos !== remoteProfilePhotos) {
    mergedStore[profilePhotosKey] = mergeProfilePhotosSnapshotByRecency(
      localProfilePhotos,
      remoteProfilePhotos,
      effectiveLocalAuthUsers,
      effectiveRemoteAuthUsers
    );
  }

  pendingSharedWriteKeys.forEach((key) => {
    const localValue = localStorage.getItem(key);
    const remoteValue = typeof remoteStore[key] === 'string' ? remoteStore[key] : null;
    if (localValue !== null && localValue !== remoteValue) {
      mergedStore[key] = localValue;
      preservedLocalKeys.push(key);
    }
  });
  return { store: mergedStore, preservedLocalKeys };
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
    const mergeResult = mergeRemoteSnapshotWithPendingLocal(remoteStore);
    applyRemoteSnapshot(mergeResult.store);
    lastRemoteSnapshotHash = getSnapshotHash(remoteStore);
    markSyncSuccess();
    syncFromStorage();
    if (mergeResult.preservedLocalKeys.length > 0) {
      const pushed = await pushLocalSnapshotToBackend();
      if (pushed) {
        markSyncSuccess();
      }
    }
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
  const mergeResult = mergeRemoteSnapshotWithPendingLocal(remoteStore);
  applyRemoteSnapshot(mergeResult.store);
  markSyncSuccess();
  if (mergeResult.preservedLocalKeys.length > 0) {
    const pushed = await pushLocalSnapshotToBackend();
    if (pushed) {
      markSyncSuccess();
    }
  }
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
  const didReconcileAgentEmails = reconcileAgentEmailsWithAuthUsers();
  if (didReconcileAgentEmails) {
    saveAuthUsers();
    saveState();
  }
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

function normalizeAvailabilityRequestStatus(value) {
  const normalized = String(value || 'pending').trim().toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected' || normalized === 'denied' || normalized === 'declined') return 'rejected';
  return 'pending';
}

function normalizeAvailabilityRequest(request, fallbackId) {
  if (!request) return null;
  return {
    ...request,
    id: request.id != null ? request.id : fallbackId,
    status: normalizeAvailabilityRequestStatus(request.status),
    requesterEmail: normalizeEmail(request.requesterEmail || ''),
    requesterName: String(request.requesterName || '').trim(),
    requesterUserId: request.requesterUserId != null ? Number(request.requesterUserId) || request.requesterUserId : request.requesterUserId
  };
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
    const normalizedRequest = normalizeAvailabilityRequest(request, requestId);
    if (!normalizedRequest) return;
    byId.set(requestId, normalizedRequest);
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

function isAvailabilityRequestVisibleToUser(request, user) {
  if (!request || !user || !isAgentLikeUser(user)) {
    return false;
  }
  return Boolean(getAvailabilityRequestVisibilityReason(request, user));
}

function getAvailabilityRequestVisibilityReason(request, user) {
  if (!request || !user || !isAgentLikeUser(user)) {
    return '';
  }
  const requestAgentId = Number(request.agentId);
  const userAgentId = Number(user.agentId);
  const requestUserId = Number(request.requesterUserId);
  const currentUserId = Number(user.id);
  const requestEmail = normalizeEmail(request.requesterEmail || '');
  const userEmail = normalizeEmail(user.email || '');

  if (requestAgentId > 0 && requestAgentId === userAgentId) {
    return 'agentId';
  }
  if (requestUserId > 0 && requestUserId === currentUserId) {
    return 'requesterUserId';
  }
  if (requestEmail && userEmail && requestEmail === userEmail) {
    return 'requesterEmail';
  }
  return '';
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
    passwordUpdatedAt: normalizePasswordUpdatedAt(user?.passwordUpdatedAt),
    mustChangePassword: Boolean(user?.mustChangePassword),
    isActive: user?.isActive !== false
  };
}

function loadProfilePhotos() {
  try {
    const saved = localStorage.getItem(profilePhotosKey);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveProfilePhotos(profilePhotos) {
  return safeSetLocalStorage(profilePhotosKey, JSON.stringify(profilePhotos && typeof profilePhotos === 'object' ? profilePhotos : {}));
}

function serializeAuthUsersForStorage(users) {
  return (Array.isArray(users) ? users : []).map((user) => {
    const { profilePhotoDataUrl, ...safeUser } = user || {};
    return safeUser;
  });
}

function loadAuthUsers() {
  try {
    const saved = localStorage.getItem(authUsersKey);
    const storedProfilePhotos = loadProfilePhotos();
    if (!saved) {
      return defaultAuthUsers.map((user) => {
        const normalizedUser = withRequiredEmail(user);
        const userPhoto = storedProfilePhotos[String(normalizedUser?.id || '')] || '';
        return userPhoto ? { ...normalizedUser, profilePhotoDataUrl: userPhoto } : normalizedUser;
      });
    }
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return defaultAuthUsers.map((user) => {
        const normalizedUser = withRequiredEmail(user);
        const userPhoto = storedProfilePhotos[String(normalizedUser?.id || '')] || '';
        return userPhoto ? { ...normalizedUser, profilePhotoDataUrl: userPhoto } : normalizedUser;
      });
    }
    return parsed.map((user) => {
      const normalizedUser = withRequiredEmail(user);
      const userPhoto = normalizedUser?.profilePhotoDataUrl || storedProfilePhotos[String(normalizedUser?.id || '')] || '';
      return userPhoto
        ? { ...normalizedUser, profilePhotoDataUrl: userPhoto }
        : normalizedUser;
    });
  } catch {
    return defaultAuthUsers.map((user) => {
      const normalizedUser = withRequiredEmail(user);
      const userPhoto = storedProfilePhotos[String(normalizedUser?.id || '')] || '';
      return userPhoto ? { ...normalizedUser, profilePhotoDataUrl: userPhoto } : normalizedUser;
    });
  }
}

function saveAuthUsers() {
  // Persist auth users through shared storage so profile edits sync across devices.
  const profilePhotos = (Array.isArray(authUsers) ? authUsers : []).reduce((accumulator, user) => {
    const userId = String(user?.id || '');
    const photoDataUrl = String(user?.profilePhotoDataUrl || '').trim();
    if (userId && photoDataUrl) {
      accumulator[userId] = photoDataUrl;
    }
    return accumulator;
  }, {});
  const didSavePhotos = saveProfilePhotos(profilePhotos);
  const didSave = safeSetLocalStorage(authUsersKey, JSON.stringify(serializeAuthUsersForStorage(authUsers)));
  if (didSave && didSavePhotos && !isApplyingRemoteSnapshot && backendApiBase) {
    // Auth updates are critical for login; push a full snapshot best-effort.
    void pushLocalSnapshotToBackend();
  }
  return didSave && didSavePhotos;
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
      senderName: settings.fromName,
      displayName: settings.fromName,
      replyToName: settings.fromName,
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
  return authUsers.find((user) => isAgentLikeUser(user) && Number(user.agentId) === normalizedId) || null;
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

function shouldSendPublishedScheduleEmails(shiftCount = 1) {
  const total = Math.max(1, Number(shiftCount) || 1);
  if (total === 1) {
    return confirm('Send a published schedule email to the assigned agent?');
  }
  return confirm(`Send published schedule emails to assigned agents for ${total} shifts?`);
}

function sendSwapNotificationEmails(request, mode, actingAgentId = null) {
  const fromAgentId = Number(request?.fromAgentId);
  const toAgentId = Number(request?.toAgentId);
  const fromAgentName = getAgent(fromAgentId)?.name || 'Agent';
  const toAgentName = getAgent(toAgentId)?.name || 'Agent';
  const fromShiftLabel = getSwapRequestShiftLabel(request, 'from');
  const toShiftLabel = getSwapRequestShiftLabel(request, 'to');
  const approvalState = getSwapApprovalText(request);
  const actingAgentName = actingAgentId ? (getAgent(actingAgentId)?.name || 'An agent') : 'An agent';
  const notifications = [
    { agentId: fromAgentId, name: fromAgentName },
    { agentId: toAgentId, name: toAgentName }
  ];

  let subject = 'Swap request update';
  let detail = `${actingAgentName} approved the swap request. Current approval state: ${approvalState}.`;
  let type = 'swap-approved';

  if (mode === 'submitted') {
    subject = 'Swap request submitted';
    detail = `${fromAgentName} requested a shift swap with ${toAgentName}. Current approval state: ${approvalState}.`;
    type = 'swap-request-submitted';
  } else if (mode === 'completed') {
    subject = 'Swap request approved';
    detail = `Both agents approved the swap request. The shifts have been exchanged.`;
    type = 'swap-approved';
  }

  notifications.forEach(({ agentId, name }) => {
    const recipientEmail = getAgentAccountEmail(agentId);
    if (!recipientEmail) return;
    sendEmailNotification({
      to: recipientEmail,
      subject,
      body: `Hi ${name}, ${detail}\n\nFrom shift: ${fromShiftLabel}\nTo shift: ${toShiftLabel}`,
      type
    });
  });
}

function getAppLoginUrl() {
  const configuredUrl = loadConfiguredAppLoginUrl();
  if (configuredUrl) {
    return configuredUrl;
  }
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    if (!url.pathname || url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname || '/'}index.html`.replace(/\/+/g, '/');
    }
    const normalizedHref = String(url.href || '').trim();
    if (!normalizedHref || normalizedHref.startsWith('about:blank') || normalizedHref.startsWith('null/')) {
      throw new Error('Invalid runtime URL for login link generation.');
    }
    return normalizedHref;
  } catch {
    try {
      const appScript = document.querySelector('script[src*="app.js"]');
      const scriptSrc = appScript?.getAttribute('src') || '';
      if (scriptSrc) {
        const fromScript = normalizeAppLoginUrl(new URL('index.html', scriptSrc).toString());
        if (fromScript) return fromScript;
      }
    } catch {
      // Fall through to final fallback.
    }
    const hrefFallback = String(window.location.href || '').split('#')[0].split('?')[0];
    if (hrefFallback && !hrefFallback.startsWith('about:blank')) {
      return hrefFallback;
    }
    const origin = String(window.location.origin || '').trim();
    if (origin && origin !== 'null') {
      return `${origin}/index.html`;
    }
    return 'index.html';
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

function getCurrentPageResetLink(token) {
  try {
    const currentUrl = new URL(window.location.href);
    currentUrl.search = '';
    currentUrl.hash = '';
    currentUrl.searchParams.set('resetToken', String(token || ''));
    return currentUrl.toString();
  } catch {
    const base = String(window.location.pathname || 'index.html');
    return `${base}?resetToken=${encodeURIComponent(token)}`;
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
  return authUsers.filter((user) => isAdminUser(user) && user.isActive !== false).length;
}

function applyAccessForUser(user) {
  if (isAdminUser(user)) {
    const switchedIntoAdmin = state.ui.accessMode !== 'admin';
    state.ui.accessMode = 'admin';
    if (switchedIntoAdmin) {
      state.ui.availabilityFrom = '';
      state.ui.availabilityTo = '';
      state.ui.availabilityAllDate = '';
      state.ui.availabilityAllFrom = '';
      state.ui.availabilityAllTo = '';
      state.ui.availabilityAllAgentId = 'All';
      state.ui.availabilityAllStatus = 'All';
      state.ui.availabilitySwapDate = '';
      state.ui.availabilitySwapFrom = '';
      state.ui.availabilitySwapTo = '';
      state.ui.availabilitySwapAgentId = 'All';
      state.ui.availabilitySwapStatus = 'All';
      state.ui.availabilityAllRequestsHidden = false;
      state.ui.availabilitySwapRequestsHidden = false;
      state.ui.availabilityRequestsCollapsed = false;
      state.ui.swapAlertsCollapsed = false;
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
    return;
  }
  if (isAgentLikeUser(user)) {
    state.ui.accessMode = 'agent';
    state.ui.currentAgentId = Number(user.agentId);
    return;
  }
  state.ui.accessMode = 'agent';
  state.ui.currentAgentId = Number(user.agentId);
}

function getUserDisplayName(user) {
  if (!user) return '';
  if (isAgentLikeUser(user)) {
    return getAgent(Number(user.agentId))?.name || user.username;
  }
  return user.name || user.username;
}

function renderUserNavChip(user) {
  const displayName = getUserDisplayName(user) || 'User';
  const roleLabel = getUserRoleLabel(user?.role);
  const photoDataUrl = String(user?.profilePhotoDataUrl || '').trim();
  const fallbackInitial = String(displayName || 'U').trim().charAt(0).toUpperCase() || 'U';
  const avatarMarkup = photoDataUrl
    ? `<img src="${escapeHtml(photoDataUrl)}" alt="Profile" style="width:22px; height:22px; border-radius:999px; object-fit:cover; border:1px solid rgba(255,255,255,0.45);" />`
    : `<span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:999px; border:1px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.12); color:#fff; font-size:0.75rem; font-weight:700;">${escapeHtml(fallbackInitial)}</span>`;
  return `<span class="chip" style="display:inline-flex; align-items:center; gap:6px;">${avatarMarkup}<span>${escapeHtml(displayName)} (${escapeHtml(roleLabel)})</span></span>`;
}

function getUserRoleLabel(roleValue) {
  const role = normalizeUserRole(roleValue);
  if (role === userRoles.admin) return 'admin';
  if (role === userRoles.teamLead) return 'team lead';
  return 'agent';
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
        ? { ...user, password: newPassword, passwordUpdatedAt: getCurrentIsoTimestamp(), mustChangePassword: false }
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
          <button type="submit" class="secondary">Get reset link</button>
        </form>
        <div class="muted" style="margin-top:8px;">Enter your agent email to generate a password reset link directly on this screen.</div>
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
    if (isAgentLikeUser(foundUser) && !state.agents.some((agent) => agent.id === Number(foundUser.agentId))) {
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

  document.getElementById('forgot-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = normalizeEmail(formData.get('email'));
    let foundUser = authUsers.find((user) => normalizeEmail(user.email) === email);

    if (!foundUser && backendApiBase) {
      // Match login behavior: refresh once from shared backend before treating the email as unknown.
      const remoteStore = await fetchBackendSnapshot();
      if (remoteStore) {
        applyRemoteSnapshot(remoteStore);
        syncFromStorage();
        foundUser = authUsers.find((user) => normalizeEmail(user.email) === email);
      }
    }

    const linkedAgent = foundUser ? state.agents.find((agent) => Number(agent.id) === Number(foundUser.agentId)) : null;
    const isAssociatedAgentEmail = Boolean(foundUser && isAgentLikeUser(foundUser) && linkedAgent);

    if (!isAssociatedAgentEmail) {
      renderLoginPage('', 'If an agent account exists for that email, a reset link will appear here.');
      return;
    }

    const passwordResetRequests = loadPasswordResetRequests();
    const token = createResetToken();
    const localResetLink = getCurrentPageResetLink(token);
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
    renderLoginPage('', 'Reset link generated for this agent account (valid for 1 hour).', localResetLink);
  });
}

function renderFirstLoginPasswordSetupPage(currentUser, options = {}) {
  const title = options.title || 'Set your password';
  const description = options.description || 'For security, you must create your own password before continuing.';
  root.innerHTML = `
    <div class="app" style="max-width:560px; padding-top:48px;">
      <div class="panel">
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">${escapeHtml(description)}</p>
        <form id="first-login-password-form" class="stack">
          <input name="newPassword" type="password" placeholder="New password" required autocomplete="new-password" />
          <input name="confirmPassword" type="password" placeholder="Confirm new password" required autocomplete="new-password" />
          <label class="row" style="justify-content:flex-start; align-items:center; gap:8px;">
            <input name="savePassword" type="checkbox" value="1" />
            <span>Save password on this device</span>
          </label>
          <div id="first-login-password-status" class="muted"></div>
          <button id="first-login-password-submit" type="submit">Save password and continue</button>
        </form>
      </div>
    </div>
  `;
  const formElement = document.getElementById('first-login-password-form');
  const statusElement = document.getElementById('first-login-password-status');
  const submitButton = document.getElementById('first-login-password-submit');
  const setStatus = (message, isError = false) => {
    if (!statusElement) return;
    statusElement.textContent = String(message || '');
    statusElement.style.color = isError ? '#fca5a5' : '';
  };

  const handleFirstLoginSubmit = () => {
    if (!(formElement instanceof HTMLFormElement)) return;
    try {
      const formData = new FormData(formElement);
      const newPassword = formData.get('newPassword')?.toString() || '';
      const confirmPassword = formData.get('confirmPassword')?.toString() || '';
      const shouldRememberLogin = Boolean(formData.get('savePassword'));

      if (newPassword.length < 8) {
        setStatus('New password must be at least 8 characters.', true);
        return;
      }
      if (newPassword !== confirmPassword) {
        setStatus('New password and confirmation do not match.', true);
        return;
      }

      setStatus('Saving your new password...');
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
      }

      authUsers = authUsers.map((user) => user.id === currentUser.id
        ? {
            ...user,
            password: newPassword,
            passwordUpdatedAt: getCurrentIsoTimestamp(),
            mustChangePassword: false
          }
        : user);
      const didSaveAuthUsers = saveAuthUsers();
      if (!didSaveAuthUsers) {
        setStatus('Unable to save your new password right now. Please check browser storage settings and try again.', true);
        if (submitButton instanceof HTMLButtonElement) {
          submitButton.disabled = false;
        }
        return;
      }

      if (backendApiBase) {
        // Keep UI responsive; backend sync should be best-effort and non-blocking.
        void pushLocalSnapshotToBackend();
      }
      saveRememberedLogin(currentUser.email, newPassword, shouldRememberLogin);
      currentSession = { userId: currentUser.id };
      saveSession();
      window.history.replaceState({}, '', window.location.pathname);
      applyAccessForUser({ ...currentUser, mustChangePassword: false });
      saveUiState();
      render();
    } catch (error) {
      setStatus(`Unable to complete password setup: ${String(error?.message || 'Unknown error')}`, true);
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
      }
    }
  };

  formElement?.addEventListener('submit', (event) => {
    event.preventDefault();
    handleFirstLoginSubmit();
  });
  submitButton?.addEventListener('click', (event) => {
    event.preventDefault();
    handleFirstLoginSubmit();
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
    policies: defaultState.policies.map((policy) => ({ ...policy })),
    blackoutDates: [...defaultState.blackoutDates],
    roleColors: { ...defaultState.roleColors },
    roleCatalog: [...defaultState.roleCatalog],
    locationCatalog: [...defaultState.locationCatalog],
    ui: getDefaultUiState()
  };
}

function normalizeRoleLabel(role, availableRoles = null) {
  const roleChoices = Array.isArray(availableRoles) && availableRoles.length > 0
    ? normalizeRoleCatalog(availableRoles)
    : normalizeRoleCatalog(roleOptions);
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!normalizedRole) return roleChoices[0] || roleOptions[0];
  const legacyRoleMap = {
    senior: 'In-person',
    mid: 'WFH',
    junior: 'Booth Duty',
    agent: 'WFH'
  };
  if (legacyRoleMap[normalizedRole]) {
    return legacyRoleMap[normalizedRole];
  }
  const matchedRole = roleChoices.find((item) => item.toLowerCase() === normalizedRole);
  return matchedRole || role;
}

function normalizeTeamLabel(team) {
  const normalizedTeam = String(team || '').trim().toLowerCase();
  if (!normalizedTeam) return teamOptions[0];
  const matchedTeam = teamOptions.find((item) => item.toLowerCase() === normalizedTeam);
  return matchedTeam || teamOptions[0];
}

function normalizeMaxInOfficeShifts(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function normalizeAttendancePoints(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeAgentSkills(value) {
  const allowedSkills = new Set(agentSkillOptions.map((skill) => skill.value));
  const source = Array.isArray(value) ? value : [];
  const normalizedSkills = source
    .map((skill) => String(skill || '').trim().toLowerCase())
    .filter((skill) => allowedSkills.has(skill));
  return Array.from(new Set(normalizedSkills));
}

function getAgentSkillLabels(skills) {
  const selectedSkills = normalizeAgentSkills(skills);
  return selectedSkills
    .map((skillValue) => agentSkillOptions.find((skill) => skill.value === skillValue)?.label || '')
    .filter(Boolean);
}

function getAgentSkillsSummary(skills) {
  const labels = getAgentSkillLabels(skills);
  return labels.length ? labels.join(', ') : 'None assigned';
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

function reconcileAgentEmailsWithAuthUsers() {
  let didChange = false;
  const linkedUsersByAgentId = new Map(
    authUsers
      .filter((user) => isAgentLikeUser(user) && Number.isFinite(Number(user.agentId)))
      .map((user) => [String(user.agentId), user])
  );

  state.agents = state.agents.map((agent) => {
    const linkedUser = linkedUsersByAgentId.get(String(agent.id));
    const agentEmail = normalizeEmail(agent.email || '');
    const linkedUserEmail = normalizeEmail(linkedUser?.email || '');

    if (linkedUser && linkedUserEmail && linkedUserEmail !== agentEmail) {
      didChange = true;
      return { ...agent, email: linkedUserEmail };
    }

    if (agentEmail && linkedUser && !linkedUserEmail) {
      const profileUpdatedAt = getCurrentIsoTimestamp();
      authUsers = authUsers.map((user) => user.id === linkedUser.id
        ? { ...user, email: agentEmail, updatedAt: profileUpdatedAt, profileUpdatedAt }
        : user);
      didChange = true;
      return { ...agent, email: agentEmail };
    }

    if (!agentEmail && linkedUserEmail) {
      didChange = true;
      return { ...agent, email: linkedUserEmail };
    }

    return agent;
  });

  return didChange;
}

function normalizeTemplates(templates, roleCatalog = roleOptions, locationCatalog = shiftLocationOptions) {
  const defaultTemplates = createDefaultState().templates;
  const normalizedRoles = normalizeRoleCatalog(roleCatalog);
  const normalizedLocations = normalizeLocationCatalog(locationCatalog);
  if (!Array.isArray(templates)) {
    return defaultTemplates.map((template) => ({
      ...template,
      active: template?.active !== false
    }));
  }

  const legacyTemplateNames = new Set(['Morning Support', 'Evening Support']);
  const incomingNames = templates.map((template) => String(template?.name || '').trim());
  const onlyLegacyTemplates = incomingNames.length > 0 && incomingNames.every((name) => legacyTemplateNames.has(name));

  if (onlyLegacyTemplates) {
    return defaultTemplates;
  }

  return templates.map((template) => {
    const requestedLocation = String(template?.location || '').trim();
    const normalizedStart = normalizeTimeInputValue(template?.start || '');
    const normalizedEnd = normalizeTimeInputValue(template?.end || '');
    return {
      ...template,
      active: template?.active !== false,
      start: normalizedStart || '08:00',
      end: normalizedEnd || '16:00',
      role: template?.role ? normalizeRoleLabel(template.role, normalizedRoles) : '',
      location: requestedLocation && normalizedLocations.includes(requestedLocation) ? requestedLocation : ''
    };
  });
}

function normalizePolicies(policies) {
  if (!Array.isArray(policies)) return [];
  return policies
    .map((policy) => ({
      id: Number(policy?.id) || createId(),
      name: String(policy?.name || '').trim(),
      mimeType: String(policy?.mimeType || 'application/octet-stream').trim(),
      legacyContentBase64: String(policy?.contentBase64 || '').trim(),
      sizeBytes: Number(policy?.sizeBytes) || 0,
      uploadedAt: String(policy?.uploadedAt || '').trim() || new Date().toISOString()
    }))
    .filter((policy) => policy.name);
}

function loadState() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      return createDefaultState();
    }
    const parsed = JSON.parse(saved);
    const authUsersForLookup = loadAuthUsers();
    const normalizedRoleCatalog = normalizeRoleCatalog(parsed.roleCatalog);
    const normalizedLocationCatalog = normalizeLocationCatalog(parsed.locationCatalog);
    const normalizedAgents = Array.isArray(parsed.agents)
      ? parsed.agents.map((agent) => {
          const maxInOfficeShiftsRaw = typeof agent.maxInOfficeShifts === 'undefined' ? null : agent.maxInOfficeShifts;
          const maxInOfficeShifts = normalizeMaxInOfficeShifts(maxInOfficeShiftsRaw);
          const attendancePoints = normalizeAttendancePoints(agent.attendancePoints);
          const skills = normalizeAgentSkills(agent.skills);
          const linkedUserEmail = normalizeEmail(
            authUsersForLookup.find((user) => isAgentLikeUser(user) && Number(user.agentId) === Number(agent.id))?.email || ''
          );
          return {
            ...agent,
            email: normalizeEmail(agent.email || linkedUserEmail),
            team: normalizeTeamLabel(agent.team),
            role: normalizeRoleLabel(agent.role, normalizedRoleCatalog),
            attendancePoints,
            skills,
            maxInOfficeShifts
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
      templates: normalizeTemplates(parsed.templates, normalizedRoleCatalog, normalizedLocationCatalog),
      policies: normalizePolicies(parsed.policies),
      roleCatalog: normalizedRoleCatalog,
      locationCatalog: normalizedLocationCatalog,
      shifts: Array.isArray(parsed.shifts)
        ? parsed.shifts.map((shift) => {
            const normalizedShift = {
              ...shift,
              location: normalizedLocationCatalog.includes(String(shift.location || '').trim()) ? shift.location : '',
              role: normalizeRoleLabel(shift.role || roleByAgentId[String(shift.agentId)] || normalizedRoleCatalog[0], normalizedRoleCatalog),
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
  const sanitizedPolicies = sanitizePoliciesForStorage(sharedState.policies);
  sharedState.policies = sanitizedPolicies;
  state.policies = sanitizedPolicies;
  const persistableState = {
    ...sharedState,
    availabilityRequests: state.availabilityRequests
  };
  const didSaveState = safeSetLocalStorage(storageKey, JSON.stringify(persistableState));
  const didSaveInbox = safeSetLocalStorage(availabilityInboxKey, JSON.stringify(state.availabilityRequests));
  const didSaveRequests = safeSetLocalStorage(availabilityRequestsKey, JSON.stringify(state.availabilityRequests));
  saveUiState();
  return didSaveState && didSaveInbox && didSaveRequests;
}

function getFilteredAvailabilityRequests(requests) {
  const fromDate = (state.ui.availabilityFrom || '').trim();
  const toDate = (state.ui.availabilityTo || '').trim();
  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const requestDate = getAvailabilityRequestDate(request);
    const matchesFrom = !fromDate || (requestDate && requestDate >= fromDate);
    const matchesTo = !toDate || (requestDate && requestDate <= toDate);
    return matchesFrom && matchesTo;
  });
}

function getAvailabilityRequestDate(request) {
  return (request?.unavailableDate || '').slice(0, 10) || (request?.requestedAt || '').slice(0, 10);
}

function getSwapRequestDate(request) {
  const fromShift = getShiftById(getSwapRequestFromShiftId(request));
  const toShift = getShiftById(getSwapRequestToShiftId(request));
  return (fromShift?.date || toShift?.date || request?.requestedAt || '').slice(0, 10);
}

function getSwapRequestFilterStatus(request) {
  const normalizedStatus = String(request?.status || 'pending').trim().toLowerCase();
  if (normalizedStatus === 'completed' || normalizedStatus === 'approved') return 'approved';
  if (normalizedStatus === 'rejected' || normalizedStatus === 'denied' || normalizedStatus === 'declined') return 'rejected';
  return 'pending';
}

function filterAvailabilityRequestsForAdminList(requests, filters = {}) {
  const date = String(filters.date || '').trim();
  const from = String(filters.from || '').trim();
  const to = String(filters.to || '').trim();
  const agentId = String(filters.agentId || 'All');
  const status = String(filters.status || 'All');

  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const requestDate = getAvailabilityRequestDate(request);
    const normalizedStatus = normalizeAvailabilityRequestStatus(request?.status);
    const matchesDate = !date || (requestDate && requestDate === date);
    const matchesFrom = !from || (requestDate && requestDate >= from);
    const matchesTo = !to || (requestDate && requestDate <= to);
    const matchesAgent = agentId === 'All' || String(request?.agentId || '') === agentId;
    const matchesStatus = status === 'All' || normalizedStatus === status;
    return matchesDate && matchesFrom && matchesTo && matchesAgent && matchesStatus;
  });
}

function filterSwapRequestsForAdminList(requests, filters = {}) {
  const date = String(filters.date || '').trim();
  const from = String(filters.from || '').trim();
  const to = String(filters.to || '').trim();
  const agentId = String(filters.agentId || 'All');
  const status = String(filters.status || 'All');

  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const requestDate = getSwapRequestDate(request);
    const normalizedStatus = getSwapRequestFilterStatus(request);
    const matchesDate = !date || (requestDate && requestDate === date);
    const matchesFrom = !from || (requestDate && requestDate >= from);
    const matchesTo = !to || (requestDate && requestDate <= to);
    const matchesAgent = agentId === 'All'
      || String(request?.fromAgentId || '') === agentId
      || String(request?.toAgentId || '') === agentId;
    const matchesStatus = status === 'All' || normalizedStatus === status;
    return matchesDate && matchesFrom && matchesTo && matchesAgent && matchesStatus;
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

function isShiftOfferedForPickup(shift) {
  return Boolean(shift?.offeredForPickup) && isPublishedShift(shift);
}

function canAgentOfferShift(shift, agentId) {
  return isPublishedShift(shift) && Number(shift?.agentId) === Number(agentId);
}

function canAgentPickUpOfferedShift(shift, agentId) {
  return isShiftOfferedForPickup(shift)
    && Number(shift?.agentId) !== Number(agentId)
    && Number(agentId) > 0;
}

function getShiftStyle(shift) {
  const hasAttentionBorder = isShiftOfferedForPickup(shift) || Boolean(normalizeShiftAbsenceReason(shift?.absenceReason));
  const attentionBorder = hasAttentionBorder ? ' border:2px dashed rgba(255,255,255,0.8);' : '';
  const absentFade = normalizeShiftAbsenceReason(shift?.absenceReason) ? ' opacity:0.72;' : '';
  return `background:${getShiftRoleColor(shift)}; border-left:3px solid rgba(255,255,255,0.65);${attentionBorder}${absentFade}`;
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
  const normalizedBaseRoles = getRoleCatalog();
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

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read selected file.'));
    reader.readAsText(file);
  });
}

function getDataUrlApproxBytes(dataUrl) {
  const normalized = String(dataUrl || '');
  const commaIndex = normalized.indexOf(',');
  if (commaIndex < 0) return 0;
  const base64 = normalized.slice(commaIndex + 1);
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function optimizeImageFileForProfilePhoto(file, maxDimension = 640, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onerror = () => reject(new Error('Unable to read selected image.'));
    fileReader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Unable to process selected image.'));
      image.onload = () => {
        const sourceWidth = Math.max(1, Number(image.width) || 1);
        const sourceHeight = Math.max(1, Number(image.height) || 1);
        const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Unable to process selected image.'));
          return;
        }
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.src = String(fileReader.result || '');
    };
    fileReader.readAsDataURL(file);
  });
}

async function triggerPolicyDownload(policy) {
  const blob = await getPolicyBlob(policy);
  if (!blob) {
    alert('This policy file data is unavailable on this device. Upload it again to restore download and preview.');
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = policy?.name || `policy-${policy?.id || createId()}`;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

async function getPolicyDataUrl(policy) {
  const bytes = await getPolicyBytes(policy);
  if (!bytes) return '';
  const base64 = bytesToBase64(bytes);
  if (!base64) return '';
  const mimeType = String(policy?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  return `data:${mimeType};base64,${base64}`;
}

async function getPolicyBytes(policy) {
  const policyId = Number(policy?.id) || 0;
  if (!policyId) return null;
  const storedBytes = await loadPolicyFileBytes(policyId);
  if (storedBytes && storedBytes.length > 0) {
    if (backendApiBase && !isApplyingRemoteSnapshot) {
      const mimeType = String(policy?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
      void uploadPolicyFileToBackend(policyId, mimeType, storedBytes);
    }
    return storedBytes;
  }
  const legacyBase64 = String(policy?.legacyContentBase64 || policy?.contentBase64 || '').trim();
  return base64ToBytes(legacyBase64);
}

async function getPolicyBlob(policy) {
  const bytes = await getPolicyBytes(policy);
  if (!bytes) return null;
  const mimeType = String(policy?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  return new Blob([bytes], { type: mimeType });
}

function isTextLikePolicy(policy) {
  if (isDocxPolicy(policy)) return false;
  const mimeType = String(policy?.mimeType || '').trim().toLowerCase();
  const policyName = String(policy?.name || '').trim().toLowerCase();
  if (mimeType.startsWith('text/')) return true;
  if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('csv')) return true;
  return /\.(txt|md|json|csv|xml)$/i.test(policyName);
}

function isDocxPolicy(policy) {
  const mimeType = String(policy?.mimeType || '').trim().toLowerCase();
  const policyName = String(policy?.name || '').trim().toLowerCase();
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || /\.docx$/i.test(policyName);
}

function getPolicyTypeLabel(policy) {
  if (isDocxPolicy(policy)) return 'DOCX';
  const mimeType = String(policy?.mimeType || '').trim().toLowerCase();
  const policyName = String(policy?.name || '').trim().toLowerCase();
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(policyName)) return 'PDF';
  return String(policy?.mimeType || 'FILE').split('/')[0].toUpperCase() || 'FILE';
}

function canPreviewPolicyInline(policy) {
  const mimeType = String(policy?.mimeType || '').trim().toLowerCase();
  const policyName = String(policy?.name || '').trim().toLowerCase();
  if (mimeType.startsWith('image/')) return true;
  if (mimeType === 'application/pdf') return true;
  if (isTextLikePolicy(policy)) return true;
  if (isDocxPolicy(policy)) return true;
  if (/\.(pdf|png|jpg|jpeg|gif|webp|svg)$/i.test(policyName)) return true;
  return false;
}

async function inflateZipEntry(entryBytes, method) {
  if (method === 0) {
    return entryBytes;
  }
  if (method !== 8) {
    return null;
  }
  if (typeof DecompressionStream !== 'function') {
    return null;
  }
  const stream = new Blob([entryBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function extractDocxXmlText(policy) {
  const bytes = await getPolicyBytes(policy);
  if (!bytes) return '';

  const targetFileName = 'word/document.xml';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) return '';

  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let offset = centralDirectoryOffset;

  while (offset + 46 <= centralDirectoryEnd) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      break;
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = new TextDecoder('utf-8').decode(bytes.slice(fileNameStart, fileNameEnd));

    if (fileName === targetFileName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return '';
      const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      const entryBytes = bytes.slice(dataStart, dataEnd);
      const inflatedBytes = await inflateZipEntry(entryBytes, compressionMethod);
      if (!inflatedBytes) return '';
      return new TextDecoder('utf-8', { fatal: false }).decode(inflatedBytes);
    }

    offset = fileNameEnd + extraLength + commentLength;
  }

  return '';
}

function extractDocxPlainText(xmlText) {
  const parsed = new DOMParser().parseFromString(String(xmlText || ''), 'application/xml');
  const parserError = parsed.getElementsByTagName('parsererror')[0];
  if (parserError) return '';
  const paragraphNodes = Array.from(parsed.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'));
  const lines = paragraphNodes.map((paragraph) => {
    const textNodes = Array.from(paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't'));
    return textNodes.map((node) => node.textContent || '').join('');
  });
  return lines.join('\n').trim();
}

function renderPolicyPreviewModal() {
  return `
    <div id="policy-preview-modal" style="display:none; position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,0.58); padding:20px; align-items:center; justify-content:center;">
      <div class="panel" style="width:min(1100px, 96vw); max-height:92vh; margin:0; display:flex; flex-direction:column; gap:10px;">
        <div class="row" style="justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong id="policy-preview-title">Policy preview</strong>
          <div class="row" style="gap:8px;">
            <a id="policy-preview-open-tab" class="secondary" href="#" target="_blank" rel="noopener" style="text-decoration:none;"><button class="secondary" type="button">Open in new tab</button></a>
            <button id="policy-preview-close" class="secondary" type="button">Close</button>
          </div>
        </div>
        <div class="card" style="padding:8px; flex:1; min-height:64vh;">
          <div id="policy-preview-body" style="width:100%; height:100%; min-height:62vh; overflow:auto; border-radius:8px; background:#fff;"></div>
        </div>
      </div>
    </div>
  `;
}

async function openPolicyPreviewModal(policy) {
  const modal = document.getElementById('policy-preview-modal');
  const body = document.getElementById('policy-preview-body');
  const title = document.getElementById('policy-preview-title');
  const openTabLink = document.getElementById('policy-preview-open-tab');
  const canRenderInlineModal = (modal instanceof HTMLElement)
    && (body instanceof HTMLElement)
    && (title instanceof HTMLElement)
    && (openTabLink instanceof HTMLAnchorElement);

  if (canRenderInlineModal) {
    closePolicyPreviewModal();
  }

  const previewBlob = await getPolicyBlob(policy);
  if (!previewBlob) {
    alert('Preview data is unavailable for this file.');
    return;
  }
  const previewSrc = URL.createObjectURL(previewBlob);

  // Fallback for pages that do not render the inline preview modal.
  if (!canRenderInlineModal) {
    const newTabLink = document.createElement('a');
    newTabLink.href = previewSrc;
    newTabLink.target = '_blank';
    newTabLink.rel = 'noopener';
    newTabLink.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(previewSrc);
    }, 60000);
    return;
  }

  activePolicyPreviewBlobUrl = previewSrc;
  const requestId = Date.now();
  activePolicyPreviewRequestId = requestId;
  title.textContent = policy?.name || 'Policy preview';
  body.innerHTML = '<div class="muted" style="padding:16px;">Loading preview...</div>';
  modal.style.display = 'flex';

  if (isTextLikePolicy(policy)) {
    const bytes = await getPolicyBytes(policy);
    let textContent = '';
    try {
      textContent = bytes ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : '';
    } catch {
      textContent = '';
    }
    const escapedText = escapeHtml(textContent || '[No preview text available]');
    if (requestId === activePolicyPreviewRequestId) {
      body.innerHTML = `<pre style="margin:0; padding:16px; font-family:Consolas, Menlo, Monaco, monospace; white-space:pre-wrap; word-break:break-word; color:#111;">${escapedText}</pre>`;
    }
  } else if (isDocxPolicy(policy)) {
    const xmlText = await extractDocxXmlText(policy);
    const plainText = extractDocxPlainText(xmlText) || '[No preview text could be extracted from this DOCX file.]';
    if (requestId === activePolicyPreviewRequestId) {
      body.innerHTML = `<pre style="margin:0; padding:16px; font-family:Consolas, Menlo, Monaco, monospace; white-space:pre-wrap; word-break:break-word; color:#111;">${escapeHtml(plainText)}</pre>`;
    }
  } else {
    if (requestId === activePolicyPreviewRequestId) {
      body.innerHTML = `<iframe src="${escapeHtml(previewSrc)}" title="${escapeHtml(policy?.name || 'Policy preview')}" style="width:100%; height:100%; min-height:62vh; border:0; border-radius:8px; background:#fff;"></iframe>`;
    }
  }
  openTabLink.href = previewSrc;
}

function closePolicyPreviewModal() {
  const modal = document.getElementById('policy-preview-modal');
  const body = document.getElementById('policy-preview-body');
  const openTabLink = document.getElementById('policy-preview-open-tab');
  activePolicyPreviewRequestId += 1;
  if (body instanceof HTMLElement) {
    body.innerHTML = '';
  }
  if (openTabLink instanceof HTMLAnchorElement) {
    openTabLink.href = '#';
  }
  if (activePolicyPreviewBlobUrl) {
    URL.revokeObjectURL(activePolicyPreviewBlobUrl);
    activePolicyPreviewBlobUrl = '';
  }
  if (modal instanceof HTMLElement) {
    modal.style.display = 'none';
  }
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

function promptInOfficeOverride(agentName, projectedInOfficeCount, maxInOfficeShifts) {
  return new Promise((resolve) => {
    const existingOverlay = document.getElementById('in-office-override-modal-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'in-office-override-modal-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.72); display:flex; align-items:center; justify-content:center; z-index:10000; padding:16px;';
    overlay.innerHTML = `
      <div style="width:min(620px, 100%); max-height:90vh; overflow:auto; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.18); border-radius:14px; padding:18px; box-shadow:0 24px 64px rgba(0,0,0,0.5);">
        <h2 style="margin:0 0 12px;">In-person limit warning</h2>
        <p class="muted" style="margin:0 0 12px;">${escapeHtml(agentName || 'This agent')} would be scheduled for ${escapeHtml(projectedInOfficeCount)} in-office shift${projectedInOfficeCount === 1 ? '' : 's'} in that week, above the max of ${escapeHtml(maxInOfficeShifts)}.</p>
        <label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:14px;">
          <input id="in-office-override-checkbox" type="checkbox" />
          <span>Override in-person limit and schedule anyway</span>
        </label>
        <div class="row" style="justify-content:flex-end; gap:8px;">
          <button id="in-office-override-cancel" type="button" class="secondary">Cancel</button>
          <button id="in-office-override-confirm" type="button" disabled>Schedule anyway</button>
        </div>
      </div>
    `;

    const cleanup = (result) => {
      document.removeEventListener('keydown', onEscape);
      overlay.remove();
      resolve(result);
    };

    const onEscape = (event) => {
      if (event.key === 'Escape') {
        cleanup(false);
      }
    };

    const checkbox = overlay.querySelector('#in-office-override-checkbox');
    const confirmButton = overlay.querySelector('#in-office-override-confirm');

    checkbox?.addEventListener('change', () => {
      if (confirmButton instanceof HTMLButtonElement) {
        confirmButton.disabled = !(checkbox instanceof HTMLInputElement && checkbox.checked);
      }
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });

    overlay.querySelector('#in-office-override-cancel')?.addEventListener('click', () => {
      cleanup(false);
    });

    overlay.querySelector('#in-office-override-confirm')?.addEventListener('click', () => {
      cleanup(true);
    });

    document.addEventListener('keydown', onEscape);
    document.body.appendChild(overlay);
  });
}

async function confirmShiftAssignmentWithTimeOffWarning(agentId, date, start, end, options = {}) {
  const activeUser = getCurrentUser();
  if (activeUser?.role !== 'admin') {
    return true;
  }

  const replacingShiftId = Number(options.replacingShiftId) || null;
  const requestedRole = String(options.role || '').trim();

  const targetAgent = getAgent(agentId);

  const roleToEvaluate = requestedRole || targetAgent?.role || getPrimaryRole();
  if (isInOfficeRole(roleToEvaluate)) {
    const maxInOfficeShifts = normalizeMaxInOfficeShifts(targetAgent?.maxInOfficeShifts);
    if (Number.isFinite(maxInOfficeShifts) && maxInOfficeShifts >= 0) {
      const projectedInOfficeCount = getAssignedInOfficeShiftCount(agentId, date, { excludingShiftId: replacingShiftId }) + 1;
      if (projectedInOfficeCount > maxInOfficeShifts) {
        return promptInOfficeOverride(targetAgent?.name || 'This agent', projectedInOfficeCount, maxInOfficeShifts);
      }
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

  const roleChoices = Array.from(new Set([...(getRoleLegendItems() || []), shift.role || getPrimaryRole()])).filter(Boolean);
  const locationChoices = getLocationCatalog();
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
            <select name="agentId">
              <option value="" ${!shift.agentId ? 'selected' : ''}>Unassigned</option>
              ${[...state.agents].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })).map((agent) => `<option value="${agent.id}" ${Number(shift.agentId) === Number(agent.id) ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`).join('')}
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
            <span>Venue</span>
            <select name="location">
              <option value="">No venue</option>
              ${locationChoices.map((location) => `<option value="${escapeHtml(location)}" ${String(shift.location || '') === String(location) ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('')}
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

  overlay.querySelector('#shift-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextAgentIdRaw = String(formData.get('agentId') || '').trim();
    const nextAgentId = nextAgentIdRaw ? Number(nextAgentIdRaw) : null;
    if (nextAgentIdRaw && (!Number.isFinite(nextAgentId) || !getAgent(nextAgentId))) {
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

    const nextRole = normalizeRoleLabel(String(formData.get('role') || '').trim() || getPrimaryRole(), getRoleCatalog());
    const requestedLocation = String(formData.get('location') || '').trim();
    const nextLocation = requestedLocation && getLocationCatalog().includes(requestedLocation) ? requestedLocation : '';
    const nextStatus = String(formData.get('status') || '').trim() === shiftStatuses.published ? shiftStatuses.published : shiftStatuses.draft;

    if (!await confirmShiftAssignmentWithTimeOffWarning(nextAgentId, nextDate, nextStart, nextEnd, {
      replacingShiftId: Number(shift.id),
      durationHours: getDurationHours(nextStart, nextEnd),
      role: nextRole
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

function openShiftAbsenceModal(shift, onSave) {
  const existingOverlay = document.getElementById('shift-absence-modal-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const currentReason = normalizeShiftAbsenceReason(shift?.absenceReason) || shiftAbsenceReasonOptions[0];
  const overlay = document.createElement('div');
  overlay.id = 'shift-absence-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.72); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;';
  overlay.innerHTML = `
    <div style="width:min(560px, 100%); max-height:90vh; overflow:auto; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.18); border-radius:14px; padding:18px; box-shadow:0 24px 64px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 12px;">Mark shift as absent</h2>
      <p class="muted" style="margin:0 0 14px;">${escapeHtml(getAgent(shift?.agentId)?.name || 'Agent')} • ${escapeHtml(shift?.date || shift?.day || '')} • ${escapeHtml(formatTimeRange(shift?.start || '00:00', shift?.end || '00:00'))}</p>
      <form id="shift-absence-form" class="stack">
        <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
          <span>Reason</span>
          <select name="absenceReason" required>
            ${shiftAbsenceReasonOptions.map((reason) => `<option value="${escapeHtml(reason)}" ${reason === currentReason ? 'selected' : ''}>${escapeHtml(reason)}</option>`).join('')}
          </select>
        </label>
        <div class="row" style="justify-content:flex-end; margin-top:8px;">
          <button type="button" id="shift-absence-cancel" class="secondary">Cancel</button>
          <button type="submit">Save absent reason</button>
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

  overlay.querySelector('#shift-absence-cancel')?.addEventListener('click', () => {
    closeModal();
  });

  overlay.querySelector('#shift-absence-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const absenceReason = normalizeShiftAbsenceReason(formData.get('absenceReason'));
    if (!absenceReason) {
      alert('Select an absence reason.');
      return;
    }
    onSave(absenceReason);
    closeModal();
  });

  document.addEventListener('keydown', onEscape);
  document.body.appendChild(overlay);
}

function saveAgentDetails(agentId, values) {
  const id = Number(agentId);
  const name = String(values?.name || '').trim();
  const email = normalizeEmail(values?.email);
  const requestedAccessRole = normalizeUserRole(values?.accessRole);
  const accessRole = requestedAccessRole === userRoles.admin ? userRoles.agent : requestedAccessRole;
  const team = normalizeTeamLabel(String(values?.team || '').trim() || teamOptions[0]);
  const payRate = parseCurrencyAmount(String(values?.payRate ?? '0').trim());
  const attendancePoints = normalizeAttendancePoints(values?.attendancePoints);
  const skills = normalizeAgentSkills(values?.skills);
  const maxInOfficeShifts = normalizeMaxInOfficeShifts(values?.maxInOfficeShifts);

  if (!name || !email) {
    return { ok: false, message: 'Name and email are required for each agent.' };
  }
  if (!Number.isFinite(payRate) || payRate < 0) {
    return { ok: false, message: 'Pay rate must be a valid non-negative amount (example: $15.45).' };
  }
  const emailInUse = authUsers.some((user) => normalizeEmail(user.email) === email && Number(user.agentId) !== id);
  if (emailInUse) {
    return { ok: false, message: 'That email is already in use by another account.' };
  }

  state.agents = state.agents.map((agent) => Number(agent.id) === id
    ? {
        ...agent,
        id,
        name,
        email,
        team,
        payRate,
        attendancePoints,
        skills,
        maxInOfficeShifts
      }
    : agent);

  const existingAgentUser = getUserByAgentId(id);
  if (existingAgentUser) {
    const profileUpdatedAt = getCurrentIsoTimestamp();
    authUsers = authUsers.map((user) => user.id === existingAgentUser.id
      ? {
          ...user,
          email,
          role: accessRole,
          profileUpdatedAt
        }
      : user);
  } else {
    const createdAt = getCurrentIsoTimestamp();
    authUsers.push(withRequiredEmail({
      id: createId(),
      username: createUniqueAgentUsername(email),
      email,
      phone: '',
      password: createTemporaryPassword(),
      passwordUpdatedAt: createdAt,
      createdAt,
      profileUpdatedAt: createdAt,
      mustChangePassword: true,
      calendarFeedToken: createCalendarFeedToken(),
      role: accessRole,
      agentId: id
    }));
  }

  const didSaveAuthUsers = saveAuthUsers();
  const didSaveState = saveState();
  if (!didSaveAuthUsers || !didSaveState) {
    syncFromStorage();
    return { ok: false, message: 'Unable to save agent details permanently. Please check browser storage settings and try again.' };
  }

  return { ok: true };
}

function openAgentEditModal(agent, onSave) {
  const existingOverlay = document.getElementById('agent-edit-modal-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const linkedUser = getUserByAgentId(agent.id);
  const accessRole = normalizeUserRole(linkedUser?.role || userRoles.agent);
  const selectedSkills = normalizeAgentSkills(agent.skills);
  const overlay = document.createElement('div');
  overlay.id = 'agent-edit-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.72); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;';
  overlay.innerHTML = `
    <div style="width:min(720px, 100%); max-height:90vh; overflow:auto; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.18); border-radius:14px; padding:18px; box-shadow:0 24px 64px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 12px;">Edit agent</h2>
      <p class="muted" style="margin:0 0 14px;">Update agent details and hours from one place.</p>
      <form id="agent-edit-form" class="stack">
        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Name</span>
            <input name="name" value="${escapeHtml(agent.name || '')}" required />
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Email</span>
            <input name="email" type="email" value="${escapeHtml(getAgentAccountEmail(agent.id) || '')}" required />
          </label>
        </div>
        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Access level</span>
            <select name="accessRole" required>
              <option value="${userRoles.agent}" ${accessRole === userRoles.agent ? 'selected' : ''}>Agent</option>
              <option value="${userRoles.teamLead}" ${accessRole === userRoles.teamLead ? 'selected' : ''}>Team lead</option>
            </select>
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Team</span>
            <select name="team" required>
              ${teamOptions.map((team) => `<option value="${team}" ${(agent.team || teamOptions[0]) === team ? 'selected' : ''}>${escapeHtml(team)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px;">
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span>Pay rate</span>
            <input name="payRate" type="text" inputmode="decimal" value="${escapeHtml(Number(agent.payRate || 0).toFixed(2))}" />
          </label>
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span>Attendance points</span>
            <input name="attendancePoints" type="number" inputmode="numeric" step="1" min="0" value="${escapeHtml(normalizeAttendancePoints(agent.attendancePoints))}" />
          </label>
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span>Max in-office shifts</span>
            <input name="maxInOfficeShifts" type="number" inputmode="numeric" step="1" min="0" value="${escapeHtml(agent.maxInOfficeShifts ?? '')}" />
          </label>
        </div>
        <div class="card" style="padding:10px; margin-top:2px;">
          <div style="font-weight:600; margin-bottom:6px;">Skills</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px;">
            ${agentSkillOptions.map((skill) => `
              <label style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" name="skills" value="${escapeHtml(skill.value)}" ${selectedSkills.includes(skill.value) ? 'checked' : ''} />
                <span>${escapeHtml(skill.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="row" style="justify-content:flex-end; margin-top:8px;">
          <button type="button" id="agent-edit-cancel" class="secondary">Cancel</button>
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

  overlay.querySelector('#agent-edit-cancel')?.addEventListener('click', () => {
    closeModal();
  });

  overlay.querySelector('#agent-edit-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = onSave({
      name: formData.get('name'),
      email: formData.get('email'),
      accessRole: formData.get('accessRole'),
      team: formData.get('team'),
      payRate: formData.get('payRate'),
      attendancePoints: formData.get('attendancePoints'),
      skills: formData.getAll('skills'),
      maxInOfficeShifts: formData.get('maxInOfficeShifts')
    });
    if (!result?.ok) {
      alert(result?.message || 'Unable to save agent details.');
      return;
    }
    closeModal();
  });

  document.addEventListener('keydown', onEscape);
  document.body.appendChild(overlay);
}

function openAvailabilityRequestEditModal(request, onSave) {
  const existingOverlay = document.getElementById('availability-request-edit-modal-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'availability-request-edit-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.72); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;';
  overlay.innerHTML = `
    <div style="width:min(720px, 100%); max-height:90vh; overflow:auto; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.18); border-radius:14px; padding:18px; box-shadow:0 24px 64px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 12px;">Edit approved PTO request</h2>
      <p class="muted" style="margin:0 0 14px;">Update the approved PTO details for this request.</p>
      <form id="availability-request-edit-form" class="stack">
        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:220px; flex:1;">
            <span>Agent</span>
            <input type="text" value="${escapeHtml(getAgent(request.agentId)?.name || 'Unknown')}" disabled />
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:180px; flex:1;">
            <span>Date</span>
            <input name="unavailableDate" type="date" value="${escapeHtml(request.unavailableDate || '')}" required />
          </label>
        </div>

        <div class="row" style="flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:6px; min-width:150px; flex:1;">
            <span>Start</span>
            <input name="unavailableStart" type="time" value="${escapeHtml(request.unavailableStart || '09:00')}" required />
          </label>
          <label style="display:flex; flex-direction:column; gap:6px; min-width:150px; flex:1;">
            <span>End</span>
            <input name="unavailableEnd" type="time" value="${escapeHtml(request.unavailableEnd || '17:00')}" required />
          </label>
        </div>

        <label style="display:flex; flex-direction:column; gap:6px;">
          <span>Note</span>
          <textarea name="note" rows="4" required>${escapeHtml(request.note || '')}</textarea>
        </label>

        <div class="row" style="justify-content:flex-end; margin-top:8px;">
          <button type="button" id="availability-request-edit-cancel" class="secondary">Cancel</button>
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

  overlay.querySelector('#availability-request-edit-cancel')?.addEventListener('click', () => {
    closeModal();
  });

  overlay.querySelector('#availability-request-edit-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextDate = String(formData.get('unavailableDate') || '').trim();
    if (!getDayFromDate(nextDate)) {
      alert('Enter a valid PTO date.');
      return;
    }

    const nextStart = String(formData.get('unavailableStart') || '').trim();
    const nextEnd = String(formData.get('unavailableEnd') || '').trim();
    if (!nextStart || !nextEnd || toMinutes(nextEnd) <= toMinutes(nextStart)) {
      alert('End time must be later than start time.');
      return;
    }

    const nextNote = String(formData.get('note') || '').trim();
    if (!nextNote) {
      alert('Enter a note for this PTO request.');
      return;
    }

    onSave({
      ...request,
      unavailableDate: nextDate,
      unavailableStart: nextStart,
      unavailableEnd: nextEnd,
      note: nextNote,
      updatedAt: new Date().toISOString()
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

function buildDateRangeDates(startDate, endDate, maxDays = 366) {
  const normalizedStartDate = String(startDate || '').slice(0, 10);
  const normalizedEndDate = String(endDate || '').slice(0, 10);
  if (!normalizedStartDate || !normalizedEndDate) {
    return { dates: [], truncated: false };
  }

  const parsedStartDate = new Date(`${normalizedStartDate}T00:00:00`);
  const parsedEndDate = new Date(`${normalizedEndDate}T00:00:00`);
  if (Number.isNaN(parsedStartDate.getTime()) || Number.isNaN(parsedEndDate.getTime()) || parsedEndDate < parsedStartDate) {
    return { dates: [], truncated: false };
  }

  const dates = [];
  let cursor = new Date(parsedStartDate);
  let truncated = false;
  while (cursor <= parsedEndDate) {
    dates.push(formatIsoDateLocal(cursor));
    if (dates.length >= maxDays) {
      truncated = true;
      break;
    }
    cursor.setDate(cursor.getDate() + 1);
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

function getAssignedHours(agentId, referenceDateValue = '') {
  const normalizedAgentId = Number(agentId);
  const weekDates = getCalendarWeekDates(referenceDateValue || getActiveCalendarWeekReference());
  return state.shifts
    .filter((shift) => Number(shift.agentId) === normalizedAgentId)
    .filter((shift) => shiftIsInWeek(shift, weekDates))
    .reduce((sum, shift) => sum + shift.durationHours, 0);
}

function isInOfficeRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return normalizedRole === 'in-person'
    || normalizedRole === 'in person'
    || normalizedRole.includes('in-person')
    || normalizedRole.includes('in person')
    || normalizedRole === 'office';
}

function getAssignedInOfficeShiftCount(agentId, referenceDateValue = '', options = {}) {
  const normalizedAgentId = Number(agentId);
  const weekDates = getCalendarWeekDates(referenceDateValue || getActiveCalendarWeekReference());
  const excludingShiftId = Number(options.excludingShiftId) || null;
  return state.shifts
    .filter((shift) => Number(shift.agentId) === normalizedAgentId)
    .filter((shift) => shiftIsInWeek(shift, weekDates))
    .filter((shift) => !excludingShiftId || Number(shift.id) !== excludingShiftId)
    .filter((shift) => isInOfficeRole(shift.role || getAgent(shift.agentId)?.role))
    .length;
}

function getApprovedPtoHours(agentId, referenceDateValue = '') {
  const normalizedAgentId = Number(agentId);
  const weekDates = getCalendarWeekDates(referenceDateValue || getActiveCalendarWeekReference());
  return getAllAvailabilityRequests()
    .filter((request) => Number(request.agentId) === normalizedAgentId)
    .filter((request) => request.status === 'approved')
    .filter((request) => String(request.unavailabilityType || '').trim() === 'PTO')
    .filter((request) => {
      const requestDate = String(request.unavailableDate || '').slice(0, 10);
      return requestDate && requestDate >= weekDates.Mon.iso && requestDate <= weekDates.Sun.iso;
    })
    .reduce((sum, request) => sum + getDurationHours(request.unavailableStart, request.unavailableEnd), 0);
}

function getMinimumHoursCredit(agentId, referenceDateValue = '') {
  return getAssignedHours(agentId, referenceDateValue) + getApprovedPtoHours(agentId, referenceDateValue);
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
  return state.agents.filter((agent) => {
    const matchesName = !search || String(agent.name || '').toLowerCase().includes(search);
    return matchesName;
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
  if (normalizedTeam === 'Audience Services Management') {
    return 'background:#A9B4E4; color:#1E2750; border:1px solid rgba(30,39,80,0.25);';
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

function getSwappableShiftsForAgent(agentId) {
  return state.shifts.filter((shift) => Number(shift.agentId) === Number(agentId) && isPublishedShift(shift));
}

function getWeekSwappableShiftsForAgent(agentId, referenceDateValue = getActiveCalendarWeekReference()) {
  const weekDates = getCalendarWeekDates(referenceDateValue);
  return getSwappableShiftsForAgent(agentId).filter((shift) => shiftIsInWeek(shift, weekDates));
}

function isSwapRestrictedAgent(agentOrAgentId) {
  const agent = typeof agentOrAgentId === 'object'
    ? agentOrAgentId
    : getAgent(agentOrAgentId);
  const normalizedName = String(agent?.name || '').trim().toLowerCase();
  return normalizedName === 'booth duty';
}

function getProjectedSwapHours(agentId, outgoingShift, incomingShift) {
  const currentHours = getAssignedHours(agentId, outgoingShift?.date || incomingShift?.date || '');
  const outgoingHours = Number(outgoingShift?.durationHours || 0);
  const incomingHours = Number(incomingShift?.durationHours || 0);
  return currentHours - outgoingHours + incomingHours;
}

function getProjectedSwapInOfficeShiftCount(agentId, outgoingShift, incomingShift) {
  const currentInOfficeCount = getAssignedInOfficeShiftCount(agentId, outgoingShift?.date || incomingShift?.date || '');
  const outgoingInOfficeCount = isInOfficeRole(outgoingShift?.role) ? 1 : 0;
  const incomingInOfficeCount = isInOfficeRole(incomingShift?.role) ? 1 : 0;
  return currentInOfficeCount - outgoingInOfficeCount + incomingInOfficeCount;
}

function getSwapRequestFromShiftId(request) {
  return Number(request?.fromShiftId || request?.shiftId || 0) || null;
}

function getSwapRequestToShiftId(request) {
  return Number(request?.toShiftId || request?.targetShiftId || 0) || null;
}

function getSwapRequestSummary(request) {
  const fromShift = getShiftById(getSwapRequestFromShiftId(request));
  const toShift = getShiftById(getSwapRequestToShiftId(request));
  if (!fromShift && !toShift) {
    return 'Swap request';
  }
  if (fromShift && !toShift) {
    return getShiftSummary(fromShift);
  }
  if (!fromShift && toShift) {
    return getShiftSummary(toShift);
  }
  return `${getShiftSummary(fromShift)} ↔ ${getShiftSummary(toShift)}`;
}

function getSwapRequestShiftLabel(request, side) {
  const shift = side === 'to' ? getShiftById(getSwapRequestToShiftId(request)) : getShiftById(getSwapRequestFromShiftId(request));
  return shift ? getShiftSummary(shift) : 'Unknown shift';
}

function isSwapRequestVisibleToAgent(request, agentId) {
  const isParticipant = Number(request?.fromAgentId) === Number(agentId) || Number(request?.toAgentId) === Number(agentId);
  if (!isParticipant) return false;
  const fromShift = getShiftById(getSwapRequestFromShiftId(request));
  const toShift = getShiftById(getSwapRequestToShiftId(request));
  return Boolean(fromShift || toShift || request?.status === 'pending' || request?.status === 'completed');
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

function getCalendarShiftSortMinutes(timeValue) {
  const [hoursPart, minutesPart] = String(timeValue || '').split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.MAX_SAFE_INTEGER;
  return (hours * 60) + minutes;
}

function getAgentTeamSortPriority(agentId) {
  const normalizedTeam = normalizeTeamLabel(getAgent(agentId)?.team || '');
  if (normalizedTeam === 'Audience Services Representative') return 0;
  if (normalizedTeam === 'Audience Services Associate') return 1;
  if (normalizedTeam === 'Audience Services Management') return 2;
  return 3;
}

function compareCalendarShiftDisplayOrder(leftShift, rightShift) {
  const startDiff = getCalendarShiftSortMinutes(leftShift?.start) - getCalendarShiftSortMinutes(rightShift?.start);
  if (startDiff !== 0) return startDiff;

  const teamDiff = getAgentTeamSortPriority(leftShift?.agentId) - getAgentTeamSortPriority(rightShift?.agentId);
  if (teamDiff !== 0) return teamDiff;

  const locationDiff = String(leftShift?.location || '').localeCompare(String(rightShift?.location || ''), undefined, { sensitivity: 'base' });
  if (locationDiff !== 0) return locationDiff;

  const leftName = String(getAgent(leftShift?.agentId)?.name || '');
  const rightName = String(getAgent(rightShift?.agentId)?.name || '');
  const nameDiff = leftName.localeCompare(rightName, undefined, { sensitivity: 'base' });
  if (nameDiff !== 0) return nameDiff;

  return Number(leftShift?.id || 0) - Number(rightShift?.id || 0);
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

function parseTime12HourInput(timeValue) {
  const normalizedValue = String(timeValue || '').trim().toUpperCase();
  const matches = normalizedValue.match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s*(AM|PM)$/);
  if (!matches) return '';
  let hours = Number(matches[1]);
  const minutes = matches[2];
  const period = matches[3];
  if (period === 'AM' && hours === 12) {
    hours = 0;
  } else if (period === 'PM' && hours < 12) {
    hours += 12;
  }
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function normalizeTimeInputValue(timeValue) {
  const normalizedValue = String(timeValue || '').trim();
  if (!normalizedValue) return '';
  if (/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(normalizedValue)) {
    return normalizedValue.padStart(5, '0');
  }
  return parseTime12HourInput(normalizedValue);
}

function formatTimeRange(startTime, endTime) {
  return `${formatTime12Hour(startTime)} - ${formatTime12Hour(endTime)}`;
}

function getShiftRoleLocationText(shift) {
  const role = String(shift?.role || getPrimaryRole()).trim() || getPrimaryRole();
  const location = String(shift?.location || '').trim();
  return location ? `${role} • ${location}` : role;
}

function getShiftRoleLocationHtml(shift) {
  const role = String(shift?.role || getPrimaryRole()).trim() || getPrimaryRole();
  const location = String(shift?.location || '').trim();
  return location
    ? `${escapeHtml(role)}<br />${escapeHtml(location)}`
    : `${escapeHtml(role)}`;
}

function getShiftSummary(shift, includeDay = true) {
  if (!shift) return 'Shift';
  const segments = [];
  if (includeDay && shift.day) {
    segments.push(shift.day);
  }
  segments.push(getShiftRoleLocationText(shift));
  segments.push(formatTimeRange(shift.start, shift.end));
  return segments.join(' | ');
}

function getAllLocations() {
  return Array.from(new Set([...getLocationCatalog(), ...state.shifts.map((shift) => shift.location).filter(Boolean)])).sort();
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

async function exportData() {
  const exportState = {
    ...state,
    policies: await Promise.all((Array.isArray(state.policies) ? state.policies : []).map(async (policy) => {
      const bytes = await getPolicyBytes(policy);
      return {
        ...policy,
        contentBase64: bytes ? bytesToBase64(bytes) : ''
      };
    }))
  };
  const blob = new Blob([JSON.stringify(exportState, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scheduler-export.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  try {
    const fileText = await readFileAsText(file);
    const parsed = JSON.parse(fileText);
    const importedPolicies = normalizePolicies(parsed?.policies);

    Object.assign(state, parsed);
    state.policies = importedPolicies;
    state.roleColors = parsed.roleColors && typeof parsed.roleColors === 'object' ? parsed.roleColors : {};
    state.ui = loadUiState(parsed.ui);

    for (const importedPolicy of importedPolicies) {
      const legacyBase64 = String(importedPolicy?.legacyContentBase64 || importedPolicy?.contentBase64 || '').trim();
      if (!legacyBase64) continue;
      const bytes = base64ToBytes(legacyBase64);
      if (!bytes) continue;
      await savePolicyFileBytes(importedPolicy.id, importedPolicy.mimeType || 'application/octet-stream', bytes);
    }

    state.policies = sanitizePoliciesForStorage(importedPolicies);
    saveState();
    saveUiState();
    render();
  } catch {
    alert('The selected file is not a valid scheduler export.');
  }
}

function renderAdminNavigationLinks(options = {}) {
  const includeExport = options?.includeExport !== false;
  const includeImport = options?.includeImport !== false;
  return [
    '<a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a>',
    '<a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Schedule</button></a>',
    '<a href="index.html?view=availability-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Availability Requests</button></a>',
    '<a href="index.html?view=agents" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Agents</button></a>',
    '<a href="index.html?view=policies" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Policies</button></a>',
    '<a href="index.html?view=admin-options" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Options</button></a>',
    '<a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Admin Profile</button></a>',
    '<a href="index.html?view=email-outbox" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Email Outbox</button></a>',
    includeExport ? '<button id="export-data-btn" class="secondary">Export JSON</button>' : '',
    includeImport ? '<label class="secondary" style="display:inline-flex; align-items:center; padding:10px 12px; border-radius:10px; cursor:pointer;"><input id="import-data-input" type="file" accept="application/json" hidden />Import JSON</label>' : ''
  ].filter(Boolean).join('');
}

function renderAgentNavigationLinks() {
  return [
    '<a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Dashboard</button></a>',
    '<a href="index.html?view=calendar" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Schedule</button></a>',
    '<a href="index.html?view=pending-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Pending requests</button></a>',
    '<a href="index.html?view=agent-requests" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Approved requests</button></a>',
    '<a href="index.html?view=policies" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Policies</button></a>',
    '<a href="index.html?view=profile" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">My profile</button></a>'
  ].join('');
}

function renderAbsenceManagerNavigationLinks() {
  return renderAgentNavigationLinks();
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
  const isAgentView = isAgentLikeUser(currentUser);
  const isTeamLeadView = isTeamLeadUser(currentUser);
  const canManageCalendar = canManageSchedule(currentUser);
  const canMarkAbsence = canMarkShiftAbsences(currentUser);
  const viewAgent = getViewAgent();
  const currentAgentId = Number(currentUser?.agentId) || Number(viewAgent?.id) || null;
  const baseCalendarShifts = getFilteredCalendarShifts();
  const scopedCalendarShifts = baseCalendarShifts.filter((shift) => shiftIsInWeek(shift, weekDates));
  const visibleCalendarShifts = isAgentView
    ? scopedCalendarShifts.filter((shift) => isPublishedShift(shift))
    : scopedCalendarShifts;
  const sortedVisibleCalendarShifts = [...visibleCalendarShifts].sort(compareCalendarShiftDisplayOrder);
  const agentViewShifts = getAgentViewShifts();
  const visibleShiftIdSet = new Set(sortedVisibleCalendarShifts.map((shift) => Number(shift.id)));
  selectedCalendarShiftIds = new Set(Array.from(selectedCalendarShiftIds).filter((id) => visibleShiftIdSet.has(Number(id))));
  const selectedShiftCount = selectedCalendarShiftIds.size;

  root.innerHTML = `
    <div class="app calendar-view">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>${isAgentView ? 'My calendar' : 'Calendar view'}</h1>
          <p class="muted">${isAgentView ? (isTeamLeadView ? 'Review the full published team schedule, request swaps, and mark absences.' : 'Review the full published team schedule and request swaps for your own shifts.') : 'Filter shifts by day, agent, or venue in a dedicated planning page.'}</p>
        </div>
        <div class="row">
          ${isAgentView ? renderAgentNavigationLinks() : renderAdminNavigationLinks({ includeExport: true })}
          ${renderUserNavChip(currentUser)}
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
            <option value="All" ${calendarFilters.location === 'All' ? 'selected' : ''}>All venues</option>
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

      ${canManageCalendar ? `
        <div class="panel" style="margin-bottom:16px;">
          <h3>Create shift</h3>
          <form id="add-shift-form" class="stack">
            <div class="row">
              <select name="templateId">
                <option value="">Use template (optional)</option>
                ${state.templates.filter((template) => isTemplateActive(template)).map((template) => `<option value="${template.id}">${escapeHtml(template.name)} (${escapeHtml(formatTimeRange(template.start, template.end))})</option>`).join('')}
              </select>
              <select name="agentId">
                <option value="">Unassigned (optional)</option>
                ${[...state.agents].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })).map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('')}
              </select>
              <select name="role" required>
                ${getRoleLegendItems().map((role) => `<option value="${role}">${escapeHtml(role)}</option>`).join('')}
              </select>
            </div>
            <div class="row">
              <input name="start" type="time" value="08:00" required />
              <input name="end" type="time" value="16:00" required />
              <select name="location">
                <option value="">No venue</option>
                ${getLocationCatalog().map((location) => `<option value="${location}">${escapeHtml(location)}</option>`).join('')}
              </select>
              <input name="date" type="date" required />
            </div>
            <button type="submit">Add shift</button>
          </form>
        </div>` : ''}

      ${isAgentView ? `
        <div class="panel" style="margin-bottom:16px;">
          <h3>Swap a shift</h3>
          <div class="muted" style="margin-bottom:8px;">Swaps are limited to the active calendar week.</div>
          <form id="swap-form" class="stack">
            <div class="row" style="flex-wrap:wrap;">
              <select name="fromShiftId" required>
                <option value="">Select your shift</option>
                ${getWeekSwappableShiftsForAgent(viewAgent?.id, weekReference).map((shift) => `<option value="${shift.id}">${escapeHtml(getShiftSummary(shift))}</option>`).join('')}
              </select>
              <select name="toAgentId" required>
                <option value="">Swap with agent</option>
                ${state.agents.filter((agent) => agent.id !== viewAgent?.id && !isSwapRestrictedAgent(agent)).map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('')}
              </select>
              <select name="toShiftId" required>
                <option value="">Select their shift</option>
                ${state.shifts.filter((shift) => Number(shift.agentId) !== Number(viewAgent?.id) && !isSwapRestrictedAgent(shift.agentId) && isPublishedShift(shift) && shiftIsInWeek(shift, getCalendarWeekDates(weekReference))).map((shift) => `<option value="${shift.id}">${escapeHtml(`${getAgent(shift.agentId)?.name || 'Unknown'} - ${getShiftSummary(shift)}`)}</option>`).join('')}
              </select>
            </div>
            <button type="submit">Request swap</button>
          </form>
        </div>` : ''}

      <div class="panel">
        ${canManageCalendar ? `<div class="muted" style="margin-bottom:10px;">${copiedShiftTemplate ? `Copied: ${escapeHtml(getShiftSummary(copiedShiftTemplate))}` : 'Copy a shift, then use Paste here on any day.'}</div>` : ''}
        <div class="row" style="margin-bottom:10px;">
          ${getRoleLegendItems().map((role) => `
            <span class="chip" style="background:${getRoleColor(role)}; border:1px solid rgba(255,255,255,0.25);">${escapeHtml(role)}</span>
          `).join('')}
        </div>
        ${canManageCalendar ? `<div class="row" style="margin-bottom:10px; justify-content:space-between; align-items:center;"><div class="muted">Selected shifts: ${selectedShiftCount}</div><div class="row calendar-admin-bulk-actions"><button type="button" class="secondary" data-select-visible-shifts>Select all visible</button><button type="button" class="secondary" data-clear-selected-shifts ${selectedShiftCount === 0 ? 'disabled' : ''}>Clear</button><button type="button" class="success" data-publish-selected-shifts ${selectedShiftCount === 0 ? 'disabled' : ''}>Publish selected</button><button type="button" class="danger" data-remove-selected-shifts ${selectedShiftCount === 0 ? 'disabled' : ''}>Remove selected</button></div></div>` : ''}
        <div class="day-row">
          ${days.map((day) => `
            <div class="day-card" data-day="${day}" data-date="${escapeHtml(weekDates[day]?.iso || '')}">
              <div class="row" style="justify-content:space-between; margin-bottom:6px;">
                <div>
                  <h4 style="margin:0;">${day}</h4>
                  <div class="muted">${escapeHtml(weekDates[day]?.label || '')}</div>
                  ${getBlackoutDateMarker(weekDates[day]?.iso || '')}
                </div>
                ${canManageCalendar ? `<button class="secondary" type="button" data-paste-shift-day="${day}" ${copiedShiftTemplate ? '' : 'disabled'}>Paste here</button>` : ''}
              </div>
              ${sortedVisibleCalendarShifts.filter((shift) => shift.day === day).map((shift) => {
                const absenceReason = normalizeShiftAbsenceReason(shift?.absenceReason);
                return `
                <div class="shift ${canManageCalendar && selectedCalendarShiftIds.has(Number(shift.id)) ? 'selected' : ''}" draggable="${canManageCalendar ? 'true' : 'false'}" data-shift-id="${shift.id}" style="${getShiftStyle(shift)}">
                  <div class="row" style="justify-content:flex-start; align-items:center; gap:6px; margin-bottom:2px;">
                    ${canManageCalendar ? `<input type="checkbox" data-shift-select-checkbox="${shift.id}" ${selectedCalendarShiftIds.has(Number(shift.id)) ? 'checked' : ''} aria-label="Select shift for bulk actions" />` : ''}
                    <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong>
                  </div>
                  ${!isAgentView && getAgent(shift.agentId)?.team ? `<div class="muted">${escapeHtml(normalizeTeamLabel(getAgent(shift.agentId)?.team))}</div>` : ''}
                  ${getShiftRoleLocationHtml(shift)}<br />${formatTimeRange(shift.start, shift.end)}
                  ${!isAgentView ? `<div class="muted" style="margin-top:6px; text-transform:capitalize;">${escapeHtml(shift.status || shiftStatuses.draft)}${absenceReason ? ` • absent (${escapeHtml(absenceReason)})` : ''}</div><div class="row calendar-shift-actions" style="margin-top:6px;">${canManageCalendar ? `<button type="button" class="secondary" data-edit-shift="${shift.id}">Edit</button><button type="button" class="secondary" data-copy-dup-shift="${shift.id}">Copy/Dup</button>` : ''}${canMarkAbsence ? `<button type="button" class="secondary" data-mark-shift-absent="${shift.id}">${absenceReason ? 'Update absent' : 'Absent'}</button>${absenceReason ? `<button type="button" class="secondary" data-clear-shift-absent="${shift.id}">Clear absent</button>` : ''}` : ''}${canManageCalendar && shift.status !== shiftStatuses.published ? `<button type="button" class="success" data-publish-shift="${shift.id}">Publish</button>` : ''}</div>` : ''}
                  ${isAgentView ? `
                    <div class="muted" style="margin-top:6px; text-transform:capitalize;">${escapeHtml(shift.status || shiftStatuses.draft)}${absenceReason ? ` • absent (${escapeHtml(absenceReason)})` : ''}${isShiftOfferedForPickup(shift) ? ' • offered for pickup' : ''}</div>
                    <div class="row" style="margin-top:6px;">
                      ${canMarkAbsence ? `<button type="button" class="secondary" data-mark-shift-absent="${shift.id}">${absenceReason ? 'Update absent' : 'Absent'}</button>${absenceReason ? `<button type="button" class="secondary" data-clear-shift-absent="${shift.id}">Clear absent</button>` : ''}` : ''}
                      ${canAgentOfferShift(shift, currentAgentId) ? `<button type="button" class="secondary" data-offer-shift="${shift.id}">${isShiftOfferedForPickup(shift) ? 'Cancel offer' : 'Offer shift'}</button>` : ''}
                      ${canAgentPickUpOfferedShift(shift, currentAgentId) ? `<button type="button" class="success" data-pickup-offered-shift="${shift.id}">Pick up shift</button>` : ''}
                    </div>
                  ` : ''}
                </div>
              `;
              }).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderProfilePage(currentUser) {
  const isAdminView = isAdminUser(currentUser);
  const isAgentView = isAgentLikeUser(currentUser);
  const isAbsenceManagerView = isTeamLeadUser(currentUser);
  if (isAdminView) {
    const adminUsers = authUsers
      .filter((user) => isAdminUser(user))
      .sort((left, right) => String(left.name || left.username || '').localeCompare(String(right.name || right.username || ''), undefined, { sensitivity: 'base' }));

    root.innerHTML = `
      <div class="app">
        <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
          <div>
            <h1>Admin profile</h1>
            <p class="muted">Review your admin account details.</p>
          </div>
          <div class="row">
            ${renderAdminNavigationLinks({ includeExport: true })}
            ${renderUserNavChip(currentUser)}
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
                ${currentUser?.profilePhotoDataUrl ? `<div style="margin-bottom:10px;"><img src="${escapeHtml(currentUser.profilePhotoDataUrl)}" alt="Profile photo" style="width:84px; height:84px; border-radius:12px; object-fit:cover; border:1px solid rgba(255,255,255,0.35);" /></div>` : ''}
                <div><strong>Name:</strong> ${escapeHtml(currentUser?.name || currentUser?.username || 'Not set')}</div>
                <div><strong>Job title:</strong> ${escapeHtml(currentUser?.jobTitle || 'Scheduling Administrator')}</div>
                <div><strong>Email:</strong> ${escapeHtml(currentUser?.email || 'Not set')}</div>
                <div><strong>Phone:</strong> ${escapeHtml(currentUser?.phone || 'Not set')}</div>
              </div>
            </div>

            <div class="panel">
              <h2>Profile photo</h2>
              <p class="muted">Upload a JPG, PNG, GIF, or WEBP image up to 8 MB.</p>
              <form id="upload-profile-photo-form" class="stack" style="margin-top:10px;">
                <input name="profilePhoto" type="file" accept="image/*" required />
                <div class="row" style="gap:8px;">
                  <button type="submit">Upload photo</button>
                  ${currentUser?.profilePhotoDataUrl ? '<button id="remove-profile-photo" type="button" class="danger">Remove photo</button>' : ''}
                </div>
              </form>
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
                <select name="accessRole" required>
                  <option value="${userRoles.admin}">Admin (full access)</option>
                </select>
                <button type="submit">Add manager</button>
              </form>
              <div class="request-list" style="margin-top:12px;">
                ${adminUsers.map((adminUser) => `
                  <div class="card">
                    <form class="stack" data-update-admin-form="${adminUser.id}">
                      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                        <strong>${escapeHtml(adminUser.name || adminUser.username || 'Manager')}</strong>
                        <div class="muted">Status: ${escapeHtml(adminUser.isActive === false ? 'Inactive' : 'Active')} • Access: ${escapeHtml(getUserRoleLabel(adminUser.role))}</div>
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap;">
                        <input name="name" value="${escapeHtml(adminUser.name || '')}" placeholder="Manager name" required />
                        <input name="jobTitle" value="${escapeHtml(adminUser.jobTitle || 'Scheduling Manager')}" placeholder="Job title" required />
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap;">
                        <input name="email" type="email" value="${escapeHtml(adminUser.email || '')}" placeholder="Email" required autocomplete="email" />
                        <input name="phone" type="tel" value="${escapeHtml(adminUser.phone || '')}" placeholder="Phone" required autocomplete="tel" />
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap;">
                        <select name="accessRole" required>
                          <option value="${userRoles.admin}" ${isAdminUser(adminUser) ? 'selected' : ''}>Admin (full access)</option>
                        </select>
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
              <h2>Invite login URL</h2>
              <p class="muted">Set the exact public URL agents should open for sign in (example: https://your-app.example.com/index.html).</p>
              <form id="admin-app-login-url-form" class="stack" style="margin-top:10px;">
                <input name="appLoginUrl" type="url" placeholder="https://your-app.example.com/index.html" value="${escapeHtml(loadConfiguredAppLoginUrl() || getAppLoginUrl())}" />
                <div class="row">
                  <button type="submit">Save invite login URL</button>
                  <button type="button" id="clear-app-login-url" class="secondary">Use current page URL</button>
                </div>
                <div class="muted">Current invite login URL: ${escapeHtml(loadConfiguredAppLoginUrl() || getAppLoginUrl())}</div>
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
            phone,
            updatedAt: getCurrentIsoTimestamp(),
            profileUpdatedAt: getCurrentIsoTimestamp()
          }
        : user);
      const didSaveAuthUsers = saveAuthUsers();
      if (!didSaveAuthUsers) {
        adminProfileNotice = {
          type: 'error',
          text: 'Unable to save admin profile changes right now. Please check browser storage settings and try again.'
        };
        render();
        return;
      }
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
      const accessRole = normalizeUserRole(formData.get('accessRole'));

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
        createdAt: getCurrentIsoTimestamp(),
        updatedAt: getCurrentIsoTimestamp(),
        profileUpdatedAt: getCurrentIsoTimestamp(),
        role: accessRole
      });
      authUsers.push(nextAdminUser);
      const didSaveAuthUsers = saveAuthUsers();
      if (!didSaveAuthUsers) {
        adminManagerNotice = {
          type: 'error',
          text: 'Unable to save manager account right now. Please check browser storage settings and try again.',
          resetLink: ''
        };
        render();
        return;
      }
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
        const adminUser = authUsers.find((user) => isAdminUser(user) && Number(user.id) === adminId);
        if (!adminUser) return;

        const formData = new FormData(form);
        const name = formData.get('name')?.toString().trim() || '';
        const jobTitle = formData.get('jobTitle')?.toString().trim() || '';
        const email = normalizeEmail(formData.get('email'));
        const phone = normalizePhone(formData.get('phone'));
        const accessRole = normalizeUserRole(formData.get('accessRole'));

        if (!name || !jobTitle || !email || !phone) {
          alert('All manager fields are required.');
          return;
        }

        const emailInUse = authUsers.some((user) => user.id !== adminId && normalizeEmail(user.email) === email);
        if (emailInUse) {
          alert('That email address is already in use by another account.');
          return;
        }

        const demotingLastActiveAdmin = isAdminUser(adminUser)
          && accessRole !== userRoles.admin
          && adminUser.isActive !== false
          && getActiveAdminCount() <= 1;
        if (demotingLastActiveAdmin) {
          alert('You cannot change the last active admin to team lead.');
          return;
        }

        authUsers = authUsers.map((user) => user.id === adminId
          ? {
              ...user,
              name,
              jobTitle,
              email,
              phone,
              role: accessRole,
              updatedAt: getCurrentIsoTimestamp(),
              profileUpdatedAt: getCurrentIsoTimestamp()
            }
          : user);
        const didSaveAuthUsers = saveAuthUsers();
        if (!didSaveAuthUsers) {
          adminManagerNotice = {
            type: 'error',
            text: 'Unable to save manager details right now. Please check browser storage settings and try again.',
            resetLink: ''
          };
          render();
          return;
        }
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

      authUsers = authUsers.map((user) => user.id === activeUser.id
        ? { ...user, password: newPassword, passwordUpdatedAt: getCurrentIsoTimestamp() }
        : user);
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
        const adminUser = authUsers.find((user) => isAdminUser(user) && Number(user.id) === adminId);
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
        const adminUser = authUsers.find((user) => isAdminUser(user) && Number(user.id) === adminId);
        if (!adminUser) return;
        const isDeactivating = adminUser.isActive !== false;
        if (isDeactivating && isAdminUser(adminUser) && getActiveAdminCount() <= 1) {
          alert('You cannot deactivate the last active admin account.');
          return;
        }
        const actionLabel = isDeactivating ? 'deactivate' : 'reactivate';
        const shouldProceed = confirm(`Are you sure you want to ${actionLabel} ${adminUser.name || adminUser.username || 'this manager'}?`);
        if (!shouldProceed) return;
        authUsers = authUsers.map((user) => user.id === adminId
          ? { ...user, isActive: !isDeactivating }
          : user);
        const didSaveAuthUsers = saveAuthUsers();
        if (!didSaveAuthUsers) {
          adminManagerNotice = {
            type: 'error',
            text: 'Unable to save manager status right now. Please check browser storage settings and try again.',
            resetLink: ''
          };
          syncFromStorage();
          render();
          return;
        }
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
        const adminUser = authUsers.find((user) => isAdminUser(user) && Number(user.id) === adminId);
        if (!adminUser) return;
        if (activeUser?.id === adminId) {
          alert('You cannot remove the manager account you are currently signed in with.');
          return;
        }
        const activeAdminCount = getActiveAdminCount();
        if (isAdminUser(adminUser) && adminUser.isActive !== false && activeAdminCount <= 1) {
          alert('You cannot remove the last active admin account.');
          return;
        }
        const shouldRemove = confirm(`Remove manager ${adminUser.name || adminUser.username || 'this account'}?`);
        if (!shouldRemove) return;
        authUsers = authUsers.filter((user) => Number(user.id) !== adminId);
        const didSaveAuthUsers = saveAuthUsers();
        if (!didSaveAuthUsers) {
          adminManagerNotice = {
            type: 'error',
            text: 'Unable to remove manager right now. Please check browser storage settings and try again.',
            resetLink: ''
          };
          syncFromStorage();
          render();
          return;
        }
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

    document.getElementById('admin-app-login-url-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const configuredLoginUrl = normalizeAppLoginUrl(formData.get('appLoginUrl'));
      if (!configuredLoginUrl) {
        alert('Enter a valid absolute URL (example: https://your-app.example.com/index.html).');
        return;
      }
      safeSetLocalStorage(appLoginUrlKey, configuredLoginUrl);
      adminProfileNotice = {
        type: 'success',
        text: `Invite login URL saved: ${configuredLoginUrl}`
      };
      render();
    });

    document.getElementById('clear-app-login-url')?.addEventListener('click', () => {
      localStorage.removeItem(appLoginUrlKey);
      if (backendApiBase && !isApplyingRemoteSnapshot) {
        void pushLocalSnapshotToBackend();
      }
      adminProfileNotice = {
        type: 'success',
        text: `Invite login URL reset to current page URL: ${getAppLoginUrl()}`
      };
      render();
    });

    document.getElementById('admin-blackout-dates-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      state.blackoutDates = normalizeBlackoutDates(formData.get('blackoutDates'));
      saveState();
      if (pageMode === 'profile') {
        adminProfileNotice = {
          type: 'success',
          text: 'Blackout dates saved. Agents cannot submit time-off requests for those dates.'
        };
      } else {
        alert('Blackout dates saved. Agents cannot submit time-off requests for those dates.');
      }
      render();
    });

    bindProfilePhotoHandlers();

    document.getElementById('logout-btn')?.addEventListener('click', () => {
      clearSession();
      render();
    });
    return;
  }

  if (isAbsenceManagerView && !isAgentView) {
    root.innerHTML = `
      <div class="app">
        <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
          <div>
            <h1>My profile</h1>
            <p class="muted">Update your account details and password.</p>
          </div>
          <div class="row">
            ${renderAbsenceManagerNavigationLinks()}
            ${renderUserNavChip(currentUser)}
            <button id="logout-btn" class="secondary" type="button">Log out</button>
          </div>
        </div>

        <div class="grid" style="margin-top:16px; grid-template-columns:1fr;">
          <div class="stack">
            <div class="panel">
              <div class="card" style="margin-bottom:10px;">
                ${currentUser?.profilePhotoDataUrl ? `<div style="margin-bottom:10px;"><img src="${escapeHtml(currentUser.profilePhotoDataUrl)}" alt="Profile photo" style="width:84px; height:84px; border-radius:12px; object-fit:cover; border:1px solid rgba(255,255,255,0.35);" /></div>` : ''}
                <div><strong>Name:</strong> ${escapeHtml(currentUser?.name || currentUser?.username || 'Not set')}</div>
                <div><strong>Job title:</strong> ${escapeHtml(currentUser?.jobTitle || 'Team Lead')}</div>
                <div><strong>Email:</strong> ${escapeHtml(currentUser?.email || 'Not set')}</div>
                <div><strong>Phone:</strong> ${escapeHtml(currentUser?.phone || 'Not set')}</div>
              </div>
            </div>

            <div class="panel">
              <h2>Profile photo</h2>
              <p class="muted">Upload a JPG, PNG, GIF, or WEBP image up to 8 MB.</p>
              <form id="upload-profile-photo-form" class="stack" style="margin-top:10px;">
                <input name="profilePhoto" type="file" accept="image/*" required />
                <div class="row" style="gap:8px;">
                  <button type="submit">Upload photo</button>
                  ${currentUser?.profilePhotoDataUrl ? '<button id="remove-profile-photo" type="button" class="danger">Remove photo</button>' : ''}
                </div>
              </form>
            </div>

            <div class="panel">
              <h2>Edit profile</h2>
              <form id="admin-update-profile-form" class="stack" style="margin-top:10px;">
                <input name="name" placeholder="Name" value="${escapeHtml(currentUser?.name || currentUser?.username || '')}" required />
                <input name="jobTitle" placeholder="Job title" value="${escapeHtml(currentUser?.jobTitle || 'Team Lead')}" required />
                <input name="email" type="email" placeholder="Email" value="${escapeHtml(currentUser?.email || '')}" required autocomplete="email" />
                <input name="phone" type="tel" placeholder="Phone" value="${escapeHtml(currentUser?.phone || '')}" required autocomplete="tel" />
                <button type="submit">Save profile</button>
              </form>
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
            phone,
            updatedAt: getCurrentIsoTimestamp(),
            profileUpdatedAt: getCurrentIsoTimestamp()
          }
        : user);
      const didSaveAuthUsers = saveAuthUsers();
      if (!didSaveAuthUsers) {
        alert('Unable to save profile changes right now. Please check browser storage settings and try again.');
        render();
        return;
      }
      alert('Profile updated successfully.');
      render();
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

      authUsers = authUsers.map((user) => user.id === activeUser.id
        ? { ...user, password: newPassword, passwordUpdatedAt: getCurrentIsoTimestamp() }
        : user);
      saveAuthUsers();
      alert('Password updated successfully.');
      render();
    });

    bindProfilePhotoHandlers();

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
    <div class="app agents-compact">
      <style>
        .agents-compact .panel { padding: 14px; }
        .agents-compact .card { padding: 8px !important; }
        .agents-compact .row { gap: 6px; }
        .agents-compact input,
        .agents-compact select,
        .agents-compact button,
        .agents-compact textarea { padding: 6px 8px; font-size: 0.84rem; border-radius: 8px; }
        .agents-compact .chip { padding: 4px 8px; font-size: 0.78rem; }
        .agents-compact .muted { font-size: 0.82rem; }
      </style>
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
        <div>
          <h1>My profile</h1>
          <p class="muted">Review your account details. You can update your phone number and password here; all other changes must be made by an admin.</p>
        </div>
        <div class="row">
          ${renderAgentNavigationLinks()}
          ${renderUserNavChip(currentUser)}
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="grid" style="margin-top:16px; grid-template-columns:1fr;">
        <div class="stack">
          <div class="panel">
            <div class="card" style="margin-bottom:10px;">
              ${activeAgentUser?.profilePhotoDataUrl ? `<div style="margin-bottom:10px;"><img src="${escapeHtml(activeAgentUser.profilePhotoDataUrl)}" alt="Profile photo" style="width:84px; height:84px; border-radius:12px; object-fit:cover; border:1px solid rgba(255,255,255,0.35);" /></div>` : ''}
              <div><strong>Name:</strong> ${escapeHtml(viewAgent?.name || 'Not set')}</div>
              <div><strong>Team:</strong> ${escapeHtml(viewAgent?.team || 'Not set')}</div>
              <div><strong>Pay rate:</strong> $${escapeHtml(viewAgent?.payRate ?? 0)}/hr</div>
              <div><strong>Attendance points:</strong> ${escapeHtml(normalizeAttendancePoints(viewAgent?.attendancePoints))}</div>
              <div><strong>Skills:</strong> ${escapeHtml(getAgentSkillsSummary(viewAgent?.skills))}</div>
              <div><strong>Email:</strong> ${escapeHtml(activeAgentUser?.email || 'Not set')}</div>
              <div><strong>Phone:</strong> ${escapeHtml(activeAgentUser?.phone || 'Not set')}</div>
            </div>
          </div>

          <div class="panel">
            <h2>Profile photo</h2>
            <p class="muted">Upload a JPG, PNG, GIF, or WEBP image up to 2 MB.</p>
            <form id="upload-profile-photo-form" class="stack" style="margin-top:10px;">
              <input name="profilePhoto" type="file" accept="image/*" required />
              <div class="row" style="gap:8px;">
                <button type="submit">Upload photo</button>
                ${activeAgentUser?.profilePhotoDataUrl ? '<button id="remove-profile-photo" type="button" class="danger">Remove photo</button>' : ''}
              </div>
            </form>
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

          <div class="panel">
            <h2>Reset password</h2>
            <form id="agent-reset-password-form" class="stack" style="margin-top:10px;">
              <input name="currentPassword" type="password" placeholder="Current password" required autocomplete="current-password" />
              <input name="newPassword" type="password" placeholder="New password" required autocomplete="new-password" />
              <input name="confirmPassword" type="password" placeholder="Confirm new password" required autocomplete="new-password" />
              <button type="submit">Save new password</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function renderAdminOptionsPage(currentUser) {
  const isAdminView = currentUser.role === 'admin';
  if (!isAdminView) {
    root.innerHTML = `
      <div class="app">
        <div class="panel">
          <h1>Admin options</h1>
          <p class="muted">This page is available for admin accounts only.</p>
          <a href="index.html" style="color:#fff; text-decoration:none;"><button class="secondary" type="button">Back to dashboard</button></a>
        </div>
      </div>
    `;
    return;
  }

  const roleChoices = getRoleCatalog();
  const locationChoices = getLocationCatalog();

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Admin options</h1>
          <p class="muted">Manage shift templates, roles, venues, and role colors from one page.</p>
        </div>
        <div class="row">
          ${renderAdminNavigationLinks({ includeExport: true })}
          ${renderUserNavChip(currentUser)}
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:1fr; gap:12px;">
        <div class="panel">
          <h2>Shift templates</h2>
          <form id="add-shift-template-form" class="stack" style="margin-bottom:12px;">
            <div class="row" style="flex-wrap:wrap;">
              <input name="name" placeholder="Template name" required />
              <input name="start" type="time" value="08:00" required />
              <input name="end" type="time" value="16:00" required />
              <select name="role">
                <option value="">No default role</option>
                ${roleChoices.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join('')}
              </select>
              <select name="location">
                <option value="">No default venue</option>
                ${locationChoices.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('')}
              </select>
              <label class="row" style="gap:6px; align-items:center; white-space:nowrap;">
                <input name="active" type="checkbox" checked />
                <span>Active</span>
              </label>
              <button type="submit">Add template</button>
            </div>
          </form>
          <div class="request-list">
            ${state.templates.map((template) => `
              <div class="card" style="padding:10px;">
                <form class="stack" data-update-shift-template="${template.id}" style="gap:8px;">
                  <div class="row" style="flex-wrap:wrap; align-items:flex-end;">
                    <input name="name" value="${escapeHtml(template.name || '')}" required />
                    <input name="start" type="time" value="${escapeHtml(normalizeTimeInputValue(template.start || '08:00') || '08:00')}" required />
                    <input name="end" type="time" value="${escapeHtml(normalizeTimeInputValue(template.end || '16:00') || '16:00')}" required />
                    <select name="role">
                      <option value="">No default role</option>
                      ${roleChoices.map((role) => `<option value="${escapeHtml(role)}" ${String(template.role || '') === String(role) ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('')}
                    </select>
                    <select name="location">
                      <option value="">No default venue</option>
                      ${locationChoices.map((location) => `<option value="${escapeHtml(location)}" ${String(template.location || '') === String(location) ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('')}
                    </select>
                    <label class="row" style="gap:6px; align-items:center; white-space:nowrap;">
                      <input name="active" type="checkbox" ${isTemplateActive(template) ? 'checked' : ''} />
                      <span>Active</span>
                    </label>
                    <button class="secondary" type="submit">Save</button>
                    <button class="danger" type="button" data-remove-shift-template="${template.id}">Remove</button>
                  </div>
                  <div class="muted">Template time: ${escapeHtml(formatTimeRange(template.start || '08:00', template.end || '16:00'))}</div>
                </form>
              </div>
            `).join('') || '<div class="muted">No shift templates yet.</div>'}
          </div>
        </div>

        <div class="panel">
          <h2>Venues</h2>
          <form id="add-shift-location-form" class="row" style="margin-bottom:10px;">
            <input name="location" placeholder="Add venue" required />
            <button type="submit">Add venue</button>
          </form>
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            ${locationChoices.map((location) => `<span class="chip" style="display:inline-flex; align-items:center; gap:8px;">${escapeHtml(location)}<button type="button" class="danger" data-remove-shift-location="${escapeHtml(location)}" style="padding:4px 8px;">Remove</button></span>`).join('')}
          </div>
        </div>

        <div class="panel">
          <h2>Roles</h2>
          <form id="add-shift-role-form" class="row" style="margin-bottom:10px;">
            <input name="role" placeholder="Add role" required />
            <button type="submit">Add role</button>
          </form>
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            ${roleChoices.map((role) => `<span class="chip" style="display:inline-flex; align-items:center; gap:8px;">${escapeHtml(role)}<button type="button" class="danger" data-remove-shift-role="${escapeHtml(role)}" style="padding:4px 8px;">Remove</button></span>`).join('')}
          </div>
        </div>

        <div class="panel">
          <h2>Policies</h2>
          <p class="muted">Upload policy files that agents can view and download from the Policies page.</p>
          <form id="upload-policy-form" class="row" style="margin-bottom:10px; flex-wrap:wrap;">
            <input name="policyFile" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
            <button type="submit">Upload policy</button>
          </form>
          <div class="request-list">
            ${(Array.isArray(state.policies) ? state.policies : []).map((policy) => `
              <div class="card">
                <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                  <div>
                    <div class="row" style="gap:8px; align-items:center; flex-wrap:wrap;">
                      <strong>${escapeHtml(policy.name || 'Policy')}</strong>
                      <span class="chip" style="font-size:0.72rem; padding:3px 8px;">${escapeHtml(getPolicyTypeLabel(policy))}</span>
                    </div>
                    <div class="muted">Uploaded: ${escapeHtml(policy.uploadedAt ? new Date(policy.uploadedAt).toLocaleString() : 'Unknown')}</div>
                    <div class="muted">Size: ${escapeHtml(formatBytes(policy.sizeBytes))}</div>
                  </div>
                  <div class="row" style="gap:8px;">
                    ${canPreviewPolicyInline(policy) ? `<button type="button" class="secondary" data-preview-policy="${policy.id}">Preview ${escapeHtml(getPolicyTypeLabel(policy))}</button>` : ''}
                    <button type="button" class="secondary" data-download-policy="${policy.id}">Download</button>
                    <button type="button" class="danger" data-delete-policy="${policy.id}">Delete</button>
                  </div>
                </div>
              </div>
            `).join('') || '<div class="muted">No policy files uploaded yet.</div>'}
          </div>
        </div>

        ${renderPolicyPreviewModal()}

        <div class="panel">
          <h2>Blackout dates</h2>
          <p class="muted">Agents cannot submit time-off requests for these dates. Enter one date per line.</p>
          <form id="admin-blackout-dates-form" class="stack" style="margin-top:10px;">
            <textarea name="blackoutDates" rows="6" placeholder="2026-12-24&#10;2026-12-25">${escapeHtml(normalizeBlackoutDates(state.blackoutDates).join('\n'))}</textarea>
            <button type="submit">Save blackout dates</button>
          </form>
        </div>

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
      </div>
    </div>
  `;

  bindEvents();
}

function renderPoliciesPage(currentUser) {
  const isAdminView = currentUser.role === 'admin';
  const policies = [...(Array.isArray(state.policies) ? state.policies : [])]
    .sort((left, right) => String(right.uploadedAt || '').localeCompare(String(left.uploadedAt || '')));

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Policies</h1>
          <p class="muted">View, preview, and download policy files.${isAdminView ? ' Manage uploads in Admin Options.' : ''}</p>
        </div>
        <div class="row">
          ${isAdminView
            ? renderAdminNavigationLinks({ includeExport: true })
            : renderAgentNavigationLinks()}
          ${renderUserNavChip(currentUser)}
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel">
        <h2>Policy documents</h2>
        <div class="request-list" style="margin-top:12px;">
          ${policies.map((policy) => `
            <div class="card">
              <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                    <div class="row" style="gap:8px; align-items:center; flex-wrap:wrap;">
                      <strong>${escapeHtml(policy.name || 'Policy')}</strong>
                      <span class="chip" style="font-size:0.72rem; padding:3px 8px;">${escapeHtml(getPolicyTypeLabel(policy))}</span>
                    </div>
                  <div class="muted">Uploaded: ${escapeHtml(policy.uploadedAt ? new Date(policy.uploadedAt).toLocaleString() : 'Unknown')}</div>
                  <div class="muted">Size: ${escapeHtml(formatBytes(policy.sizeBytes))}</div>
                </div>
                <div class="row" style="gap:8px;">
                  ${canPreviewPolicyInline(policy) ? `<button type="button" class="secondary" data-preview-policy="${policy.id}">Preview ${escapeHtml(getPolicyTypeLabel(policy))}</button>` : ''}
                  <button type="button" class="secondary" data-download-policy="${policy.id}">Download</button>
                </div>
              </div>
              ${!canPreviewPolicyInline(policy) ? '<div class="muted" style="margin-top:8px;">Preview unavailable for this file type. Download to open locally.</div>' : ''}
            </div>
          `).join('') || '<div class="muted">No policy documents uploaded yet.</div>'}
        </div>
      </div>

      ${renderPolicyPreviewModal()}
    </div>
  `;

  bindEvents();
}

function renderAgentRequestsPage(currentUser) {
  if (!isAgentLikeUser(currentUser)) {
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

  const currentAgentId = Number(currentUser?.agentId);
  const viewAgent = getAgent(currentAgentId) || getViewAgent();
  const allAvailabilityRequests = getAllAvailabilityRequests();
  const approvedAvailabilityRequests = allAvailabilityRequests.filter((request) => isAvailabilityRequestVisibleToUser(request, currentUser) && request.status === 'approved');
  const approvedSwapRequests = state.swapRequests.filter((request) => isSwapRequestVisibleToAgent(request, currentAgentId) && request.status === 'completed');

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Approved requests</h1>
          <p class="muted">Your approved unavailability and completed swap requests.</p>
        </div>
        <div class="row">
          ${renderAgentNavigationLinks()}
          ${renderUserNavChip(currentUser)}
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
              <div class="muted">From shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'from'))}</div>
              <div class="muted">To shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'to'))}</div>
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
  if (!isAgentLikeUser(currentUser)) {
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

  const currentAgentId = Number(currentUser?.agentId);
  const viewAgent = getAgent(currentAgentId) || getViewAgent();
  const allAvailabilityRequests = getAllAvailabilityRequests();
  const pendingAvailabilityRequests = allAvailabilityRequests.filter((request) => isAvailabilityRequestVisibleToUser(request, currentUser) && request.status === 'pending');
  const pendingSwapRequests = state.swapRequests.filter((request) => isSwapRequestVisibleToAgent(request, currentAgentId) && request.status === 'pending');

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Pending requests</h1>
          <p class="muted">Your current unavailability and swap requests waiting on approval.</p>
        </div>
        <div class="row">
          ${renderAgentNavigationLinks()}
          ${renderUserNavChip(currentUser)}
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
                  <div class="muted">From shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'from'))}</div>
                  <div class="muted">To shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'to'))}</div>
                  <div class="muted">Approval state: ${escapeHtml(getSwapApprovalText(request))}</div>
                  <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                </div>
                <span class="status-badge pending">pending</span>
              </div>
              ${request.fromAgentId === currentAgentId || request.toAgentId === currentAgentId ? `
                <div class="row" style="margin-top:8px;">
                  ${request.fromAgentId === currentAgentId && !request.fromApproved ? `<button class="success" data-approve-swap-request="${request.id}">Approve as requester</button>` : ''}
                  ${request.toAgentId === currentAgentId && !request.toApproved ? `<button class="success" data-approve-swap-request="${request.id}">Approve as swap partner</button>` : ''}
                  <button class="danger" data-reject-swap-request="${request.id}">Reject</button>
                </div>
              ` : ''}
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
          ${renderAdminNavigationLinks({ includeExport: true })}
          ${renderUserNavChip(currentUser)}
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
  const sortedAgents = [...visibleAgents].sort((left, right) => {
    if (agentSort === 'team') {
      const teamCompare = String(left.team || '').localeCompare(String(right.team || ''), undefined, { sensitivity: 'base' });
      if (teamCompare !== 0) return teamCompare;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
  });
  const currentWeekReference = new Date().toISOString().slice(0, 10);

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Agents</h1>
          <p class="muted">Manage agent records, team assignments, and pay rates.</p>
        </div>
        <div class="row">
          ${renderAdminNavigationLinks({ includeExport: true })}
          ${renderUserNavChip(currentUser)}
          <button id="logout-btn" class="secondary" type="button">Log out</button>
        </div>
      </div>

      <div class="panel">
        <div class="row" style="justify-content:space-between; margin-bottom:6px;">
          <h2 style="margin:0;">Agents</h2>
        </div>
        <div class="row" style="justify-content:space-between; margin-bottom:6px; gap:6px; flex-wrap:wrap;">
          <input id="agent-search" placeholder="Search agents" value="${escapeHtml(state.ui.agentSearch)}" />
          <select id="agent-sort" style="max-width:220px;">
            <option value="name" ${agentSort === 'name' ? 'selected' : ''}>Sort: Name (A-Z)</option>
            <option value="team" ${agentSort === 'team' ? 'selected' : ''}>Sort: Team</option>
          </select>
        </div>
        <div class="muted" style="margin-bottom:6px;">Add an agent with email to automatically send a password setup invite.</div>
        <form id="add-agent-form" class="stack">
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(112px, 1fr)); gap:5px; align-items:end;">
            <input name="name" placeholder="Name" required />
            <input name="email" type="email" placeholder="Email" required />
            <select name="accessRole" required>
              <option value="${userRoles.agent}">Agent</option>
              <option value="${userRoles.teamLead}">Team lead</option>
            </select>
            <select name="team" required>
              ${teamOptions.map((team) => `<option value="${team}">${escapeHtml(team)}</option>`).join('')}
            </select>
            <input name="payRate" type="text" inputmode="decimal" placeholder="$15.45" />
            <input name="maxInOfficeShifts" type="number" inputmode="numeric" step="1" min="0" placeholder="Max in-office" />
            <button type="submit" style="white-space:nowrap;">Add agent</button>
          </div>
        </form>
        <div class="agent-list" style="margin-top:8px; display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:6px;">
          ${sortedAgents.map((agent) => `
            <div class="card" style="padding:8px;">
              <div class="stack" style="gap:6px;">
                <div>
                  <div><strong>Name:</strong> ${escapeHtml(agent.name)}</div>
                  <div><strong>Access level:</strong> ${escapeHtml(getUserRoleLabel(getUserByAgentId(agent.id)?.role || userRoles.agent))}</div>
                  <div><strong>Team:</strong> <span class="chip" style="${getTeamBadgeStyle(agent.team)}">${escapeHtml(agent.team || teamOptions[0])}</span></div>
                  <div><strong>Email:</strong> ${escapeHtml(getAgentAccountEmail(agent.id) || 'No login email')}</div>
                  <div><strong>Pay rate:</strong> $${escapeHtml(Number(agent.payRate || 0).toFixed(2))}/hr</div>
                  <div><strong>Assigned hours:</strong> ${escapeHtml(getAssignedHours(agent.id, currentWeekReference))}</div>
                  <div><strong>Credit (incl. PTO):</strong> ${escapeHtml(getMinimumHoursCredit(agent.id, currentWeekReference))}</div>
                  <div><strong>Targets:</strong> in-office max ${escapeHtml(agent.maxInOfficeShifts ?? 'Not set')}</div>
                </div>
                <div class="row" style="gap:6px; justify-content:flex-end; flex-wrap:wrap;">
                  <button class="secondary" type="button" data-edit-agent="${agent.id}" style="padding:6px 9px;">Edit</button>
                  <button class="secondary" type="button" disabled title="Use Edit to make changes" style="padding:6px 9px; opacity:0.6; cursor:not-allowed;">Save</button>
                  <button class="secondary" type="button" data-resend-agent-invite="${agent.id}" style="padding:6px 9px;">Resend</button>
                  <button class="danger" data-remove-agent="${agent.id}" type="button" style="padding:6px 9px;">Remove</button>
                </div>
              </div>
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
  const allRequestFilters = {
    date: state.ui.availabilityAllDate || '',
    from: state.ui.availabilityAllFrom || '',
    to: state.ui.availabilityAllTo || '',
    agentId: state.ui.availabilityAllAgentId || 'All',
    status: state.ui.availabilityAllStatus || 'All'
  };
  const swapRequestFilters = {
    date: state.ui.availabilitySwapDate || '',
    from: state.ui.availabilitySwapFrom || '',
    to: state.ui.availabilitySwapTo || '',
    agentId: state.ui.availabilitySwapAgentId || 'All',
    status: state.ui.availabilitySwapStatus || 'All'
  };
  const hideAllRequests = Boolean(state.ui.availabilityAllRequestsHidden);
  const hideSwapRequests = Boolean(state.ui.availabilitySwapRequestsHidden);
  const visibleAvailabilityRequestsForList = filterAvailabilityRequestsForAdminList(visibleAvailabilityRequests, allRequestFilters);
  const visibleSwapRequestsForList = filterSwapRequestsForAdminList(visibleSwapRequests, swapRequestFilters);
  const filteredPendingCount = visibleAvailabilityRequestsForList.filter((request) => normalizeAvailabilityRequestStatus(request.status) === 'pending').length;
  const filteredPendingSwapCount = visibleSwapRequestsForList.filter((request) => getSwapRequestFilterStatus(request) === 'pending').length;
  const selectedMonth = state.ui.availabilityCalendarMonth || new Date().toISOString().slice(0, 7);
  const calendarData = getAvailabilityCalendarCells(selectedMonth, visibleAvailabilityRequests);
  const allBlackoutDates = normalizeBlackoutDates(state.blackoutDates);
  const monthBlackoutDates = allBlackoutDates
    .filter((dateValue) => String(dateValue || '').startsWith(`${selectedMonth}-`))
    .sort((left, right) => left.localeCompare(right));

  root.innerHTML = `
    <div class="app">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div>
          <h1>Availability requests</h1>
          <p class="muted">Review all submitted requests by date and manage approvals.</p>
        </div>
        <div class="row">
          ${renderAdminNavigationLinks({ includeExport: true })}
          ${renderUserNavChip(currentUser)}
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
        <div class="row" style="margin-top:8px; gap:12px; flex-wrap:wrap;">
          <label class="row" style="justify-content:flex-start; align-items:center; gap:6px; white-space:nowrap;">
            <input id="availability-hide-all-requests" type="checkbox" ${hideAllRequests ? 'checked' : ''} />
            <span>Hide All requests</span>
          </label>
          <label class="row" style="justify-content:flex-start; align-items:center; gap:6px; white-space:nowrap;">
            <input id="availability-hide-swap-requests" type="checkbox" ${hideSwapRequests ? 'checked' : ''} />
            <span>Hide Swap requests</span>
          </label>
        </div>
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
        <div class="card" style="margin-top:10px; padding:8px 10px;">
          <div class="row" style="justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong style="font-size:0.95rem;">Blackout dates</strong>
            <span class="muted" style="font-size:12px;">${monthBlackoutDates.length} this month • ${allBlackoutDates.length} total</span>
          </div>
          <div class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap;">
            ${monthBlackoutDates.length > 0
              ? `${monthBlackoutDates.slice(0, 8).map((dateValue) => `<span class="chip" style="background:#AB5C57; color:#FFF1EF; border:1px solid rgba(255,255,255,0.2);">${escapeHtml(dateValue)}</span>`).join('')}${monthBlackoutDates.length > 8 ? `<span class="chip" style="background:rgba(23,56,59,0.08); border:1px solid rgba(23,56,59,0.2);">+${monthBlackoutDates.length - 8} more</span>` : ''}`
              : '<span class="muted">No blackout dates in this month.</span>'}
          </div>
        </div>
      </div>

      ${hideAllRequests ? '' : `
      <div class="panel">
        <h2>All requests</h2>
        <div class="row" style="margin-top:10px; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
          <input id="availability-all-date-filter" type="date" value="${escapeHtml(allRequestFilters.date)}" />
          <input id="availability-all-from-filter" type="date" value="${escapeHtml(allRequestFilters.from)}" />
          <input id="availability-all-to-filter" type="date" value="${escapeHtml(allRequestFilters.to)}" />
          <select id="availability-all-agent-filter" style="max-width:220px;">
            <option value="All" ${allRequestFilters.agentId === 'All' ? 'selected' : ''}>All agents</option>
            ${state.agents.map((agent) => `<option value="${agent.id}" ${String(allRequestFilters.agentId) === String(agent.id) ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`).join('')}
          </select>
          <select id="availability-all-status-filter" style="max-width:220px;">
            <option value="All" ${allRequestFilters.status === 'All' ? 'selected' : ''}>All statuses</option>
            <option value="pending" ${allRequestFilters.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="approved" ${allRequestFilters.status === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="rejected" ${allRequestFilters.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
          <button id="availability-all-filters-apply" type="button">Apply filters</button>
          <button id="availability-all-filters-reset" class="secondary" type="button">Reset filters</button>
        </div>
        <div class="muted">Visible after filters: ${visibleAvailabilityRequestsForList.length} (${filteredPendingCount} pending)</div>
        <div class="request-list" style="margin-top:12px;">
          ${visibleAvailabilityRequestsForList.map((request) => `
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
              ${request.status === 'approved' && String(request.unavailabilityType || '').trim() === 'PTO' ? `
                <div class="row" style="margin-top:8px;">
                  <button class="secondary" data-edit-availability-request="${request.id}">Edit PTO</button>
                </div>` : ''}
            </div>
          `).join('') || '<div class="muted">No unavailability requests yet.</div>'}
        </div>
      </div>
      `}

      ${hideSwapRequests ? '' : `
      <div class="panel" style="margin-top:16px;">
        <h2>Swap requests</h2>
        <div class="row" style="margin-top:10px; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
          <input id="availability-swap-date-filter" type="date" value="${escapeHtml(swapRequestFilters.date)}" />
          <input id="availability-swap-from-filter" type="date" value="${escapeHtml(swapRequestFilters.from)}" />
          <input id="availability-swap-to-filter" type="date" value="${escapeHtml(swapRequestFilters.to)}" />
          <select id="availability-swap-agent-filter" style="max-width:220px;">
            <option value="All" ${swapRequestFilters.agentId === 'All' ? 'selected' : ''}>All agents</option>
            ${state.agents.map((agent) => `<option value="${agent.id}" ${String(swapRequestFilters.agentId) === String(agent.id) ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`).join('')}
          </select>
          <select id="availability-swap-status-filter" style="max-width:220px;">
            <option value="All" ${swapRequestFilters.status === 'All' ? 'selected' : ''}>All statuses</option>
            <option value="pending" ${swapRequestFilters.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="approved" ${swapRequestFilters.status === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="rejected" ${swapRequestFilters.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
          <button id="availability-swap-filters-apply" type="button">Apply filters</button>
          <button id="availability-swap-filters-reset" class="secondary" type="button">Reset filters</button>
        </div>
        <div class="muted">Visible after filters: ${visibleSwapRequestsForList.length} (${filteredPendingSwapCount} pending)</div>
        <div class="request-list" style="margin-top:12px;">
          ${visibleSwapRequestsForList.map((request) => {
            const fromAgent = getAgent(request.fromAgentId)?.name || 'Unknown';
            const toAgent = getAgent(request.toAgentId)?.name || 'Unknown';
            const swapFilterStatus = getSwapRequestFilterStatus(request);
            return `
              <div class="card" style="border-left:4px solid ${request.status === 'completed' ? '#7AACAF' : request.status === 'rejected' ? '#AB5C57' : '#FDD592'};">
                <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                  <div>
                    <strong>${escapeHtml(fromAgent)} → ${escapeHtml(toAgent)}</strong>
                    <div class="muted">From shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'from'))}</div>
                    <div class="muted">To shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'to'))}</div>
                    <div class="muted">Approval state: ${escapeHtml(getSwapApprovalText(request))}</div>
                    <div class="muted">Submitted: ${escapeHtml(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown')}</div>
                  </div>
                  <span class="status-badge ${swapFilterStatus}">${swapFilterStatus}</span>
                </div>
              </div>
            `;
          }).join('') || '<div class="muted">No swap requests yet.</div>'}
        </div>
      </div>
      `}
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
  if (isAgentLikeUser(currentUser) && !state.agents.some((agent) => agent.id === Number(currentUser.agentId))) {
    clearSession();
    renderLoginPage('Your linked agent profile no longer exists. Contact an admin.');
    return;
  }
  if (isAgentLikeUser(currentUser) && currentUser.mustChangePassword) {
    renderFirstLoginPasswordSetupPage(currentUser);
    return;
  }
  if (isAgentLikeUser(currentUser) && isAgentPasswordExpired(currentUser)) {
    renderFirstLoginPasswordSetupPage(currentUser, {
      title: 'Reset your password',
      description: `Your password has expired after ${agentPasswordMaxAgeDays} days. Create a new password to continue.`
    });
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

  if (pageMode === 'admin-options') {
    renderAdminOptionsPage(currentUser);
    return;
  }

  if (pageMode === 'policies') {
    renderPoliciesPage(currentUser);
    return;
  }

  if (pageMode === 'calendar') {
    renderCalendarPage(currentUser);
    return;
  }

  const spendByDay = getSpendByDay();
  const stats = getAvailabilityStats();
  const visibleAgents = getFilteredAgents();
  const isAgentView = isAgentLikeUser(currentUser);
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
  const sortedVisibleShifts = [...visibleShifts].sort(compareCalendarShiftDisplayOrder);
  const blackoutDates = normalizeBlackoutDates(state.blackoutDates);
  const plannerWeekReference = getActiveCalendarWeekReference();
  const weekDates = getCalendarWeekDates(plannerWeekReference);
  const plannerWeekDates = getCalendarWeekDates(plannerWeekReference);
  const plannerWeekLabel = getCalendarWeekLabel(plannerWeekDates);
  const adminWeeklyShifts = isAgentView
    ? []
    : getFilteredCalendarShifts().filter((shift) => shift.status === shiftStatuses.published && shiftIsInWeek(shift, plannerWeekDates));
  const sortedAdminWeeklyShifts = [...adminWeeklyShifts].sort(compareCalendarShiftDisplayOrder);
  const swapAlertCount = state.swapRequests.length;
  const agentViewShifts = getAgentViewShifts();
  const todayDay = days[(new Date().getDay() + 6) % 7] || 'Mon';
  const selectedAgentScheduleView = ['day', 'week', 'month'].includes(state.ui.agentScheduleView) ? state.ui.agentScheduleView : 'week';
  const selectedAgentScheduleDay = days.includes(state.ui.agentScheduleDay) ? state.ui.agentScheduleDay : todayDay;
  const selectedAgentScheduleMonth = state.ui.agentScheduleMonth || new Date().toISOString().slice(0, 7);
  const monthShifts = sortedVisibleShifts
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
            ? renderAgentNavigationLinks()
            : renderAdminNavigationLinks({ includeExport: true })}
          ${renderUserNavChip(currentUser)}
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
        <div class="panel" style="margin-bottom:12px;">
          <h2 style="margin:0 0 8px;">Employee Hotline</h2>
          <div><strong>(215) 893-1832</strong></div>
          <ul style="margin:8px 0 0 18px; padding:0;">
            <li>Office Opening & Closing Updates, please press 1</li>
            <li>Notify of Call Out or Lateness, please press 2</li>
          </ul>
          <div class="muted" style="margin-top:8px;">Remember to update your contact information, email, SMS/TXT notification or any other preferences by clicking "Account".</div>
          <div class="muted" style="margin-top:6px;"><strong>If you have a picture for your account, you can upload that too.</strong></div>
        </div>
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
                    <h2 style="margin:0;">Weekly planner</h2>
                  </div>
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
                        ${sortedAdminWeeklyShifts.filter((shift) => shift.day === day).map((shift) => `
                          <div class="shift" draggable="true" data-shift-id="${shift.id}" style="${getShiftStyle(shift)}">
                            <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${getShiftRoleLocationHtml(shift)}<br />${formatTimeRange(shift.start, shift.end)}
                          </div>
                        `).join('')}
                      </div>
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
                              <div class="muted">From shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'from'))}</div>
                              <div class="muted">To shift: ${escapeHtml(getSwapRequestShiftLabel(request, 'to'))}</div>
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
                    ${sortedVisibleShifts.filter((shift) => shift.day === selectedAgentScheduleDay).map((shift) => `
                      <div class="shift" draggable="true" data-shift-id="${shift.id}">
                        <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${getShiftRoleLocationHtml(shift)}<br />${formatTimeRange(shift.start, shift.end)}
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
                      ${sortedVisibleShifts.filter((shift) => shift.day === day).map((shift) => `
                        <div class="shift" draggable="true" data-shift-id="${shift.id}">
                          <strong>${escapeHtml(getAgent(shift.agentId)?.name || 'Unassigned')}</strong><br />${getShiftRoleLocationHtml(shift)}<br />${formatTimeRange(shift.start, shift.end)}
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
                      <div class="muted">${escapeHtml(getShiftRoleLocationText(shift))}</div>
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
                <label style="display:flex; flex-direction:column; gap:6px;">
                  <span>Request type</span>
                  <select id="agent-request-kind" name="requestKind" required>
                    <option value="one-time-availability">One-time availability</option>
                    <option value="repeating-availability">Repeating availability</option>
                    <option value="vacation-time">Vacation time</option>
                  </select>
                </label>

                <div id="agent-one-time-fields" class="stack">
                  <div class="row" style="flex-wrap:wrap;">
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                      <span>Date</span>
                      <input name="oneTimeDate" type="date" />
                    </label>
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:160px; flex:1;">
                      <span>Start time</span>
                      <input name="oneTimeStart" type="time" />
                    </label>
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:160px; flex:1;">
                      <span>End time</span>
                      <input name="oneTimeEnd" type="time" />
                    </label>
                  </div>
                </div>

                <div id="agent-repeating-fields" class="stack" style="display:none;">
                  <div class="row" style="flex-wrap:wrap;">
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                      <span>Day of week</span>
                      <select name="repeatingDay">
                        <option value="">Select day</option>
                        ${days.map((day) => `<option value="${day}">${day}</option>`).join('')}
                      </select>
                    </label>
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                      <span>Start date</span>
                      <input name="repeatingStartDate" type="date" />
                    </label>
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                      <span>End date</span>
                      <input name="repeatingEndDate" type="date" />
                    </label>
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:160px; flex:1;">
                      <span>Start time</span>
                      <input name="repeatingStartTime" type="time" />
                    </label>
                    <label style="display:flex; flex-direction:column; gap:6px; min-width:160px; flex:1;">
                      <span>End time</span>
                      <input name="repeatingEndTime" type="time" />
                    </label>
                  </div>
                </div>

                <div id="agent-vacation-fields" class="stack" style="display:none;">
                  <label style="display:flex; flex-direction:column; gap:6px;">
                    <span>Vacation request type</span>
                    <select id="agent-vacation-mode" name="vacationMode">
                      <option value="single-date">Single date</option>
                      <option value="date-range">Date range</option>
                    </select>
                  </label>

                  <div id="agent-vacation-single-fields" class="stack">
                    <div class="row" style="flex-wrap:wrap;">
                      <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                        <span>Date</span>
                        <input name="vacationSingleDate" type="date" />
                      </label>
                      <label style="display:flex; flex-direction:column; gap:6px; min-width:160px; flex:1;">
                        <span>Start time</span>
                        <input name="vacationSingleStart" type="time" />
                      </label>
                      <label style="display:flex; flex-direction:column; gap:6px; min-width:160px; flex:1;">
                        <span>End time</span>
                        <input name="vacationSingleEnd" type="time" />
                      </label>
                    </div>
                  </div>

                  <div id="agent-vacation-range-fields" class="stack" style="display:none;">
                    <div class="row" style="flex-wrap:wrap;">
                      <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                        <span>Start date</span>
                        <input name="vacationRangeStartDate" type="date" />
                      </label>
                      <label style="display:flex; flex-direction:column; gap:6px; min-width:200px; flex:1;">
                        <span>End date</span>
                        <input name="vacationRangeEndDate" type="date" />
                      </label>
                    </div>
                  </div>
                </div>

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
                  ${state.agents.filter((agent) => agent.id !== viewAgent?.id && !isSwapRestrictedAgent(agent)).map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('')}
                </select>
                <button type="submit">Request swap</button>
              </form>
            </div>`}
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
  const currentUser = getCurrentUser();
  if (!currentUser) {
    alert('Unable to submit request: no active user session.');
    return false;
  }
  const currentId = Number(currentUser.agentId) || getCurrentAgentId();
  if (!currentId) {
    alert('Unable to submit request: no agent is selected.');
    return false;
  }

  const formData = new FormData(formElement);
  const requestKind = String(formData.get('requestKind') || 'one-time-availability');
  const note = formData.get('note')?.toString().trim() || '';
  if (!note) {
    alert('Please add a note before submitting your request.');
    return false;
  }

  let unavailabilityType = 'Availability';
  let unavailableStart = '00:00';
  let unavailableEnd = '23:59';
  let recurrenceType = 'once';
  let recurrenceDay = '';
  let recurrenceEndDate = '';
  let recurrenceGroupId = '';
  let recurrencePlan = { dates: [], truncated: false };
  let summaryLabel = '';

  if (requestKind === 'one-time-availability') {
    const oneTimeDate = String(formData.get('oneTimeDate') || '').trim();
    const oneTimeStart = String(formData.get('oneTimeStart') || '').trim();
    const oneTimeEnd = String(formData.get('oneTimeEnd') || '').trim();
    if (!oneTimeDate || !oneTimeStart || !oneTimeEnd) {
      alert('One-time availability requires a date, start time, and end time.');
      return false;
    }
    if (toMinutes(oneTimeEnd) <= toMinutes(oneTimeStart)) {
      alert('End time must be later than start time.');
      return false;
    }
    unavailabilityType = 'Availability';
    unavailableStart = oneTimeStart;
    unavailableEnd = oneTimeEnd;
    recurrencePlan = { dates: [oneTimeDate], truncated: false };
    summaryLabel = `${oneTimeDate} (${formatTimeRange(oneTimeStart, oneTimeEnd)})`;
  } else if (requestKind === 'repeating-availability') {
    const repeatingDay = String(formData.get('repeatingDay') || '').trim();
    const repeatingStartDate = String(formData.get('repeatingStartDate') || '').trim();
    const repeatingEndDate = String(formData.get('repeatingEndDate') || '').trim();
    const repeatingStartTime = String(formData.get('repeatingStartTime') || '').trim();
    const repeatingEndTime = String(formData.get('repeatingEndTime') || '').trim();
    if (!repeatingDay || !repeatingStartDate || !repeatingEndDate || !repeatingStartTime || !repeatingEndTime) {
      alert('Repeating availability requires a day of week, start/end date range, and start/end time.');
      return false;
    }
    if (!days.includes(repeatingDay)) {
      alert('Select a valid day of the week for repeating availability.');
      return false;
    }
    if (toMinutes(repeatingEndTime) <= toMinutes(repeatingStartTime)) {
      alert('End time must be later than start time.');
      return false;
    }
    unavailabilityType = 'Availability';
    unavailableStart = repeatingStartTime;
    unavailableEnd = repeatingEndTime;
    recurrenceType = 'weekly';
    recurrenceDay = repeatingDay;
    recurrenceEndDate = repeatingEndDate;
    recurrencePlan = buildWeeklyRecurringDates(repeatingStartDate, repeatingDay, repeatingEndDate);
    recurrenceGroupId = `weekly-${currentId}-${Date.now()}-${createId()}`;
    summaryLabel = `weekly every ${repeatingDay} from ${repeatingStartDate} through ${repeatingEndDate} (${formatTimeRange(repeatingStartTime, repeatingEndTime)})`;
  } else if (requestKind === 'vacation-time') {
    const vacationMode = String(formData.get('vacationMode') || 'single-date').trim();
    unavailabilityType = 'PTO';
    if (vacationMode === 'date-range') {
      const vacationRangeStartDate = String(formData.get('vacationRangeStartDate') || '').trim();
      const vacationRangeEndDate = String(formData.get('vacationRangeEndDate') || '').trim();
      if (!vacationRangeStartDate || !vacationRangeEndDate) {
        alert('Vacation date range requires a start date and end date.');
        return false;
      }
      recurrencePlan = buildDateRangeDates(vacationRangeStartDate, vacationRangeEndDate);
      recurrenceGroupId = `range-${currentId}-${Date.now()}-${createId()}`;
      summaryLabel = `vacation from ${vacationRangeStartDate} through ${vacationRangeEndDate}`;
    } else {
      const vacationSingleDate = String(formData.get('vacationSingleDate') || '').trim();
      const vacationSingleStart = String(formData.get('vacationSingleStart') || '').trim();
      const vacationSingleEnd = String(formData.get('vacationSingleEnd') || '').trim();
      if (!vacationSingleDate || !vacationSingleStart || !vacationSingleEnd) {
        alert('Vacation single date requires a date, start time, and end time.');
        return false;
      }
      if (toMinutes(vacationSingleEnd) <= toMinutes(vacationSingleStart)) {
        alert('End time must be later than start time.');
        return false;
      }
      unavailableStart = vacationSingleStart;
      unavailableEnd = vacationSingleEnd;
      recurrencePlan = { dates: [vacationSingleDate], truncated: false };
      summaryLabel = `${vacationSingleDate} (${formatTimeRange(vacationSingleStart, vacationSingleEnd)})`;
    }
  } else {
    alert('Select a valid request type.');
    return false;
  }

  if (!recurrencePlan.dates.length) {
    alert('No dates were generated. Make sure your selected date or date range is valid.');
    return false;
  }

  const blockedBlackoutDates = recurrencePlan.dates.filter((dateValue) => isBlackoutDate(dateValue));
  if (blockedBlackoutDates.length > 0) {
    alert('cannot submit due to blackout dates. please check in with your manager directly');
    return false;
  }

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

  const recurrenceSummary = summaryLabel || (recurrenceType === 'weekly'
    ? `weekly every ${recurrenceDay} through ${String(recurrenceEndDate).slice(0, 10)}`
    : recurrencePlan.dates[0]);

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
    ? ' For safety, large recurring/date-range requests are capped per submission.'
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

function bindAgentAvailabilityFormConditionalFields() {
  const form = document.getElementById('agent-availability-form');
  if (!(form instanceof HTMLFormElement)) return;

  const requestKindSelect = form.querySelector('select[name="requestKind"]');
  const vacationModeSelect = form.querySelector('select[name="vacationMode"]');
  const oneTimeFields = form.querySelector('#agent-one-time-fields');
  const repeatingFields = form.querySelector('#agent-repeating-fields');
  const vacationFields = form.querySelector('#agent-vacation-fields');
  const vacationSingleFields = form.querySelector('#agent-vacation-single-fields');
  const vacationRangeFields = form.querySelector('#agent-vacation-range-fields');

  const oneTimeDate = form.querySelector('input[name="oneTimeDate"]');
  const oneTimeStart = form.querySelector('input[name="oneTimeStart"]');
  const oneTimeEnd = form.querySelector('input[name="oneTimeEnd"]');
  const repeatingDay = form.querySelector('select[name="repeatingDay"]');
  const repeatingStartDate = form.querySelector('input[name="repeatingStartDate"]');
  const repeatingEndDate = form.querySelector('input[name="repeatingEndDate"]');
  const repeatingStartTime = form.querySelector('input[name="repeatingStartTime"]');
  const repeatingEndTime = form.querySelector('input[name="repeatingEndTime"]');
  const vacationSingleDate = form.querySelector('input[name="vacationSingleDate"]');
  const vacationSingleStart = form.querySelector('input[name="vacationSingleStart"]');
  const vacationSingleEnd = form.querySelector('input[name="vacationSingleEnd"]');
  const vacationRangeStartDate = form.querySelector('input[name="vacationRangeStartDate"]');
  const vacationRangeEndDate = form.querySelector('input[name="vacationRangeEndDate"]');

  const setVisible = (element, visible) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.display = visible ? '' : 'none';
  };

  const setRequired = (element, required) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      element.required = required;
    }
  };

  const updateFormState = () => {
    const requestKind = String(requestKindSelect?.value || 'one-time-availability');
    const vacationMode = String(vacationModeSelect?.value || 'single-date');

    const showOneTime = requestKind === 'one-time-availability';
    const showRepeating = requestKind === 'repeating-availability';
    const showVacation = requestKind === 'vacation-time';
    const showVacationSingle = showVacation && vacationMode === 'single-date';
    const showVacationRange = showVacation && vacationMode === 'date-range';

    setVisible(oneTimeFields, showOneTime);
    setVisible(repeatingFields, showRepeating);
    setVisible(vacationFields, showVacation);
    setVisible(vacationSingleFields, showVacationSingle);
    setVisible(vacationRangeFields, showVacationRange);

    setRequired(oneTimeDate, showOneTime);
    setRequired(oneTimeStart, showOneTime);
    setRequired(oneTimeEnd, showOneTime);

    setRequired(repeatingDay, showRepeating);
    setRequired(repeatingStartDate, showRepeating);
    setRequired(repeatingEndDate, showRepeating);
    setRequired(repeatingStartTime, showRepeating);
    setRequired(repeatingEndTime, showRepeating);

    setRequired(vacationSingleDate, showVacationSingle);
    setRequired(vacationSingleStart, showVacationSingle);
    setRequired(vacationSingleEnd, showVacationSingle);

    setRequired(vacationRangeStartDate, showVacationRange);
    setRequired(vacationRangeEndDate, showVacationRange);
  };

  requestKindSelect?.addEventListener('change', updateFormState);
  vacationModeSelect?.addEventListener('change', updateFormState);
  updateFormState();
}

function bindProfilePhotoHandlers() {
  document.getElementById('upload-profile-photo-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const formData = new FormData(event.currentTarget);
    const profilePhoto = formData.get('profilePhoto');
    if (!(profilePhoto instanceof File) || profilePhoto.size <= 0) {
      alert('Please choose an image file to upload.');
      return;
    }
    if (!String(profilePhoto.type || '').toLowerCase().startsWith('image/')) {
      alert('Profile photo must be an image file.');
      return;
    }
    if (profilePhoto.size > (8 * 1024 * 1024)) {
      alert('Profile photo must be 8 MB or smaller.');
      return;
    }

    try {
      const imageDataUrl = await optimizeImageFileForProfilePhoto(profilePhoto);
      if (!String(imageDataUrl || '').startsWith('data:image/')) {
        alert('Unable to process the selected image. Please choose a different file.');
        return;
      }
      const imageByteSize = getDataUrlApproxBytes(imageDataUrl);
      if (imageByteSize > (700 * 1024)) {
        alert(`Processed profile photo is still too large to save reliably (${formatBytes(imageByteSize)}). Please choose a smaller image.`);
        return;
      }
      authUsers = authUsers.map((user) => user.id === currentUser.id
        ? {
            ...user,
            profilePhotoDataUrl: imageDataUrl,
            updatedAt: getCurrentIsoTimestamp(),
            profileUpdatedAt: getCurrentIsoTimestamp()
          }
        : user);
      const didSavePhoto = saveAuthUsers();
      if (!didSavePhoto) {
        alert('Unable to save profile photo. Storage may be full on this device. Please try a smaller image.');
        syncFromStorage();
        render();
        return;
      }
      alert('Profile photo uploaded successfully.');
      render();
    } catch {
      alert('Unable to upload the selected profile photo. Please try again.');
    }
  });

  document.getElementById('remove-profile-photo')?.addEventListener('click', () => {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    authUsers = authUsers.map((user) => user.id === currentUser.id
      ? {
          ...user,
          profilePhotoDataUrl: '',
          updatedAt: getCurrentIsoTimestamp(),
          profileUpdatedAt: getCurrentIsoTimestamp()
        }
      : user);
    const didSavePhotoRemoval = saveAuthUsers();
    if (!didSavePhotoRemoval) {
      alert('Unable to save profile photo changes. Storage may be full on this device.');
      syncFromStorage();
      render();
      return;
    }
    alert('Profile photo removed.');
    render();
  });
}

function bindEvents() {
  const activeUser = getCurrentUser();
  const canManageCalendar = canManageSchedule(activeUser);
  const canMarkAbsence = canMarkShiftAbsences(activeUser);

  document.getElementById('add-agent-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get('name')?.toString().trim();
    const email = normalizeEmail(formData.get('email'));
    const requestedAccessRole = normalizeUserRole(formData.get('accessRole'));
    const accessRole = requestedAccessRole === userRoles.admin ? userRoles.agent : requestedAccessRole;
    const role = normalizeRoleLabel(formData.get('role')?.toString().trim() || getPrimaryRole(), getRoleCatalog());
    const payRateRaw = formData.get('payRate')?.toString().trim() || '0';
    const payRate = parseCurrencyAmount(payRateRaw);
    const maxInOfficeShifts = normalizeMaxInOfficeShifts(formData.get('maxInOfficeShifts'));
    if (!name || !email) {
      alert('Name and email are required to add an agent.');
      return;
    }
    if (!Number.isFinite(payRate) || payRate < 0) {
      alert('Pay rate must be a valid non-negative amount (example: $15.45).');
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
      role,
      payRate,
      attendancePoints: 0,
      skills: [],
      maxInOfficeShifts,
      availability: 'Available'
    });

    const createdAt = getCurrentIsoTimestamp();
    const nextUser = withRequiredEmail({
      id: createId(),
      username: createUniqueAgentUsername(email),
      email,
      phone: '',
      password: createTemporaryPassword(),
        passwordUpdatedAt: createdAt,
      createdAt,
      profileUpdatedAt: createdAt,
      mustChangePassword: true,
      calendarFeedToken: createCalendarFeedToken(),
      role: accessRole,
      agentId
    });
    authUsers.push(nextUser);
    const didSaveAuthUsers = saveAuthUsers();
    const didSaveState = saveState();
    if (!didSaveAuthUsers || !didSaveState) {
      alert('Unable to save the new agent permanently. Please check browser storage settings and try again.');
      syncFromStorage();
      render();
      return;
    }
    const inviteResult = sendAgentInviteEmail(nextUser, name, nextUser.password);

    const outboxCount = loadEmailOutbox().length;
    if (inviteResult?.deliveryStatus === 'local-only') {
      alert(`Agent added. Invite was queued in Email outbox (local-only) because webhook delivery is not enabled. Configure Admin Profile > Email delivery to send real emails.\n\nTemporary password: ${inviteResult?.temporaryPassword || '(not available)'}\nSign-in link: ${inviteResult?.signInLink || getAppLoginUrl()}`);
    } else {
      alert(`Agent added and invitation email queued for delivery. Email outbox now has ${outboxCount} message${outboxCount === 1 ? '' : 's'}.`);
    }
    render();
  });

  document.getElementById('add-shift-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManageCalendar) return;
    const formData = new FormData(event.currentTarget);
    const agentId = formData.get('agentId') ? Number(formData.get('agentId')) : null;
    const role = normalizeRoleLabel(formData.get('role')?.toString().trim() || getAgent(agentId)?.role || getPrimaryRole(), getRoleCatalog());
    const start = formData.get('start')?.toString();
    const end = formData.get('end')?.toString();
    const requestedLocation = formData.get('location')?.toString().trim() || '';
    const location = requestedLocation && getLocationCatalog().includes(requestedLocation) ? requestedLocation : '';
    const date = formData.get('date')?.toString() || '';
    const day = getDayFromDate(date);
    if (!day || !role || !start || !end || !date) return;
    if (!await confirmShiftAssignmentWithTimeOffWarning(agentId, date, start, end, {
      durationHours: getDurationHours(start, end),
      role
    })) return;

    state.shifts.push({ id: createId(), day, date, agentId, role, start, end, durationHours: getDurationHours(start, end), location, status: shiftStatuses.draft });
    saveState();
    render();
  });

  document.querySelector('#add-shift-form select[name="templateId"]')?.addEventListener('change', (event) => {
    if (!canManageCalendar) return;
    const select = event.currentTarget;
    const form = select?.closest('form');
    if (!(select instanceof HTMLSelectElement) || !(form instanceof HTMLFormElement)) return;
    const templateId = Number(select.value);
    if (!templateId) return;
    const template = state.templates.find((item) => Number(item.id) === templateId);
    if (!template) return;

    const roleInput = form.querySelector('select[name="role"]');
    const startInput = form.querySelector('input[name="start"]');
    const endInput = form.querySelector('input[name="end"]');
    const locationInput = form.querySelector('select[name="location"]');

    if (roleInput instanceof HTMLSelectElement && template.role) {
      roleInput.value = normalizeRoleLabel(template.role);
    }
    if (startInput instanceof HTMLInputElement && template.start) {
      startInput.value = normalizeTimeInputValue(template.start) || template.start;
    }
    if (endInput instanceof HTMLInputElement && template.end) {
      endInput.value = normalizeTimeInputValue(template.end) || template.end;
    }
    if (locationInput instanceof HTMLSelectElement) {
      const requestedLocation = String(template.location || '').trim();
      locationInput.value = getLocationCatalog().includes(requestedLocation) ? requestedLocation : '';
    }
  });

  document.getElementById('add-shift-template-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') || '').trim();
    const start = String(formData.get('start') || '').trim();
    const end = String(formData.get('end') || '').trim();
    const requestedRole = String(formData.get('role') || '').trim();
    const requestedLocation = String(formData.get('location') || '').trim();
    const active = formData.get('active') !== null;
    if (!name || !start || !end || toMinutes(end) <= toMinutes(start)) {
      alert('Template name, start, and end are required. Use 12-hour time (for example, 8:00 AM). End time must be later than start time.');
      return;
    }

    state.templates.push({
      id: createId(),
      name,
      start,
      end,
      durationHours: getDurationHours(start, end),
      active,
      role: requestedRole ? normalizeRoleLabel(requestedRole, getRoleCatalog()) : '',
      location: requestedLocation && getLocationCatalog().includes(requestedLocation) ? requestedLocation : ''
    });
    saveState();
    render();
  });

  document.querySelectorAll('[data-update-shift-template]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const templateId = Number(form.getAttribute('data-update-shift-template'));
      if (!templateId) return;
      const formData = new FormData(form);
      const name = String(formData.get('name') || '').trim();
      const start = String(formData.get('start') || '').trim();
      const end = String(formData.get('end') || '').trim();
      const requestedRole = String(formData.get('role') || '').trim();
      const requestedLocation = String(formData.get('location') || '').trim();
      const active = formData.get('active') !== null;
      if (!name || !start || !end || toMinutes(end) <= toMinutes(start)) {
        alert('Template name, start, and end are required. Use 12-hour time (for example, 8:00 AM). End time must be later than start time.');
        return;
      }

      state.templates = state.templates.map((template) => Number(template.id) === templateId
        ? {
            ...template,
            name,
            start,
            end,
            durationHours: getDurationHours(start, end),
            active,
            role: requestedRole ? normalizeRoleLabel(requestedRole, getRoleCatalog()) : '',
            location: requestedLocation && getLocationCatalog().includes(requestedLocation) ? requestedLocation : ''
          }
        : template);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-remove-shift-template]').forEach((button) => {
    button.addEventListener('click', () => {
      const templateId = Number(button.getAttribute('data-remove-shift-template'));
      if (!templateId) return;
      const template = state.templates.find((item) => Number(item.id) === templateId);
      const templateName = String(template?.name || 'this template').trim() || 'this template';
      const shouldDelete = confirm(`Delete shift template ${templateName}?`);
      if (!shouldDelete) return;
      state.templates = state.templates.filter((template) => Number(template.id) !== templateId);
      const didSaveState = saveState();
      if (!didSaveState) {
        alert('Unable to remove this template permanently right now. Please check browser storage settings and try again.');
        syncFromStorage();
      }
      render();
    });
  });

  document.getElementById('upload-policy-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentUser = getCurrentUser();
    if (currentUser?.role !== 'admin') return;
    const formElement = event.currentTarget;
    if (!(formElement instanceof HTMLFormElement)) return;
    const fileInput = formElement.querySelector('input[name="policyFile"]');
    if (!(fileInput instanceof HTMLInputElement)) return;
    const selectedFile = fileInput.files?.[0];
    if (!selectedFile) {
      alert('Choose a file to upload.');
      return;
    }
    const selectedFileName = String(selectedFile.name || '').trim().toLowerCase();
    const selectedFileType = String(selectedFile.type || '').trim().toLowerCase();
    const isPdfPolicy = selectedFileType === 'application/pdf' || selectedFileName.endsWith('.pdf');
    const isDocxPolicyFile = selectedFileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || selectedFileName.endsWith('.docx');
    if (!isPdfPolicy && !isDocxPolicyFile) {
      alert('Please upload a PDF or DOCX file.');
      return;
    }
    if ((Number(selectedFile.size) || 0) > maxPolicyUploadBytes) {
      alert(`This file is too large to store reliably in the browser (${formatBytes(selectedFile.size)}). Please upload a file smaller than ${formatBytes(maxPolicyUploadBytes)}.`);
      return;
    }

    try {
      const fileArrayBuffer = await selectedFile.arrayBuffer();
      const fileBytes = new Uint8Array(fileArrayBuffer);
      if (!fileBytes.length) {
        alert('Unable to read the selected file.');
        return;
      }

      const policyNameExists = (Array.isArray(state.policies) ? state.policies : [])
        .some((policy) => String(policy.name || '').trim().toLowerCase() === selectedFile.name.trim().toLowerCase());
      if (policyNameExists) {
        const shouldReplace = confirm('A policy with this file name already exists. Upload anyway?');
        if (!shouldReplace) return;
      }

      const nextPolicyId = createId();
      const didSavePolicyFile = await savePolicyFileBytes(nextPolicyId, selectedFile.type || 'application/octet-stream', fileBytes);
      if (!didSavePolicyFile) {
        alert('Unable to sync this policy file right now. Agent previews/downloads require successful backend file sync. Please try again.');
        return;
      }

      const nextPolicies = [
        ...(Array.isArray(state.policies) ? state.policies : []),
        {
          id: nextPolicyId,
          name: selectedFile.name,
          mimeType: selectedFile.type || 'application/octet-stream',
          sizeBytes: Number(selectedFile.size) || 0,
          uploadedAt: new Date().toISOString()
        }
      ];
      state.policies = nextPolicies;
      const didSaveState = saveState();
      if (!didSaveState) {
        await deletePolicyFileBytes(nextPolicyId);
        alert('Unable to save this policy file permanently. Browser storage may be full. Try a smaller PDF/DOCX or remove older uploads.');
        syncFromStorage();
        render();
        return;
      }
      render();
    } catch {
      alert('Unable to upload this policy file right now.');
    }
  });

  document.querySelectorAll('[data-delete-policy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const currentUser = getCurrentUser();
      if (currentUser?.role !== 'admin') return;
      const policyId = Number(button.getAttribute('data-delete-policy'));
      if (!policyId) return;
      const policy = (Array.isArray(state.policies) ? state.policies : []).find((item) => Number(item.id) === policyId);
      if (!policy) return;
      const shouldDelete = confirm(`Delete policy ${policy.name || 'this file'}?`);
      if (!shouldDelete) return;
      const didDeletePolicyFile = await deletePolicyFileBytes(policyId);
      if (!didDeletePolicyFile) {
        alert('Unable to remove stored policy file bytes from browser storage right now. The policy entry will still be removed.');
      }
      state.policies = (Array.isArray(state.policies) ? state.policies : []).filter((item) => Number(item.id) !== policyId);
      const didSaveState = saveState();
      if (!didSaveState) {
        alert('Unable to remove this policy permanently right now. Please check browser storage settings and try again.');
        syncFromStorage();
      }
      render();
    });
  });

  document.querySelectorAll('[data-download-policy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const policyId = Number(button.getAttribute('data-download-policy'));
      if (!policyId) return;
      const policy = (Array.isArray(state.policies) ? state.policies : []).find((item) => Number(item.id) === policyId);
      if (!policy) return;
      await triggerPolicyDownload(policy);
    });
  });

  document.querySelectorAll('[data-preview-policy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const policyId = Number(button.getAttribute('data-preview-policy'));
      if (!policyId) return;
      const policy = (Array.isArray(state.policies) ? state.policies : []).find((item) => Number(item.id) === policyId);
      if (!policy) return;
      await openPolicyPreviewModal(policy);
    });
  });

  document.getElementById('policy-preview-close')?.addEventListener('click', () => {
    closePolicyPreviewModal();
  });

  document.getElementById('policy-preview-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closePolicyPreviewModal();
    }
  });

  document.getElementById('add-shift-location-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const location = String(formData.get('location') || '').trim();
    if (!location) return;
    if (getLocationCatalog().some((item) => item.toLowerCase() === location.toLowerCase())) {
      alert('That venue already exists.');
      return;
    }
    state.locationCatalog = [...getLocationCatalog(), location];
    saveState();
    render();
  });

  document.querySelectorAll('[data-remove-shift-location]').forEach((button) => {
    button.addEventListener('click', () => {
      const location = String(button.getAttribute('data-remove-shift-location') || '').trim();
      if (!location) return;
      const locationInUse = state.shifts.some((shift) => String(shift.location || '').trim() === location)
        || state.templates.some((template) => String(template.location || '').trim() === location);
      if (locationInUse) {
        alert('That venue is in use by shifts or templates and cannot be removed yet.');
        return;
      }
      state.locationCatalog = getLocationCatalog().filter((item) => item !== location);
      saveState();
      render();
    });
  });

  document.getElementById('add-shift-role-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const role = String(formData.get('role') || '').trim();
    if (!role) return;
    if (getRoleCatalog().some((item) => item.toLowerCase() === role.toLowerCase())) {
      alert('That role already exists.');
      return;
    }
    state.roleCatalog = [...getRoleCatalog(), role];
    saveState();
    render();
  });

  document.querySelectorAll('[data-remove-shift-role]').forEach((button) => {
    button.addEventListener('click', () => {
      const role = String(button.getAttribute('data-remove-shift-role') || '').trim();
      if (!role) return;
      const roleInUse = state.agents.some((agent) => String(agent.role || '').trim() === role)
        || state.shifts.some((shift) => String(shift.role || '').trim() === role)
        || state.templates.some((template) => String(template.role || '').trim() === role);
      if (roleInUse) {
        alert('That role is in use by agents, shifts, or templates and cannot be removed yet.');
        return;
      }
      const nextRoleCatalog = getRoleCatalog().filter((item) => item !== role);
      if (nextRoleCatalog.length === 0) {
        alert('At least one role is required.');
        return;
      }
      state.roleCatalog = nextRoleCatalog;
      if (state.roleColors && typeof state.roleColors === 'object') {
        const colorKey = role.toLowerCase();
        if (state.roleColors[colorKey]) {
          delete state.roleColors[colorKey];
        }
      }
      saveState();
      render();
    });
  });

  document.getElementById('swap-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const currentUser = getCurrentUser();
    const fromAgentId = Number(currentUser?.agentId) || Number(state.ui.currentAgentId) || Number(getViewAgent()?.id);
    const fromShiftId = Number(formData.get('fromShiftId'));
    const toAgentId = Number(formData.get('toAgentId'));
    const toShiftId = Number(formData.get('toShiftId'));
    const fromShift = getShiftById(fromShiftId);
    const toShift = getShiftById(toShiftId);
    if (!fromAgentId || !fromShiftId || !toAgentId || !toShiftId) {
      alert('Select your shift, the agent, and the shift they want to trade before submitting.');
      return;
    }
    if (!fromShift || Number(fromShift.agentId) !== fromAgentId) {
      alert('Choose one of your own published shifts to give up.');
      return;
    }
    if (!toShift || Number(toShift.agentId) !== toAgentId) {
      alert('Choose a shift that belongs to the selected agent.');
      return;
    }
    const fromWeekDates = getCalendarWeekDates(fromShift.date || '');
    if (!shiftIsInWeek(toShift, fromWeekDates)) {
      alert('Swap shifts must be in the same week.');
      return;
    }
    if (fromAgentId === toAgentId) {
      alert('Choose a different agent for the swap request.');
      return;
    }
    if (fromShiftId === toShiftId) {
      alert('Pick two different shifts for the swap.');
      return;
    }
    const fromAgent = getAgent(fromAgentId);
    const toAgent = getAgent(toAgentId);
    if (isSwapRestrictedAgent(fromAgent) || isSwapRestrictedAgent(toAgent)) {
      alert('Swaps with Booth Duty are not allowed.');
      return;
    }
    const projectedFromHours = getProjectedSwapHours(fromAgentId, fromShift, toShift);
    const projectedToHours = getProjectedSwapHours(toAgentId, toShift, fromShift);
    const projectedFromInOffice = getProjectedSwapInOfficeShiftCount(fromAgentId, fromShift, toShift);
    const projectedToInOffice = getProjectedSwapInOfficeShiftCount(toAgentId, toShift, fromShift);
    const fromMaxInOffice = normalizeMaxInOfficeShifts(fromAgent?.maxInOfficeShifts);
    const toMaxInOffice = normalizeMaxInOfficeShifts(toAgent?.maxInOfficeShifts);
    if (Number.isFinite(fromMaxInOffice) && projectedFromInOffice > fromMaxInOffice) {
      alert(`${fromAgent?.name || 'This agent'} would exceed their weekly max in-office shifts with that swap.`);
      return;
    }
    if (Number.isFinite(toMaxInOffice) && projectedToInOffice > toMaxInOffice) {
      alert(`${toAgent?.name || 'That agent'} would exceed their weekly max in-office shifts with that swap.`);
      return;
    }
    const newSwapRequest = {
      id: createId(),
      fromAgentId,
      toAgentId,
      fromShiftId,
      toShiftId,
      shiftId: fromShiftId,
      requestedAt: new Date().toISOString(),
      fromApproved: false,
      toApproved: false,
      status: 'pending'
    };
    state.swapRequests.push(newSwapRequest);
    saveState();
    sendSwapNotificationEmails(newSwapRequest, 'submitted');
    alert('Swap request submitted. It will remain pending until both agents approve it.');
    render();
  });

  document.getElementById('agent-search')?.addEventListener('input', (event) => {
    state.ui.agentSearch = event.target.value;
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

  document.getElementById('availability-hide-all-requests')?.addEventListener('change', (event) => {
    state.ui.availabilityAllRequestsHidden = Boolean(event.target.checked);
    saveUiState();
    render();
  });

  document.getElementById('availability-hide-swap-requests')?.addEventListener('change', (event) => {
    state.ui.availabilitySwapRequestsHidden = Boolean(event.target.checked);
    saveUiState();
    render();
  });

  document.getElementById('availability-all-filters-apply')?.addEventListener('click', () => {
    const dateInput = document.getElementById('availability-all-date-filter');
    const fromInput = document.getElementById('availability-all-from-filter');
    const toInput = document.getElementById('availability-all-to-filter');
    const agentInput = document.getElementById('availability-all-agent-filter');
    const statusInput = document.getElementById('availability-all-status-filter');
    state.ui.availabilityAllDate = dateInput?.value || '';
    state.ui.availabilityAllFrom = fromInput?.value || '';
    state.ui.availabilityAllTo = toInput?.value || '';
    state.ui.availabilityAllAgentId = agentInput?.value || 'All';
    state.ui.availabilityAllStatus = statusInput?.value || 'All';
    saveUiState();
    render();
  });

  document.getElementById('availability-all-filters-reset')?.addEventListener('click', () => {
    state.ui.availabilityAllDate = '';
    state.ui.availabilityAllFrom = '';
    state.ui.availabilityAllTo = '';
    state.ui.availabilityAllAgentId = 'All';
    state.ui.availabilityAllStatus = 'All';
    saveUiState();
    render();
  });

  document.getElementById('availability-swap-filters-apply')?.addEventListener('click', () => {
    const dateInput = document.getElementById('availability-swap-date-filter');
    const fromInput = document.getElementById('availability-swap-from-filter');
    const toInput = document.getElementById('availability-swap-to-filter');
    const agentInput = document.getElementById('availability-swap-agent-filter');
    const statusInput = document.getElementById('availability-swap-status-filter');
    state.ui.availabilitySwapDate = dateInput?.value || '';
    state.ui.availabilitySwapFrom = fromInput?.value || '';
    state.ui.availabilitySwapTo = toInput?.value || '';
    state.ui.availabilitySwapAgentId = agentInput?.value || 'All';
    state.ui.availabilitySwapStatus = statusInput?.value || 'All';
    saveUiState();
    render();
  });

  document.getElementById('availability-swap-filters-reset')?.addEventListener('click', () => {
    state.ui.availabilitySwapDate = '';
    state.ui.availabilitySwapFrom = '';
    state.ui.availabilitySwapTo = '';
    state.ui.availabilitySwapAgentId = 'All';
    state.ui.availabilitySwapStatus = 'All';
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

  document.getElementById('agent-reset-password-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const formData = new FormData(event.currentTarget);
    const currentPassword = formData.get('currentPassword')?.toString() || '';
    const newPassword = formData.get('newPassword')?.toString() || '';
    const confirmPassword = formData.get('confirmPassword')?.toString() || '';

    if (currentPassword !== currentUser.password) {
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

    authUsers = authUsers.map((user) => user.id === currentUser.id
      ? { ...user, password: newPassword, passwordUpdatedAt: getCurrentIsoTimestamp(), mustChangePassword: false }
      : user);
    saveAuthUsers();
    syncRememberedLoginPassword(currentUser, newPassword);
    alert('Password updated successfully.');
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

  bindProfilePhotoHandlers();

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

  document.querySelectorAll('[data-edit-agent]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-edit-agent'));
      const agent = getAgent(id);
      if (!agent) return;
      openAgentEditModal(agent, (updatedValues) => {
        const result = saveAgentDetails(id, updatedValues);
        if (result.ok) {
          render();
        }
        return result;
      });
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
      const passwordUpdatedAt = getCurrentIsoTimestamp();
      authUsers = authUsers.map((user) => user.id === agentUser.id
        ? {
            ...user,
            password: temporaryPassword,
            passwordUpdatedAt,
            mustChangePassword: true
          }
        : user);
      saveAuthUsers();
      const refreshedAgentUser = getUserByAgentId(agentId) || { ...agentUser, password: temporaryPassword, passwordUpdatedAt, mustChangePassword: true };
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
  bindAgentAvailabilityFormConditionalFields();

  document.querySelectorAll('[data-remove-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!canManageCalendar) return;
      const id = Number(button.getAttribute('data-remove-shift'));
      const shift = state.shifts.find((item) => Number(item.id) === id);
      if (!shift) return;
      const shouldDelete = confirm(
        `Delete this shift for ${getAgent(shift.agentId)?.name || 'the assigned agent'} on ${shift.date || shift.day || 'selected date'} (${formatTimeRange(shift.start, shift.end)})?`
      );
      if (!shouldDelete) return;

      selectedCalendarShiftIds.delete(id);
      state.shifts = state.shifts.filter((shift) => shift.id !== id);
      state.swapRequests = state.swapRequests.filter((request) => {
        const fromShiftId = getSwapRequestFromShiftId(request);
        const toShiftId = getSwapRequestToShiftId(request);
        return Number(fromShiftId) !== id && Number(toShiftId) !== id;
      });
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-offer-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      const shiftId = Number(button.getAttribute('data-offer-shift'));
      const currentUser = getCurrentUser();
      const currentAgentId = Number(currentUser?.agentId);
      if (!shiftId || !currentAgentId) return;

      const shift = state.shifts.find((item) => Number(item.id) === shiftId);
      if (!shift || !canAgentOfferShift(shift, currentAgentId)) return;

      const shouldOffer = !isShiftOfferedForPickup(shift);
      state.shifts = state.shifts.map((item) => Number(item.id) === shiftId
        ? {
            ...item,
            offeredForPickup: shouldOffer,
            offeredByAgentId: shouldOffer ? currentAgentId : null,
            offeredAt: shouldOffer ? new Date().toISOString() : null
          }
        : item);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-pickup-offered-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      const shiftId = Number(button.getAttribute('data-pickup-offered-shift'));
      const currentUser = getCurrentUser();
      const currentAgentId = Number(currentUser?.agentId);
      if (!shiftId || !currentAgentId) return;

      const shift = state.shifts.find((item) => Number(item.id) === shiftId);
      if (!shift || !canAgentPickUpOfferedShift(shift, currentAgentId)) return;

      const targetAgent = getAgent(currentAgentId);
      const maxInOfficeShifts = normalizeMaxInOfficeShifts(targetAgent?.maxInOfficeShifts);
      if (isInOfficeRole(shift.role) && Number.isFinite(maxInOfficeShifts) && maxInOfficeShifts >= 0) {
        const projectedInOfficeCount = getAssignedInOfficeShiftCount(currentAgentId, shift.date) + 1;
        if (projectedInOfficeCount > maxInOfficeShifts) {
          alert(`${targetAgent?.name || 'This agent'} would exceed their weekly max in-office shifts by picking up this shift.`);
          return;
        }
      }

      state.shifts = state.shifts.map((item) => Number(item.id) === shiftId
        ? {
            ...item,
            agentId: currentAgentId,
            offeredForPickup: false,
            offeredByAgentId: null,
            offeredAt: null,
            pickedUpAt: new Date().toISOString()
          }
        : item);
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-shift-select-checkbox]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (!canManageCalendar) return;
      const id = Number(checkbox.getAttribute('data-shift-select-checkbox'));
      if (!id) return;
      if (checkbox.checked) {
        selectedCalendarShiftIds.add(id);
      } else {
        selectedCalendarShiftIds.delete(id);
      }
      render();
    });
  });

  document.querySelector('[data-select-visible-shifts]')?.addEventListener('click', () => {
    if (!canManageCalendar) return;
    selectedCalendarShiftIds = new Set(getFilteredCalendarShifts().map((shift) => Number(shift.id)));
    render();
  });

  document.querySelector('[data-clear-selected-shifts]')?.addEventListener('click', () => {
    if (!canManageCalendar) return;
    selectedCalendarShiftIds.clear();
    render();
  });

  document.querySelector('[data-publish-selected-shifts]')?.addEventListener('click', () => {
    if (!canManageCalendar) return;
    if (selectedCalendarShiftIds.size === 0) return;
    const shiftsToNotify = state.shifts
      .filter((shift) => selectedCalendarShiftIds.has(Number(shift.id)) && shift.status !== shiftStatuses.published)
      .map((shift) => ({ ...shift, status: shiftStatuses.published }));
    const shouldSendEmails = shiftsToNotify.length > 0 ? shouldSendPublishedScheduleEmails(shiftsToNotify.length) : false;

    state.shifts = state.shifts.map((shift) => (selectedCalendarShiftIds.has(Number(shift.id))
      ? { ...shift, status: shiftStatuses.published }
      : shift));

    if (shouldSendEmails) {
      shiftsToNotify.forEach((shift) => {
        sendShiftPublishedEmail(shift);
      });
    }

    saveState();
    render();
  });

  document.querySelector('[data-remove-selected-shifts]')?.addEventListener('click', () => {
    if (!canManageCalendar) return;
    if (selectedCalendarShiftIds.size === 0) return;
    const selectedCount = selectedCalendarShiftIds.size;
    const shouldDelete = confirm(`Delete ${selectedCount} selected shift${selectedCount === 1 ? '' : 's'}?`);
    if (!shouldDelete) return;

    const selectedIds = new Set(Array.from(selectedCalendarShiftIds));
    state.shifts = state.shifts.filter((shift) => !selectedIds.has(Number(shift.id)));
    state.swapRequests = state.swapRequests.filter((request) => {
      const fromShiftId = getSwapRequestFromShiftId(request);
      const toShiftId = getSwapRequestToShiftId(request);
      return !selectedIds.has(Number(fromShiftId)) && !selectedIds.has(Number(toShiftId));
    });
    selectedCalendarShiftIds.clear();
    saveState();
    render();
  });

  document.querySelectorAll('[data-edit-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!canManageCalendar) return;
      const id = Number(button.getAttribute('data-edit-shift'));
      const shift = state.shifts.find((item) => item.id === id);
      if (!shift) return;
      openShiftEditModal(shift, (updatedShift) => {
        const shouldNotify = shift.status !== shiftStatuses.published && updatedShift.status === shiftStatuses.published;
        state.shifts = state.shifts.map((item) => item.id === id ? updatedShift : item);
        if (shouldNotify && shouldSendPublishedScheduleEmails(1)) {
          sendShiftPublishedEmail(updatedShift);
        }
        saveState();
        render();
      });
    });
  });

  document.querySelectorAll('[data-publish-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!canManageCalendar) return;
      const id = Number(button.getAttribute('data-publish-shift'));
      const shiftToPublish = state.shifts.find((shift) => shift.id === id);
      if (!shiftToPublish) return;
      const shouldSendEmails = shiftToPublish.status !== shiftStatuses.published
        ? shouldSendPublishedScheduleEmails(1)
        : false;

      state.shifts = state.shifts.map((shift) => shift.id === id ? { ...shift, status: shiftStatuses.published } : shift);
      if (shiftToPublish.status !== shiftStatuses.published && shouldSendEmails) {
        sendShiftPublishedEmail({ ...shiftToPublish, status: shiftStatuses.published });
      }
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-mark-shift-absent]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!canMarkAbsence) return;
      const id = Number(button.getAttribute('data-mark-shift-absent'));
      const shift = state.shifts.find((item) => Number(item.id) === id);
      if (!shift) return;
      openShiftAbsenceModal(shift, (absenceReason) => {
        state.shifts = state.shifts.map((item) => Number(item.id) === id
          ? {
              ...item,
              absenceReason,
              absentMarkedAt: getCurrentIsoTimestamp()
            }
          : item);
        saveState();
        render();
      });
    });
  });

  document.querySelectorAll('[data-clear-shift-absent]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!canMarkAbsence) return;
      const id = Number(button.getAttribute('data-clear-shift-absent'));
      const shift = state.shifts.find((item) => Number(item.id) === id);
      if (!shift) return;
      const shouldClear = confirm('Clear this shift absence flag?');
      if (!shouldClear) return;
      state.shifts = state.shifts.map((item) => Number(item.id) === id
        ? {
            ...item,
            absenceReason: '',
            absentMarkedAt: ''
          }
        : item);
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

  document.querySelectorAll('[data-edit-availability-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-edit-availability-request'));
      const allAvailabilityRequests = getAllAvailabilityRequests();
      const request = allAvailabilityRequests.find((item) => Number(item.id) === id);
      if (!request) return;
      if (request.status !== 'approved' || String(request.unavailabilityType || '').trim() !== 'PTO') {
        return;
      }

      openAvailabilityRequestEditModal(request, (updatedRequest) => {
        const nextAvailabilityRequests = allAvailabilityRequests.map((item) => Number(item.id) === id ? updatedRequest : item);
        saveAvailabilityRequests(nextAvailabilityRequests);
        saveState();
        const requestOwner = getUserByAgentId(updatedRequest.agentId);
        const recipientEmail = updatedRequest.requesterEmail || requestOwner?.email || '';
        const recipientName = updatedRequest.requesterName || requestOwner?.username || 'Agent';
        if (recipientEmail) {
          sendEmailNotification({
            to: recipientEmail,
            subject: 'Approved PTO request updated',
            body: `Hi ${recipientName}, your approved PTO request has been updated by an admin.\n\nDate: ${updatedRequest.unavailableDate || 'Not set'}\nTime: ${formatTimeRange(updatedRequest.unavailableStart, updatedRequest.unavailableEnd)}\nNote: ${updatedRequest.note || 'No note provided'}`,
            type: 'availability-approved-updated'
          });
        }
        render();
      });
    });
  });

  document.querySelectorAll('[data-approve-swap-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.getAttribute('data-approve-swap-request'));
      const currentUser = getCurrentUser();
      const currentAgentId = Number(currentUser?.agentId);
      if (!currentAgentId) return;
      const previousRequest = state.swapRequests.find((request) => request.id === id) || null;

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
        const fromShiftId = getSwapRequestFromShiftId(updatedRequest);
        const toShiftId = getSwapRequestToShiftId(updatedRequest);
        const fromShift = getShiftById(fromShiftId);
        const toShift = getShiftById(toShiftId);

        const fromAgent = getAgent(updatedRequest.fromAgentId);
        const toAgent = getAgent(updatedRequest.toAgentId);
        if (isSwapRestrictedAgent(fromAgent) || isSwapRestrictedAgent(toAgent)) {
          state.swapRequests = state.swapRequests.map((request) => request.id === id
            ? { ...request, status: 'rejected', rejectedBy: currentAgentId, rejectedAt: new Date().toISOString() }
            : request);
          alert('Swaps with Booth Duty are not allowed.');
          saveState();
          render();
          return;
        }
        const fromMaxInOffice = normalizeMaxInOfficeShifts(fromAgent?.maxInOfficeShifts);
        const toMaxInOffice = normalizeMaxInOfficeShifts(toAgent?.maxInOfficeShifts);

        if (fromShift && toShift && isInOfficeRole(toShift.role) && Number.isFinite(fromMaxInOffice)) {
          const projectedFromInOffice = getAssignedInOfficeShiftCount(updatedRequest.fromAgentId, toShift.date || fromShift.date || '', {
            excludingShiftId: Number(fromShift.id)
          }) + 1;
          if (projectedFromInOffice > fromMaxInOffice) {
            alert(`${fromAgent?.name || 'This agent'} would exceed their weekly max in-office shifts with this swap.`);
            saveState();
            render();
            return;
          }
        }

        if (fromShift && toShift && isInOfficeRole(fromShift.role) && Number.isFinite(toMaxInOffice)) {
          const projectedToInOffice = getAssignedInOfficeShiftCount(updatedRequest.toAgentId, fromShift.date || toShift.date || '', {
            excludingShiftId: Number(toShift.id)
          }) + 1;
          if (projectedToInOffice > toMaxInOffice) {
            alert(`${toAgent?.name || 'This agent'} would exceed their weekly max in-office shifts with this swap.`);
            saveState();
            render();
            return;
          }
        }

        state.shifts = state.shifts.map((shift) => {
          if (Number(shift.id) === Number(fromShiftId)) {
            return { ...shift, agentId: updatedRequest.toAgentId };
          }
          if (Number(shift.id) === Number(toShiftId)) {
            return { ...shift, agentId: updatedRequest.fromAgentId };
          }
          return shift;
        });
        state.swapRequests = state.swapRequests.map((request) => request.id === id
          ? { ...request, status: 'completed', completedAt: new Date().toISOString() }
          : request);
      }

      saveState();
      const finalizedRequest = state.swapRequests.find((request) => request.id === id) || updatedRequest;
      if (finalizedRequest && previousRequest && (
        previousRequest.fromApproved !== finalizedRequest.fromApproved
        || previousRequest.toApproved !== finalizedRequest.toApproved
        || previousRequest.status !== finalizedRequest.status
      )) {
        sendSwapNotificationEmails(finalizedRequest, finalizedRequest.status === 'completed' ? 'completed' : 'approved', currentAgentId);
      }
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

  document.querySelectorAll('[data-copy-dup-shift]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!canManageCalendar) return;
      const id = Number(button.getAttribute('data-copy-dup-shift'));
      const shift = state.shifts.find((item) => item.id === id);
      if (!shift) return;

      const shouldDuplicateNow = confirm('Shift action:\n\nSelect OK to duplicate this shift now.\nSelect Cancel for copy options.');
      if (shouldDuplicateNow) {
        const duplicatedShift = cloneShift(shift);
        if (!await confirmShiftAssignmentWithTimeOffWarning(duplicatedShift.agentId, duplicatedShift.date, duplicatedShift.start, duplicatedShift.end, {
          durationHours: duplicatedShift.durationHours,
          role: duplicatedShift.role
        })) return;
        state.shifts.push(duplicatedShift);
        saveState();
        render();
        return;
      }

      const shouldCopyForPaste = confirm('Copy this shift so you can paste it elsewhere?');
      if (!shouldCopyForPaste) return;
      copiedShiftTemplate = { ...shift };
      render();
    });
  });

  document.querySelectorAll('[data-paste-shift-day]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!canManageCalendar) return;
      const day = button.getAttribute('data-paste-shift-day');
      if (!copiedShiftTemplate || !day) return;
      const pastedShift = cloneShift(copiedShiftTemplate, day);
      if (!await confirmShiftAssignmentWithTimeOffWarning(pastedShift.agentId, pastedShift.date, pastedShift.start, pastedShift.end, {
        durationHours: pastedShift.durationHours,
        role: pastedShift.role
      })) return;
      state.shifts.push(pastedShift);
      saveState();
      render();
    });
  });

  document.querySelectorAll('.shift').forEach((shiftElement) => {
    shiftElement.addEventListener('dragstart', (event) => {
      if (!canManageCalendar) return;
      draggedShiftId = Number(shiftElement.getAttribute('data-shift-id'));
      event.dataTransfer?.setData('text/plain', String(draggedShiftId));
    });
    shiftElement.addEventListener('dragend', () => {
      if (!canManageCalendar) return;
      draggedShiftId = null;
      document.querySelectorAll('.day-card').forEach((card) => card.classList.remove('drag-over'));
    });
  });

  document.querySelectorAll('.day-card').forEach((card) => {
    card.addEventListener('dragover', (event) => {
      if (!canManageCalendar) return;
      event.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      if (!canManageCalendar) return;
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', async (event) => {
      if (!canManageCalendar) return;
      event.preventDefault();
      card.classList.remove('drag-over');
      const shiftId = draggedShiftId ?? Number(event.dataTransfer?.getData('text/plain'));
      if (!shiftId) return;

      const shiftToMove = state.shifts.find((shift) => Number(shift.id) === Number(shiftId));
      if (!shiftToMove) return;

      const targetDay = card.getAttribute('data-day') || shiftToMove.day;
      const targetDate = card.getAttribute('data-date') || shiftToMove.date || '';
      const movedToNewDate = String(shiftToMove.date || '') !== String(targetDate || '');

      if (movedToNewDate && !await confirmShiftAssignmentWithTimeOffWarning(shiftToMove.agentId, targetDate, shiftToMove.start, shiftToMove.end, {
        replacingShiftId: Number(shiftToMove.id),
        durationHours: Number(shiftToMove.durationHours) || getDurationHours(shiftToMove.start, shiftToMove.end),
        role: shiftToMove.role
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
  void migrateLegacyPolicyContentToIndexedDb().finally(() => {
    render();
  });
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
