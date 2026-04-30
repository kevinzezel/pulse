import { getCurrentLocale } from '@/providers/I18nProvider';
import { getServerById } from '@/providers/ServersProvider';
import { SERVER_HEALTH_TIMEOUT_MS, timeoutSignal } from '@/utils/serverHealth';

export const SESSION_ID_SEP = '::';
const REMOTE_REQUEST_TIMEOUT_MS = SERVER_HEALTH_TIMEOUT_MS;

// Onboarding gate (v4.2) guarantees at least one project exists before any
// of these helpers run. Until then the value is null; callers that depend
// on it (createSession etc.) only fire from UI that the onboarding gate
// blocks, so a null read here would be a bug, not a normal path.
let _activeProjectId = null;

export function getActiveProjectId() {
  return _activeProjectId;
}

export function setActiveProjectIdInModule(id) {
  _activeProjectId = (typeof id === 'string' && id) ? id : null;
}

export function composeSessionId(serverId, sessionId) {
  return `${serverId}${SESSION_ID_SEP}${sessionId}`;
}

export function splitSessionId(compositeId) {
  if (typeof compositeId !== 'string') return { serverId: null, sessionId: compositeId };
  const idx = compositeId.indexOf(SESSION_ID_SEP);
  if (idx < 0) return { serverId: null, sessionId: compositeId };
  return {
    serverId: compositeId.slice(0, idx),
    sessionId: compositeId.slice(idx + SESSION_ID_SEP.length),
  };
}

function notConfiguredError() {
  const err = new Error('Server not configured');
  err.detail_key = 'errors.server_not_configured';
  return err;
}

function buildBaseUrl(server) {
  const scheme = server.protocol === 'https' ? 'https' : 'http';
  return `${scheme}://${server.host}:${server.port}`;
}

async function request(serverId, path, options = {}) {
  const server = getServerById(serverId);
  if (!server) throw notConfiguredError();
  const locale = getCurrentLocale();
  const name = server.name || `${server.host}:${server.port}`;
  const {
    headers: optionHeaders,
    signal: optionSignal,
    timeoutMs = REMOTE_REQUEST_TIMEOUT_MS,
    ...fetchOptions
  } = options;

  const headers = {
    'Accept-Language': locale,
    'X-API-Key': server.apiKey,
    ...optionHeaders,
  };
  if (fetchOptions.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0
    ? timeoutSignal(timeoutMs)
    : null;
  const signal = (() => {
    if (optionSignal && timeout?.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      return AbortSignal.any([optionSignal, timeout.signal]);
    }
    return optionSignal || timeout?.signal;
  })();
  try {
    res = await fetch(`${buildBaseUrl(server)}${path}`, { ...fetchOptions, headers, ...(signal ? { signal } : {}) });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const wrapped = new Error(err?.message || 'Network error');
    wrapped.detail_key = isTimeout ? 'errors.server_timeout' : 'errors.server_unreachable';
    wrapped.detail_params = { name };
    wrapped.serverId = serverId;
    wrapped.reason = isTimeout ? 'timeout' : 'unreachable';
    wrapped.cause = err;
    throw wrapped;
  } finally {
    timeout?.cancel();
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.detail || 'Unexpected error');
    err.detail = data.detail;
    err.detail_key = res.status === 401 ? 'errors.server_bad_key' : (data.detail_key || 'errors.server_unknown');
    err.detail_params = data.detail_params || { name };
    err.serverId = serverId;
    err.status = res.status;
    err.reason = res.status === 401 ? 'bad_key' : 'unknown';
    throw err;
  }

  return data;
}

async function localRequest(path, options = {}) {
  const locale = getCurrentLocale();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': locale,
      ...options.headers,
    },
  });
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    const err = new Error('Unauthorized');
    err.detail_key = 'errors.unauthorized';
    err.status = 401;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || 'Unexpected error');
    err.detail = data.detail;
    err.detail_key = data.detail_key;
    err.detail_params = data.detail_params;
    err.status = res.status;
    throw err;
  }
  return data;
}

export function getLocalServers() {
  return localRequest('/api/servers');
}

export function setLocalServers(servers) {
  return localRequest('/api/servers', {
    method: 'PUT',
    body: JSON.stringify({ servers }),
  });
}

function sessionIdOf(compositeId) {
  const { serverId, sessionId } = splitSessionId(compositeId);
  if (!serverId) {
    const err = new Error('Composite session id missing server prefix');
    err.detail_key = 'errors.server_not_configured';
    throw err;
  }
  return { serverId, sessionId };
}

export function getSessions(serverId) {
  return request(serverId, '/api/sessions');
}

export function createSession(serverId, name, groupId = null, cwd = null, extras = {}) {
  const body = {
    name: name || null,
    group_id: groupId,
    project_id: getActiveProjectId(),
  };
  if (cwd) body.cwd = cwd;
  if (extras.groupName) body.group_name = extras.groupName;
  if (extras.projectName) body.project_name = extras.projectName;
  return request(serverId, '/api/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function assignSessionGroup(compositeId, groupId, groupName = null) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  const body = { group_id: groupId };
  if (groupName !== null) body.group_name = groupName || '';
  return request(serverId, `/api/sessions/${sessionId}/group`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function updateSessionScopeNames(compositeId, { projectName = undefined, groupName = undefined } = {}) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  const body = {};
  if (projectName !== undefined) body.project_name = projectName || '';
  if (groupName !== undefined) body.group_name = groupName || '';
  return request(serverId, `/api/sessions/${sessionId}/scope-names`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// Fire-and-forget: propagate a renamed project/group down to every live session
// on every configured server, so future idle notifications carry the fresh
// label. Each target is retried up to 3x with exponential backoff (1s/2s/4s)
// to survive momentary server-flaps during the rename. Final failures are
// logged to console — the client holds metadata in-memory only, so a permanent
// failure here means orphan sessions keep the stale label until they're
// killed/restored.
async function retryUpdateScopeName(compositeId, patch, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await updateSessionScopeNames(compositeId, patch);
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}

async function propagateScopeName(filterFn, patch) {
  try {
    const { servers } = await getLocalServers();
    if (!Array.isArray(servers) || servers.length === 0) return;
    await Promise.allSettled(servers.map(async (srv) => {
      try {
        const data = await getSessions(srv.id);
        const targets = (data?.sessions || []).filter(filterFn);
        await Promise.allSettled(targets.map((s) =>
          retryUpdateScopeName(composeSessionId(srv.id, s.id), patch).catch((err) => {
            console.warn('propagateScopeName: session', s.id, 'on', srv.id, 'failed:', err);
          })
        ));
      } catch (err) {
        console.warn('propagateScopeName: server', srv.id, 'unreachable:', err);
      }
    }));
  } catch (err) {
    console.warn('propagateScopeName: global failure:', err);
  }
}

export function sendTextToSession(compositeId, text, sendEnter = false) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/send-text`, {
    method: 'POST',
    body: JSON.stringify({ text, send_enter: sendEnter }),
  });
}

export function setSessionNotify(compositeId, notifyOnIdle) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/notify`, {
    method: 'PATCH',
    body: JSON.stringify({ notify_on_idle: notifyOnIdle }),
  });
}

export function renameSession(compositeId, name) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function killSession(compositeId) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export function cloneSession(compositeId) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/clone`, { method: 'POST' });
}

export function openEditor(compositeId, { newWindow = false } = {}) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  const qs = newWindow ? '?new_window=true' : '';
  return request(serverId, `/api/sessions/${sessionId}/open-editor${qs}`, { method: 'POST' });
}

export function getSessionCwd(compositeId) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/cwd`);
}

const NAME_MAX = 50;

function normalizeGroupName(name) {
  const stripped = String(name ?? '').trim();
  if (!stripped) {
    const err = new Error('Group name is required');
    err.detail_key = 'errors.group_name_required';
    throw err;
  }
  if (stripped.length > NAME_MAX) {
    const err = new Error('Group name too long');
    err.detail_key = 'errors.group_name_too_long';
    err.detail_params = { max: NAME_MAX };
    throw err;
  }
  return stripped;
}

function assertUniqueName(groups, name, excludeId = null) {
  const lowered = name.toLowerCase();
  if (groups.some(g => g.id !== excludeId && g.name.toLowerCase() === lowered)) {
    const err = new Error('Group name taken');
    err.detail_key = 'errors.group_name_taken';
    throw err;
  }
}

export async function getGroups() {
  return localRequest('/api/groups');
}

export async function saveGroups(groups) {
  return localRequest('/api/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

export function getSessionsSnapshot() {
  return localRequest('/api/sessions');
}

export function setSessionsSnapshot(data) {
  return localRequest('/api/sessions', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getComposeDrafts() {
  return localRequest('/api/compose-drafts');
}

export function setComposeDrafts(data) {
  return localRequest('/api/compose-drafts', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function restoreSessions(serverId, sessionsList) {
  return request(serverId, '/api/sessions/restore', {
    method: 'POST',
    body: JSON.stringify({ sessions: sessionsList }),
  });
}

export async function createGroup(name) {
  const clean = normalizeGroupName(name);
  const { groups } = await getGroups();
  const pid = getActiveProjectId();
  const scoped = groups.filter((g) => g.project_id === pid);
  assertUniqueName(scoped, clean);
  const draft = { name: clean, project_id: pid };
  const res = await localRequest('/api/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: [...groups, draft] }),
  });
  const created = res.groups[res.groups.length - 1];
  return { group: created, detail_key: 'success.group_created' };
}

export async function renameGroup(groupId, name) {
  const clean = normalizeGroupName(name);
  const { groups } = await getGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) {
    const err = new Error('Group not found');
    err.detail_key = 'errors.group_not_found';
    throw err;
  }
  const scoped = groups.filter(g => g.project_id === target.project_id);
  assertUniqueName(scoped, clean, groupId);
  const next = groups.map(g => g.id === groupId ? { ...g, name: clean } : g);
  const res = await localRequest('/api/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = res.groups.find(g => g.id === groupId);
  propagateScopeName((s) => s.group_id === groupId, { groupName: clean });
  return { group: updated, detail_key: 'success.group_renamed' };
}

export async function setGroupHidden(groupId, hidden) {
  const { groups } = await getGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Group not found');
    err.detail_key = 'errors.group_not_found';
    throw err;
  }
  const next = groups.map(g => g.id === groupId ? { ...g, hidden: !!hidden } : g);
  const res = await localRequest('/api/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = res.groups.find(g => g.id === groupId);
  return { group: updated, detail_key: hidden ? 'success.group_hidden' : 'success.group_shown' };
}

// ===== Flow Groups (independent from terminal groups) =====

export async function getFlowGroups(projectId) {
  const data = await localRequest(`/api/flow-groups?project_id=${encodeURIComponent(projectId)}`);
  return data.groups || [];
}

export async function createFlowGroup(projectId, name) {
  return await localRequest(`/api/flow-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function renameFlowGroup(projectId, id, name) {
  // Read full list, mutate, replace whole array via PUT (last-writer-wins).
  const groups = await getFlowGroups(projectId);
  const next = groups.map(g => g.id === id ? { ...g, name } : g);
  return await localRequest(`/api/flow-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
}

export async function setFlowGroupHidden(projectId, id, hidden) {
  // Same pattern as rename: read all, mutate one, replace via PUT.
  const groups = await getFlowGroups(projectId);
  const next = groups.map(g => g.id === id ? { ...g, hidden: !!hidden } : g);
  return await localRequest(`/api/flow-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
}

export async function deleteFlowGroup(projectId, id) {
  // Detach orphan flows from the group before removing it. Same rationale as
  // before: keeps the JSON clean if a future group reuses the id (UUID makes
  // it improbable, but the cleanup costs nothing).
  try {
    const flows = await listFlows(projectId);
    const orphans = flows.filter((f) => f.group_id === id);
    const results = await Promise.allSettled(orphans.map((f) => patchFlow(projectId, f.id, { group_id: null })));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.warn('deleteFlowGroup: failed to clear group_id on flow', orphans[i]?.id, results[i].reason);
      }
    }
  } catch (err) {
    console.warn('deleteFlowGroup: orphan cleanup failed:', err);
  }

  return await localRequest(
    `/api/flow-groups?project_id=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export async function reorderFlowGroups(projectId, groups) {
  return await localRequest(`/api/flow-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

export async function deleteGroup(groupId) {
  const { groups } = await getGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Group not found');
    err.detail_key = 'errors.group_not_found';
    throw err;
  }
  // Antes de remover o grupo do store local, limpa group_id/group_name
  // dos terminais órfãos em todos os servers. Sem isso, a notificação idle
  // deles continuaria com "...› NomeDoGrupoDeletado › ..." no título, pois
  // o client mantém os metadados em-memória até a sessão ser destruída.
  // Fire-and-forget: se algum server falhar, os órfãos ficam com labels
  // antigas — no pior caso, o título mostra nome desatualizado.
  try {
    const { servers } = await getLocalServers();
    if (Array.isArray(servers) && servers.length > 0) {
      await Promise.allSettled(servers.map(async (srv) => {
        try {
          const data = await getSessions(srv.id);
          const orphans = (data?.sessions || []).filter((s) => s.group_id === groupId);
          await Promise.allSettled(orphans.map((s) =>
            assignSessionGroup(composeSessionId(srv.id, s.id), null, null).catch(() => {})
          ));
        } catch {}
      }));
    }
  } catch {}

  const nextGroups = groups.filter(g => g.id !== groupId);
  await localRequest('/api/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: nextGroups }),
  });
  return { detail_key: 'success.group_deleted' };
}

// ===== Prompts =====

function buildScopeQS({ projectId, scope }) {
  if (scope === 'global') return '?scope=global';
  return `?project_id=${encodeURIComponent(projectId)}`;
}

export async function getPrompts({ projectId, scope } = {}) {
  const qs = buildScopeQS({ projectId, scope });
  const data = await localRequest(`/api/prompts${qs}`);
  return data.prompts || [];
}

// Combined fetch helper — used by PromptsLibrary and PromptQuickSelectorModal
// for the visible "globals + project-scoped" merged list.
export async function getCombinedPrompts(projectId) {
  const [global, scoped] = await Promise.all([
    getPrompts({ scope: 'global' }),
    getPrompts({ projectId }),
  ]);
  return [...global, ...scoped];
}

export async function createPrompt({ projectId, scope, body }) {
  const qs = buildScopeQS({ projectId, scope });
  return await localRequest(`/api/prompts${qs}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updatePrompt({ projectId, scope, id, patch }) {
  const qs = buildScopeQS({ projectId, scope });
  return await localRequest(`/api/prompts/${encodeURIComponent(id)}${qs}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deletePrompt({ projectId, scope, id }) {
  const qs = buildScopeQS({ projectId, scope });
  return await localRequest(`/api/prompts/${encodeURIComponent(id)}${qs}`, {
    method: 'DELETE',
  });
}

// ===== Prompt groups =====

export async function getPromptGroups({ projectId, scope } = {}) {
  const qs = buildScopeQS({ projectId, scope });
  const data = await localRequest(`/api/prompt-groups${qs}`);
  return data.groups || [];
}

export async function getCombinedPromptGroups(projectId) {
  return await getPromptGroups({ projectId });
}

export async function createPromptGroup({ projectId, scope, name }) {
  const qs = buildScopeQS({ projectId, scope });
  return await localRequest(`/api/prompt-groups${qs}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function renamePromptGroup({ projectId, scope, id, name }) {
  const qs = buildScopeQS({ projectId, scope });
  return await localRequest(`/api/prompt-groups/${encodeURIComponent(id)}${qs}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deletePromptGroup({ projectId, scope, id }) {
  const qs = buildScopeQS({ projectId, scope });
  return await localRequest(`/api/prompt-groups/${encodeURIComponent(id)}${qs}`, {
    method: 'DELETE',
  });
}

export function getSettings(serverId) {
  return request(serverId, '/api/settings');
}

export function updateTelegramSettings(serverId, { botToken, chatId }) {
  return request(serverId, '/api/settings/telegram', {
    method: 'PUT',
    body: JSON.stringify({ bot_token: botToken, chat_id: chatId }),
  });
}

export function updateNotificationsSettings(serverId, { idleTimeoutSeconds, channels }) {
  const body = {};
  if (idleTimeoutSeconds !== undefined) body.idle_timeout_seconds = idleTimeoutSeconds;
  if (channels !== undefined) body.channels = channels;
  return request(serverId, '/api/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function testTelegram(serverId) {
  return request(serverId, '/api/settings/telegram/test', { method: 'POST' });
}

export function discoverChatId(serverId, botToken) {
  return request(serverId, '/api/settings/telegram/discover-chat-id', {
    method: 'POST',
    body: JSON.stringify({ bot_token: botToken || null }),
  });
}

export function captureSession(compositeId, lines) {
  const { serverId, sessionId } = splitSessionId(compositeId);
  const qs = lines ? `?lines=${encodeURIComponent(lines)}` : '';
  return request(serverId, `/api/sessions/${encodeURIComponent(sessionId)}/capture${qs}`);
}

export function updateEditorSettings(serverId, { binaryOverride }) {
  return request(serverId, '/api/settings/editor', {
    method: 'PUT',
    body: JSON.stringify({ binary_override: binaryOverride || '' }),
  });
}

export function resolveEditor(serverId) {
  return request(serverId, '/api/settings/editor/resolve', { method: 'POST' });
}

export async function saveFileToTemp(compositeIdOrServerId, fileOrBlob, originalName = null) {
  let serverId = compositeIdOrServerId;
  if (typeof compositeIdOrServerId === 'string' && compositeIdOrServerId.includes(SESSION_ID_SEP)) {
    serverId = splitSessionId(compositeIdOrServerId).serverId;
  }
  const server = getServerById(serverId);
  if (!server) throw notConfiguredError();
  const locale = getCurrentLocale();
  const formData = new FormData();
  // Preserva o nome original se vier de um File (drop / picker). Fallback para
  // o name passado explicitamente ou um nome genérico.
  const filename = originalName
    || (fileOrBlob && typeof fileOrBlob === 'object' && fileOrBlob.name)
    || 'file';
  formData.append('file', fileOrBlob, filename);
  const res = await fetch(`${buildBaseUrl(server)}/api/clipboard/file`, {
    method: 'POST',
    body: formData,
    headers: {
      'Accept-Language': locale,
      'X-API-Key': server.apiKey,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || 'File save error');
    err.detail = data.detail;
    err.detail_key = data.detail_key;
    err.detail_params = data.detail_params;
    err.serverId = serverId;
    err.status = res.status;
    throw err;
  }
  return data.path;
}

// Wrapper de compatibilidade: callers antigos chamavam `saveImageToTemp(id, blob)`
// com um Blob de imagem. Mapeia direto pra saveFileToTemp.
export function saveImageToTemp(compositeIdOrServerId, blob) {
  return saveFileToTemp(compositeIdOrServerId, blob, blob?.name || 'image.png');
}

// ===== Notes =====

export async function listNotes(projectId) {
  const data = await localRequest(`/api/notes?project_id=${encodeURIComponent(projectId)}`);
  return data.notes || [];
}

export async function createNote(projectId, body) {
  return await localRequest(`/api/notes?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function patchNote(projectId, id, patch) {
  return await localRequest(
    `/api/notes/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

export async function deleteNote(projectId, id) {
  return await localRequest(
    `/api/notes/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
    { method: 'DELETE' },
  );
}

// ===== Flows =====

export async function listFlows(projectId) {
  const data = await localRequest(`/api/flows?project_id=${encodeURIComponent(projectId)}`);
  return data.flows || [];
}

export async function createFlow(projectId, body) {
  return await localRequest(`/api/flows?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function patchFlow(projectId, id, patch) {
  return await localRequest(
    `/api/flows/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

export async function deleteFlow(projectId, id) {
  return await localRequest(
    `/api/flows/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
    { method: 'DELETE' },
  );
}

// ===== Task Boards =====

export async function listTaskBoards(projectId) {
  const data = await localRequest(`/api/task-boards?project_id=${encodeURIComponent(projectId)}`);
  return data.boards || [];
}

export async function createTaskBoard(projectId, payload) {
  return await localRequest(`/api/task-boards?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export async function patchTaskBoard(projectId, id, actionPayload) {
  return await localRequest(
    `/api/task-boards/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(actionPayload),
    },
  );
}

export async function deleteTaskBoard(projectId, id) {
  return await localRequest(
    `/api/task-boards/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`,
    { method: 'DELETE' },
  );
}

// ===== Task Board Groups =====

export async function getTaskBoardGroups(projectId) {
  const data = await localRequest(`/api/task-board-groups?project_id=${encodeURIComponent(projectId)}`);
  return data.groups || [];
}

export async function createTaskBoardGroup(projectId, name) {
  const clean = normalizeGroupName(name);
  const groups = await getTaskBoardGroups(projectId);
  assertUniqueName(groups, clean);
  const created = await localRequest(`/api/task-board-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify({ name: clean }),
  });
  return { group: created, detail_key: 'success.task_board_group_created' };
}

export async function renameTaskBoardGroup(projectId, id, name) {
  const clean = normalizeGroupName(name);
  const groups = await getTaskBoardGroups(projectId);
  const target = groups.find((g) => g.id === id);
  if (!target) {
    const err = new Error('Task board group not found');
    err.detail_key = 'errors.task_board_group_not_found';
    throw err;
  }
  assertUniqueName(groups, clean, id);
  const next = groups.map((g) => (g.id === id ? { ...g, name: clean } : g));
  const res = await localRequest(`/api/task-board-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = (res.groups || []).find((g) => g.id === id);
  return { group: updated, detail_key: 'success.task_board_group_renamed' };
}

export async function setTaskBoardGroupHidden(projectId, id, hidden) {
  const groups = await getTaskBoardGroups(projectId);
  if (!groups.some((g) => g.id === id)) {
    const err = new Error('Task board group not found');
    err.detail_key = 'errors.task_board_group_not_found';
    throw err;
  }
  const next = groups.map((g) => (g.id === id ? { ...g, hidden: !!hidden } : g));
  const res = await localRequest(`/api/task-board-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = (res.groups || []).find((g) => g.id === id);
  return { group: updated, detail_key: hidden ? 'success.task_board_group_hidden' : 'success.task_board_group_shown' };
}

export async function deleteTaskBoardGroup(projectId, id) {
  // Detach orphan boards from the group before removing it. Same rationale
  // as deleteFlowGroup: keeps the JSON clean even if a future group reuses
  // the id (UUID makes it improbable, but the cleanup costs nothing).
  try {
    const boards = await listTaskBoards(projectId);
    const orphans = boards.filter((b) => b.group_id === id);
    const results = await Promise.allSettled(orphans.map((b) =>
      patchTaskBoard(projectId, b.id, { action: 'move_board_group', group_id: null })
    ));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.warn('deleteTaskBoardGroup: failed to clear group_id on board', orphans[i]?.id, results[i].reason);
      }
    }
  } catch (err) {
    console.warn('deleteTaskBoardGroup: orphan cleanup failed:', err);
  }

  await localRequest(
    `/api/task-board-groups?project_id=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return { detail_key: 'success.task_board_group_deleted' };
}

export async function reorderTaskBoardGroups(projectId, groups) {
  return await localRequest(`/api/task-board-groups?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

// ===== Projects =====

const PROJECT_NAME_MAX = 64;

function normalizeProjectName(name) {
  const clean = String(name ?? '').trim();
  if (!clean) {
    const err = new Error('Project name required');
    err.detail_key = 'errors.project_name_required';
    throw err;
  }
  if (clean.length > PROJECT_NAME_MAX) {
    const err = new Error('Project name too long');
    err.detail_key = 'errors.project_name_too_long';
    err.detail_params = { max: PROJECT_NAME_MAX };
    throw err;
  }
  return clean;
}

function assertUniqueProjectName(projects, name, excludeId = null) {
  const lower = name.toLowerCase();
  if (projects.some(p => p.id !== excludeId && String(p.name).toLowerCase() === lower)) {
    const err = new Error('Project name taken');
    err.detail_key = 'errors.project_name_taken';
    throw err;
  }
}

export function getProjects() {
  return localRequest('/api/projects');
}

// v4.2 (manifest-as-truth): server is the source of truth for the project
// list. We hand the server `{ name, target_backend_id }` and trust it to do
// the manifest write atomically. No more bulk PUT, no more reorder.
export async function createProject(name, targetBackendId = 'local') {
  const clean = normalizeProjectName(name);
  const { projects } = await getProjects();
  assertUniqueProjectName(projects, clean);
  const created = await localRequest('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: clean, target_backend_id: targetBackendId || 'local' }),
  });
  return { project: created, detail_key: 'success.project_created' };
}

// PATCH /api/projects/[id] with `{ name }`. The backend writes the new name
// into the owning manifest; the client still propagates the rename to live
// session metadata so notification titles refresh without a session restart.
export async function renameProject(projectId, name) {
  const clean = normalizeProjectName(name);
  const { projects } = await getProjects();
  const target = projects.find((p) => p.id === projectId);
  if (!target) {
    const err = new Error('Project not found');
    err.detail_key = 'errors.project_not_found';
    throw err;
  }
  assertUniqueProjectName(projects, clean, projectId);
  const updated = await localRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: clean }),
  });
  propagateScopeName((s) => s.project_id === projectId, { projectName: clean });
  return { project: updated, detail_key: 'success.project_renamed' };
}

// PATCH /api/projects/[id] with `{ set_default: true }`. Default lives in
// the per-install `data/project-prefs.json`, so flipping it on one tab
// affects only this install.
export async function setDefaultProject(projectId) {
  await localRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ set_default: true }),
  });
  return { detail_key: 'success.project_default_set' };
}

// PUT /api/projects with `{ active_project_id }` updates the per-install
// active pref. The provider also persists it in sessionStorage so the
// current tab keeps its choice across reloads even if a peer flips the pref.
export async function setActiveProjectOnServer(projectId) {
  return localRequest('/api/projects', {
    method: 'PUT',
    body: JSON.stringify({ active_project_id: projectId }),
  });
}

export async function getProjectStats(projectId) {
  const url = `/api/projects/stats?project_id=${encodeURIComponent(projectId)}`;
  return localRequest(url);
}

export async function deleteProject(projectId) {
  const { projects } = await getProjects();
  const target = projects.find((p) => p.id === projectId);
  if (!target) {
    const err = new Error('Project not found');
    err.detail_key = 'errors.project_not_found';
    throw err;
  }
  if (target.is_default) {
    const err = new Error('Default project cannot be deleted');
    err.detail_key = 'errors.project_default_protected';
    throw err;
  }
  const stats = await getProjectStats(projectId);
  const total = (stats?.groups || 0) + (stats?.terminals || 0)
    + (stats?.notes || 0) + (stats?.flows || 0) + (stats?.prompts || 0)
    + (stats?.taskBoards || 0) + (stats?.tasks || 0);
  if (total > 0) {
    const err = new Error('Project is not empty');
    err.detail_key = 'errors.project_not_empty';
    err.detail_params = stats;
    throw err;
  }
  await localRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  return { detail_key: 'success.project_deleted' };
}

// ----------------------------------------------------------------------------
// Storage (MongoDB sync) configuration + sync
// ----------------------------------------------------------------------------

export async function getStorageConfig() {
  return localRequest('/api/storage-config');
}

export async function setStorageConfig(payload) {
  // payload = { driver: 'mongo'|'s3'|'file', ...driver-specific params }
  return localRequest('/api/storage-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteStorageConfig() {
  return localRequest('/api/storage-config', { method: 'DELETE' });
}

// ===== Multi-backend storage management =====

export async function listBackends() {
  return localRequest('/api/storage/backends');
}

export async function getBackendManifest(backendId) {
  return localRequest(`/api/storage/backends/${encodeURIComponent(backendId)}/manifest`);
}

export async function addBackend({ name, driver, config }) {
  return localRequest('/api/storage/backends', {
    method: 'POST',
    body: JSON.stringify({ name, driver, config }),
  });
}

export async function removeBackend(id) {
  return localRequest(`/api/storage/backends/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function setDefaultBackend(id) {
  return localRequest(`/api/storage/backends/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ set_default: true }),
  });
}

export async function updateBackend(id, { name, config }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (config !== undefined) body.config = config;
  return localRequest(`/api/storage/backends/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function generateShareToken(backendId) {
  const data = await localRequest(
    `/api/storage/share-token/${encodeURIComponent(backendId)}`,
    { method: 'POST' },
  );
  return data.token;
}

export async function importBackendToken({ token, rename }) {
  return localRequest('/api/storage/import-token', {
    method: 'POST',
    body: JSON.stringify({ token, rename }),
  });
}

export async function moveProject({ projectId, targetBackendId }) {
  return localRequest(`/api/projects/${encodeURIComponent(projectId)}/move`, {
    method: 'POST',
    body: JSON.stringify({ target_backend_id: targetBackendId }),
  });
}

// ===== Intelligence (AI providers) =====

export function getIntelligenceConfig() {
  return localRequest('/api/intelligence-config');
}

export function setIntelligenceConfig(payload) {
  return localRequest('/api/intelligence-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteIntelligenceConfig(provider = null) {
  const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return localRequest(`/api/intelligence-config${qs}`, { method: 'DELETE' });
}

// Fetches the raw API key for a configured provider so Settings can mirror the
// Telegram token field and let users edit/clear the value in-place.
export function revealIntelligenceProvider(provider) {
  return localRequest(`/api/intelligence-config?reveal=${encodeURIComponent(provider)}`);
}

// Send a recorded audio Blob/File to the local transcription endpoint.
// The endpoint reads the Gemini API key from intelligence-config and forwards
// the audio to Gemini's generateContent API.
export async function transcribeVoiceAudio(audioBlob, filename = 'voice.wav', { signal } = {}) {
  const locale = getCurrentLocale();
  const formData = new FormData();
  formData.append('audio', audioBlob, filename);
  const res = await fetch('/api/intelligence/transcribe', {
    method: 'POST',
    body: formData,
    signal,
    headers: {
      'Accept-Language': locale,
    },
  });
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    const err = new Error('Unauthorized');
    err.detail_key = 'errors.unauthorized';
    err.status = 401;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || 'Transcription failed');
    err.detail = data.detail;
    err.detail_key = data.detail_key;
    err.detail_params = data.detail_params;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ===== Update notifier =====

const SERVER_VERSION_TIMEOUT_MS = 5000;

export async function getServerVersion(serverId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVER_VERSION_TIMEOUT_MS);
  try {
    return await request(serverId, '/api/version', { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getUpdateStatus({ force = false } = {}) {
  return localRequest(`/api/update-status${force ? '?force=1' : ''}`);
}

// ===== FS browser + recent cwds =====

export function listRemoteDirectory(serverId, path = null) {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return request(serverId, `/api/fs/list${qs}`);
}

export function getRecentCwds(serverId) {
  return localRequest(`/api/recent-cwds?serverId=${encodeURIComponent(serverId)}`);
}

export function addRecentCwd(serverId, path) {
  return localRequest('/api/recent-cwds', {
    method: 'POST',
    body: JSON.stringify({ serverId, path }),
  });
}

export function deleteRecentCwd(serverId, path) {
  const qs = `?serverId=${encodeURIComponent(serverId)}&path=${encodeURIComponent(path)}`;
  return localRequest(`/api/recent-cwds${qs}`, { method: 'DELETE' });
}
