import { getCurrentLocale } from '@/providers/I18nProvider';
import { getServerById } from '@/providers/ServersProvider';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';

export const SESSION_ID_SEP = '::';

let _activeProjectId = DEFAULT_PROJECT_ID;

export function getActiveProjectId() {
  return _activeProjectId;
}

export function setActiveProjectIdInModule(id) {
  _activeProjectId = (typeof id === 'string' && id) ? id : DEFAULT_PROJECT_ID;
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

  const headers = {
    'Accept-Language': locale,
    'X-API-Key': server.apiKey,
    ...options.headers,
  };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(`${buildBaseUrl(server)}${path}`, { ...options, headers });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const wrapped = new Error(err?.message || 'Network error');
    wrapped.detail_key = isTimeout ? 'errors.server_timeout' : 'errors.server_unreachable';
    wrapped.detail_params = { name };
    wrapped.serverId = serverId;
    wrapped.reason = isTimeout ? 'timeout' : 'unreachable';
    wrapped.cause = err;
    throw wrapped;
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

export function createSession(serverId, name, groupId = null, cwd = null) {
  const body = { name: name || null, group_id: groupId, project_id: getActiveProjectId() };
  if (cwd) body.cwd = cwd;
  return request(serverId, '/api/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function assignSessionGroup(compositeId, groupId) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/group`, {
    method: 'PATCH',
    body: JSON.stringify({ group_id: groupId }),
  });
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

export function syncSessions(serverId) {
  return request(serverId, '/api/sessions/sync', { method: 'POST' });
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

export function openEditor(compositeId) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/open-editor`, { method: 'POST' });
}

export function getSessionCwd(compositeId) {
  const { serverId, sessionId } = sessionIdOf(compositeId);
  return request(serverId, `/api/sessions/${sessionId}/cwd`);
}

const NAME_MAX = 50;
const PROMPT_BODY_MAX = 10000;

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

export async function getLayouts() {
  return localRequest('/api/layouts');
}

export async function setLayouts(layouts) {
  return localRequest('/api/layouts', {
    method: 'PUT',
    body: JSON.stringify({ layouts }),
  });
}

export async function getViewState() {
  return localRequest('/api/view-state');
}

export async function setViewState(viewState) {
  return localRequest('/api/view-state', {
    method: 'PUT',
    body: JSON.stringify({ view_state: viewState }),
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

export async function deleteGroup(groupId) {
  const { groups } = await getGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Group not found');
    err.detail_key = 'errors.group_not_found';
    throw err;
  }
  const nextGroups = groups.filter(g => g.id !== groupId);
  await localRequest('/api/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: nextGroups }),
  });
  return { detail_key: 'success.group_deleted' };
}

function normalizePrompt(payload) {
  const name = String(payload.name ?? '').trim();
  if (!name) {
    const err = new Error('Prompt name required');
    err.detail_key = 'errors.prompt_name_required';
    throw err;
  }
  if (name.length > NAME_MAX) {
    const err = new Error('Prompt name too long');
    err.detail_key = 'errors.prompt_name_too_long';
    err.detail_params = { max: NAME_MAX };
    throw err;
  }
  const body = typeof payload.body === 'string' ? payload.body : '';
  if (body.length > PROMPT_BODY_MAX) {
    const err = new Error('Prompt body too long');
    err.detail_key = 'errors.prompt_body_too_long';
    err.detail_params = { max: PROMPT_BODY_MAX };
    throw err;
  }
  return { name, body };
}

export async function getPrompts() {
  return localRequest('/api/prompts');
}

export async function createPrompt({ name, body, isGlobal = false }) {
  const clean = normalizePrompt({ name, body });
  const { prompts } = await getPrompts();
  const draft = { ...clean, project_id: isGlobal ? null : getActiveProjectId() };
  const res = await localRequest('/api/prompts', {
    method: 'PUT',
    body: JSON.stringify({ prompts: [...prompts, draft] }),
  });
  const created = res.prompts[res.prompts.length - 1];
  return { prompt: created, detail_key: 'success.prompt_created' };
}

export async function updatePrompt(promptId, payload) {
  const { prompts } = await getPrompts();
  const existing = prompts.find(p => p.id === promptId);
  if (!existing) {
    const err = new Error('Prompt not found');
    err.detail_key = 'errors.prompt_not_found';
    throw err;
  }
  let projectId = existing.project_id ?? null;
  if ('isGlobal' in payload) {
    projectId = payload.isGlobal ? null : getActiveProjectId();
  }
  const merged = {
    ...existing,
    ...('name' in payload ? { name: payload.name } : {}),
    ...('body' in payload ? { body: payload.body } : {}),
    project_id: projectId,
    updated_at: new Date().toISOString(),
  };
  const clean = normalizePrompt({
    name: merged.name,
    body: merged.body,
  });
  const next = prompts.map(p => p.id === promptId ? { ...merged, ...clean } : p);
  const res = await localRequest('/api/prompts', {
    method: 'PUT',
    body: JSON.stringify({ prompts: next }),
  });
  const updated = res.prompts.find(p => p.id === promptId);
  return { prompt: updated, detail_key: 'success.prompt_updated' };
}

export async function deletePrompt(promptId) {
  const { prompts } = await getPrompts();
  if (!prompts.some(p => p.id === promptId)) {
    const err = new Error('Prompt not found');
    err.detail_key = 'errors.prompt_not_found';
    throw err;
  }
  await localRequest('/api/prompts', {
    method: 'PUT',
    body: JSON.stringify({ prompts: prompts.filter(p => p.id !== promptId) }),
  });
  return { detail_key: 'success.prompt_deleted' };
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

export async function saveImageToTemp(compositeIdOrServerId, blob) {
  let serverId = compositeIdOrServerId;
  if (typeof compositeIdOrServerId === 'string' && compositeIdOrServerId.includes(SESSION_ID_SEP)) {
    serverId = splitSessionId(compositeIdOrServerId).serverId;
  }
  const server = getServerById(serverId);
  if (!server) throw notConfiguredError();
  const locale = getCurrentLocale();
  const formData = new FormData();
  formData.append('image', blob);
  const res = await fetch(`${buildBaseUrl(server)}/api/clipboard/image`, {
    method: 'POST',
    body: formData,
    headers: {
      'Accept-Language': locale,
      'X-API-Key': server.apiKey,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || 'Image save error');
    err.detail = data.detail;
    err.detail_key = data.detail_key;
    err.detail_params = data.detail_params;
    err.serverId = serverId;
    err.status = res.status;
    throw err;
  }
  return data.path;
}

// ===== Notes =====

export function listNotes() {
  return localRequest('/api/notes');
}

export function createNote(payload) {
  const body = { ...(payload || {}), project_id: getActiveProjectId() };
  return localRequest('/api/notes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchNote(id, patch) {
  return localRequest(`/api/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteNote(id) {
  return localRequest(`/api/notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ===== Flows =====

export function listFlows() {
  return localRequest('/api/flows');
}

export function createFlow(payload) {
  const body = { ...(payload || {}), project_id: getActiveProjectId() };
  return localRequest('/api/flows', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchFlow(id, patch) {
  return localRequest(`/api/flows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteFlow(id) {
  return localRequest(`/api/flows/${encodeURIComponent(id)}`, {
    method: 'DELETE',
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

export async function saveProjects(state) {
  return localRequest('/api/projects', {
    method: 'PUT',
    body: JSON.stringify(state),
  });
}

export async function createProject(name) {
  const clean = normalizeProjectName(name);
  const state = await getProjects();
  assertUniqueProjectName(state.projects, clean);
  const draft = { name: clean };
  const next = {
    projects: [...state.projects, draft],
    active_project_id: state.active_project_id,
  };
  const res = await saveProjects(next);
  const created = res.projects[res.projects.length - 1];
  return { project: created, detail_key: 'success.project_created', state: res };
}

export async function renameProject(projectId, name) {
  const clean = normalizeProjectName(name);
  const state = await getProjects();
  const target = state.projects.find(p => p.id === projectId);
  if (!target) {
    const err = new Error('Project not found');
    err.detail_key = 'errors.project_not_found';
    throw err;
  }
  assertUniqueProjectName(state.projects, clean, projectId);
  const next = {
    projects: state.projects.map(p => p.id === projectId ? { ...p, name: clean } : p),
    active_project_id: state.active_project_id,
  };
  const res = await saveProjects(next);
  const updated = res.projects.find(p => p.id === projectId);
  return { project: updated, detail_key: 'success.project_renamed', state: res };
}

export async function setActiveProject(projectId) {
  const state = await getProjects();
  if (!state.projects.some(p => p.id === projectId)) {
    const err = new Error('Project not found');
    err.detail_key = 'errors.project_not_found';
    throw err;
  }
  const next = { ...state, active_project_id: projectId };
  const res = await saveProjects(next);
  return { detail_key: 'success.project_activated', state: res };
}

export async function getProjectStats(projectId) {
  const url = `/api/projects/stats?project_id=${encodeURIComponent(projectId)}`;
  return localRequest(url);
}

export async function deleteProject(projectId) {
  const state = await getProjects();
  const target = state.projects.find(p => p.id === projectId);
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
    + (stats?.notes || 0) + (stats?.flows || 0) + (stats?.prompts || 0);
  if (total > 0) {
    const err = new Error('Project is not empty');
    err.detail_key = 'errors.project_not_empty';
    err.detail_params = stats;
    throw err;
  }
  const def = state.projects.find(p => p.is_default) || state.projects[0];
  const nextActive = state.active_project_id === projectId ? def.id : state.active_project_id;
  const next = {
    projects: state.projects.filter(p => p.id !== projectId),
    active_project_id: nextActive,
  };
  const res = await saveProjects(next);
  return { detail_key: 'success.project_deleted', state: res };
}
