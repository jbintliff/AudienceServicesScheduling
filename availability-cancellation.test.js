import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const functionSource = (start, end) => source.slice(source.indexOf(`function ${start}(`), source.indexOf(`function ${end}(`));

test('agents can cancel their own approved requests but not other or rejected requests', () => {
  let requests = [
    { id: 1, agentId: 7, status: 'approved', unavailabilityType: 'PTO', unavailableDate: '2026-12-01' },
    { id: 2, agentId: 8, status: 'approved' },
    { id: 3, agentId: 7, status: 'rejected' },
    { id: 4, agentId: 7, status: 'pending', unavailabilityType: 'Availability' }
  ];
  let confirmed = true;
  const context = vm.createContext({
    getCurrentUser: () => ({ agentId: 7 }),
    isAgentLikeUser: () => true,
    getAllAvailabilityRequests: () => requests,
    isAvailabilityRequestVisibleToUser: (request, user) => request.agentId === user.agentId,
    normalizeAvailabilityRequestStatus: (status) => status,
    confirm: () => confirmed,
    getCurrentIsoTimestamp: () => '2026-11-18T15:00:00.000Z',
    saveAvailabilityRequests: (updated) => { requests = updated; },
    saveState: () => true,
    render: () => {},
    alert: () => {}
  });
  vm.runInContext(functionSource('cancelOwnAvailabilityRequest', 'groupAvailabilityRequestsForAdminList'), context);
  assert.equal(context.cancelOwnAvailabilityRequest(2), false);
  assert.equal(context.cancelOwnAvailabilityRequest(3), false);
  confirmed = false;
  assert.equal(context.cancelOwnAvailabilityRequest(1), false);
  assert.equal(requests[0].status, 'approved');
  confirmed = true;
  assert.equal(context.cancelOwnAvailabilityRequest(1), true);
  assert.equal(requests[0].status, 'agent-deleted');
  assert.equal(requests[0].agentCanceledAfterApproval, true);
  assert.equal(requests[0].notifyAdminOfCancellation, true);
  assert.equal(context.cancelOwnAvailabilityRequest(4), true);
  assert.equal(requests[3].agentCanceledAfterApproval, false);
});

test('cancellation notices are scoped, retained, and acknowledged per admin and browser', () => {
  const requests = [{
    id: 1, agentId: 7, status: 'agent-deleted', notifyAdminOfCancellation: true,
    agentDeletedAt: '2026-11-18T15:00:00.000Z', agentCanceledAfterApproval: true,
    unavailabilityType: 'PTO', unavailableDate: '2026-12-01',
    unavailableStart: '09:00', unavailableEnd: '17:00'
  }, { id: 2, agentId: 7, status: 'agent-deleted', agentDeletedAt: '2026-01-01' }];
  const storage = new Map();
  const alerts = [];
  const context = vm.createContext({
    canManageAvailability: (user) => user.role === 'admin',
    localStorage: { getItem: (key) => storage.get(key) || null },
    cancellationNoticesSeenKey: 'seen',
    getUserDepartment: (user) => user.department || '',
    getAllAvailabilityRequests: () => requests,
    isAgentInDepartmentScope: (id, scope) => !scope || (id === 7 && scope === 'Audience Services'),
    getAgent: () => ({ name: 'Test Agent' }),
    alert: (message) => alerts.push(message),
    safeSetLocalStorage: (key, value) => { storage.set(key, value); return true; },
    console
  });
  vm.runInContext(functionSource('showPendingCancellationPopup', 'getManagedTeamsForUser'), context);
  const admin = { id: 10, role: 'admin', department: 'Audience Services' };
  context.showPendingCancellationPopup({ id: 7, role: 'agent' });
  context.showPendingCancellationPopup({ id: 11, role: 'admin', department: 'Box Office' });
  assert.equal(alerts.length, 0);
  context.showPendingCancellationPopup(admin);
  assert.match(alerts[0], /Test Agent: PTO, 2026-12-01, 09:00 - 17:00 \(previously approved\)/);
  context.showPendingCancellationPopup(admin);
  assert.equal(alerts.length, 1);
  requests[0].status = 'deleted';
  context.showPendingCancellationPopup({ id: 12, role: 'admin' });
  assert.equal(alerts.length, 2);
});

test('completed request list offers cancellation only for approved requests', () => {
  const root = { innerHTML: '' };
  const context = vm.createContext({
    root,
    isAgentLikeUser: () => true,
    isAgentUser: () => true,
    getAllAvailabilityRequests: () => [
      { id: 1, agentId: 7, status: 'approved', unavailabilityType: 'Availability' },
      { id: 2, agentId: 7, status: 'rejected', unavailabilityType: 'PTO' }
    ],
    isAvailabilityRequestVisibleToUser: () => true,
    normalizeAvailabilityRequestStatus: (status) => status,
    state: { swapRequests: [] },
    renderAgentNavigationLinks: () => '',
    renderUserNavChip: () => '',
    escapeHtml: (value) => String(value),
    getAvailabilityRecurrenceLabel: () => 'Once',
    getAvailabilityRequestStatusLabel: (status) => status,
    bindEvents: () => {}
  });
  vm.runInContext(functionSource('renderAgentAvailabilityPtoRequestsPage', 'renderEmailOutboxPage'), context);
  context.renderAgentAvailabilityPtoRequestsPage({ agentId: 7 });
  assert.match(root.innerHTML, /data-cancel-own-availability-request="1"/);
  assert.doesNotMatch(root.innerHTML, /data-cancel-own-availability-request="2"/);
});
