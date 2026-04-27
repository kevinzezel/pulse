import { getCurrentLocale } from '@/providers/I18nProvider';
import { getServerById } from '@/providers/ServersProvider';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';
import { reorderById } from '@/utils/reorder';

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

export async function getFlowGroups() {
  return localRequest('/api/flow-groups');
}

export async function saveFlowGroups(groups) {
  return localRequest('/api/flow-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

export async function reorderFlowGroups(fromId, toId) {
  const { groups } = await getFlowGroups();
  const from = groups.find(g => g.id === fromId);
  const to = groups.find(g => g.id === toId);
  if (!from || !to || from.project_id !== to.project_id) {
    const err = new Error('Flow group not found');
    err.detail_key = 'errors.flow_group_not_found';
    throw err;
  }
  const scoped = groups.filter(g => g.project_id === from.project_id);
  const reordered = reorderById(scoped, fromId, toId);
  if (reordered === scoped) return { groups };
  let idx = 0;
  const next = groups.map(g => (
    g.project_id === from.project_id ? reordered[idx++] : g
  ));
  const res = await saveFlowGroups(next);
  return { groups: res.groups };
}

export async function createFlowGroup(name) {
  const clean = normalizeGroupName(name);
  const { groups } = await getFlowGroups();
  const pid = getActiveProjectId();
  const scoped = groups.filter((g) => g.project_id === pid);
  assertUniqueName(scoped, clean);
  const draft = { name: clean, project_id: pid };
  const res = await localRequest('/api/flow-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: [...groups, draft] }),
  });
  const created = res.groups[res.groups.length - 1];
  return { group: created, detail_key: 'success.flow_group_created' };
}

export async function renameFlowGroup(groupId, name) {
  const clean = normalizeGroupName(name);
  const { groups } = await getFlowGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) {
    const err = new Error('Flow group not found');
    err.detail_key = 'errors.flow_group_not_found';
    throw err;
  }
  const scoped = groups.filter(g => g.project_id === target.project_id);
  assertUniqueName(scoped, clean, groupId);
  const next = groups.map(g => g.id === groupId ? { ...g, name: clean } : g);
  const res = await localRequest('/api/flow-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = res.groups.find(g => g.id === groupId);
  return { group: updated, detail_key: 'success.flow_group_renamed' };
}

export async function setFlowGroupHidden(groupId, hidden) {
  const { groups } = await getFlowGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Flow group not found');
    err.detail_key = 'errors.flow_group_not_found';
    throw err;
  }
  const next = groups.map(g => g.id === groupId ? { ...g, hidden: !!hidden } : g);
  const res = await localRequest('/api/flow-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = res.groups.find(g => g.id === groupId);
  return { group: updated, detail_key: hidden ? 'success.flow_group_hidden' : 'success.flow_group_shown' };
}

export async function deleteFlowGroup(groupId) {
  const { groups } = await getFlowGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Flow group not found');
    err.detail_key = 'errors.flow_group_not_found';
    throw err;
  }
  // Antes de remover o grupo, limpa group_id dos fluxos que apontavam pra ele.
  // Sem isso, o flow ficaria com group_id "fantasma" — a UI cai pra "Sem grupo"
  // por validação, mas o JSON ficaria sujo e poderia ressuscitar se um grupo
  // novo fosse criado com o mesmo id (improvável dado UUID, mas o cleanup
  // mantém o store coerente). Falha no cleanup é fire-and-forget mas vai pro
  // console.warn pra ficar visível em dev.
  try {
    const data = await listFlows();
    const orphans = (data?.flows || []).filter((f) => f.group_id === groupId);
    const results = await Promise.allSettled(orphans.map((f) => patchFlow(f.id, { group_id: null })));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.warn('deleteFlowGroup: failed to clear group_id on flow', orphans[i]?.id, results[i].reason);
      }
    }
  } catch (err) {
    console.warn('deleteFlowGroup: orphan cleanup failed:', err);
  }

  const nextGroups = groups.filter(g => g.id !== groupId);
  await localRequest('/api/flow-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: nextGroups }),
  });
  return { detail_key: 'success.flow_group_deleted' };
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

export async function createPrompt({ name, body, isGlobal = false, groupId = null, pinned = false }) {
  const clean = normalizePrompt({ name, body });
  const { prompts } = await getPrompts();
  const draft = {
    ...clean,
    project_id: isGlobal ? null : getActiveProjectId(),
    group_id: typeof groupId === 'string' && groupId ? groupId : null,
    pinned: pinned === true,
  };
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
  // isGlobal flips project_id but keeps group_id intact — groups are global to
  // the library, not bound to any project.
  let projectId = existing.project_id ?? null;
  if ('isGlobal' in payload) {
    projectId = payload.isGlobal ? null : getActiveProjectId();
  }
  let groupId = existing.group_id ?? null;
  if ('groupId' in payload) {
    groupId = typeof payload.groupId === 'string' && payload.groupId ? payload.groupId : null;
  }
  let pinned = existing.pinned === true;
  if ('pinned' in payload) {
    pinned = payload.pinned === true;
  }
  const merged = {
    ...existing,
    ...('name' in payload ? { name: payload.name } : {}),
    ...('body' in payload ? { body: payload.body } : {}),
    project_id: projectId,
    group_id: groupId,
    pinned,
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

// ===== Prompt groups (global library categories — no project_id) =====

export async function getPromptGroups() {
  return localRequest('/api/prompt-groups');
}

export async function savePromptGroups(groups) {
  return localRequest('/api/prompt-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

function normalizePromptGroupName(name) {
  const stripped = String(name ?? '').trim();
  if (!stripped) {
    const err = new Error('Prompt group name is required');
    err.detail_key = 'errors.prompt_group_name_required';
    throw err;
  }
  if (stripped.length > NAME_MAX) {
    const err = new Error('Prompt group name too long');
    err.detail_key = 'errors.prompt_group_name_too_long';
    err.detail_params = { max: NAME_MAX };
    throw err;
  }
  return stripped;
}

function assertUniquePromptGroupName(groups, name, excludeId = null) {
  const lowered = name.toLowerCase();
  if (groups.some(g => g.id !== excludeId && g.name.toLowerCase() === lowered)) {
    const err = new Error('Prompt group name taken');
    err.detail_key = 'errors.prompt_group_name_taken';
    throw err;
  }
}

export async function createPromptGroup(name) {
  const clean = normalizePromptGroupName(name);
  const { groups } = await getPromptGroups();
  assertUniquePromptGroupName(groups, clean);
  const draft = { name: clean };
  const res = await savePromptGroups([...groups, draft]);
  const created = res.groups[res.groups.length - 1];
  return { group: created, detail_key: 'success.prompt_group_created' };
}

export async function renamePromptGroup(groupId, name) {
  const clean = normalizePromptGroupName(name);
  const { groups } = await getPromptGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) {
    const err = new Error('Prompt group not found');
    err.detail_key = 'errors.prompt_group_not_found';
    throw err;
  }
  assertUniquePromptGroupName(groups, clean, groupId);
  const now = new Date().toISOString();
  const next = groups.map(g => g.id === groupId ? { ...g, name: clean, updated_at: now } : g);
  const res = await savePromptGroups(next);
  const updated = res.groups.find(g => g.id === groupId);
  return { group: updated, detail_key: 'success.prompt_group_renamed' };
}

export async function deletePromptGroup(groupId) {
  const { groups } = await getPromptGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Prompt group not found');
    err.detail_key = 'errors.prompt_group_not_found';
    throw err;
  }
  // Clear `group_id` from any prompts pointing at the group BEFORE removing
  // the group itself. Same pattern as deleteFlowGroup: avoids a tiny window
  // where the group is gone but the prompt still carries an orphan id.
  try {
    const { prompts } = await getPrompts();
    const orphans = prompts.filter((p) => p.group_id === groupId);
    if (orphans.length > 0) {
      const nextPrompts = prompts.map((p) =>
        p.group_id === groupId ? { ...p, group_id: null } : p
      );
      await localRequest('/api/prompts', {
        method: 'PUT',
        body: JSON.stringify({ prompts: nextPrompts }),
      });
    }
  } catch (err) {
    console.warn('deletePromptGroup: orphan cleanup failed:', err);
  }

  const nextGroups = groups.filter(g => g.id !== groupId);
  await savePromptGroups(nextGroups);
  return { detail_key: 'success.prompt_group_deleted' };
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

// ===== Task Boards =====

export function listTaskBoards() {
  return localRequest('/api/task-boards');
}

export function createTaskBoard(payload) {
  const body = { ...(payload || {}), project_id: getActiveProjectId() };
  return localRequest('/api/task-boards', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchTaskBoard(id, actionPayload) {
  return localRequest(`/api/task-boards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(actionPayload),
  });
}

export function deleteTaskBoard(id) {
  return localRequest(`/api/task-boards/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ===== Task Board Groups =====

export async function getTaskBoardGroups() {
  return localRequest('/api/task-board-groups');
}

export async function saveTaskBoardGroups(groups) {
  return localRequest('/api/task-board-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

export async function reorderTaskBoardGroups(fromId, toId) {
  const { groups } = await getTaskBoardGroups();
  const from = groups.find(g => g.id === fromId);
  const to = groups.find(g => g.id === toId);
  if (!from || !to || from.project_id !== to.project_id) {
    const err = new Error('Task board group not found');
    err.detail_key = 'errors.task_board_group_not_found';
    throw err;
  }
  const scoped = groups.filter(g => g.project_id === from.project_id);
  const reordered = reorderById(scoped, fromId, toId);
  if (reordered === scoped) return { groups };
  let idx = 0;
  const next = groups.map(g => (
    g.project_id === from.project_id ? reordered[idx++] : g
  ));
  const res = await saveTaskBoardGroups(next);
  return { groups: res.groups };
}

export async function createTaskBoardGroup(name) {
  const clean = normalizeGroupName(name);
  const { groups } = await getTaskBoardGroups();
  const pid = getActiveProjectId();
  const scoped = groups.filter((g) => g.project_id === pid);
  assertUniqueName(scoped, clean);
  const draft = { name: clean, project_id: pid };
  const res = await localRequest('/api/task-board-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: [...groups, draft] }),
  });
  const created = res.groups[res.groups.length - 1];
  return { group: created, detail_key: 'success.task_board_group_created' };
}

export async function renameTaskBoardGroup(groupId, name) {
  const clean = normalizeGroupName(name);
  const { groups } = await getTaskBoardGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) {
    const err = new Error('Task board group not found');
    err.detail_key = 'errors.task_board_group_not_found';
    throw err;
  }
  const scoped = groups.filter(g => g.project_id === target.project_id);
  assertUniqueName(scoped, clean, groupId);
  const next = groups.map(g => g.id === groupId ? { ...g, name: clean } : g);
  const res = await localRequest('/api/task-board-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = res.groups.find(g => g.id === groupId);
  return { group: updated, detail_key: 'success.task_board_group_renamed' };
}

export async function setTaskBoardGroupHidden(groupId, hidden) {
  const { groups } = await getTaskBoardGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Task board group not found');
    err.detail_key = 'errors.task_board_group_not_found';
    throw err;
  }
  const next = groups.map(g => g.id === groupId ? { ...g, hidden: !!hidden } : g);
  const res = await localRequest('/api/task-board-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: next }),
  });
  const updated = res.groups.find(g => g.id === groupId);
  return { group: updated, detail_key: hidden ? 'success.task_board_group_hidden' : 'success.task_board_group_shown' };
}

export async function deleteTaskBoardGroup(groupId) {
  const { groups } = await getTaskBoardGroups();
  if (!groups.some(g => g.id === groupId)) {
    const err = new Error('Task board group not found');
    err.detail_key = 'errors.task_board_group_not_found';
    throw err;
  }
  // Detach orphan boards from the group before removing it. Same rationale
  // as deleteFlowGroup: keeps the JSON clean even if a future group reuses
  // the id (UUID makes it improbable, but the cleanup costs nothing).
  try {
    const data = await listTaskBoards();
    const orphans = (data?.boards || []).filter((b) => b.group_id === groupId);
    const results = await Promise.allSettled(orphans.map((b) =>
      patchTaskBoard(b.id, { action: 'move_board_group', group_id: null })
    ));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.warn('deleteTaskBoardGroup: failed to clear group_id on board', orphans[i]?.id, results[i].reason);
      }
    }
  } catch (err) {
    console.warn('deleteTaskBoardGroup: orphan cleanup failed:', err);
  }

  const nextGroups = groups.filter(g => g.id !== groupId);
  await localRequest('/api/task-board-groups', {
    method: 'PUT',
    body: JSON.stringify({ groups: nextGroups }),
  });
  return { detail_key: 'success.task_board_group_deleted' };
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
  propagateScopeName((s) => s.project_id === projectId, { projectName: clean });
  return { project: updated, detail_key: 'success.project_renamed', state: res };
}

export async function reorderProjects(fromId, toId) {
  const state = await getProjects();
  const nextProjects = reorderById(state.projects, fromId, toId);
  if (nextProjects === state.projects) return { state };
  const next = { ...state, projects: nextProjects };
  const res = await saveProjects(next);
  return { detail_key: 'success.project_reordered', state: res };
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
    + (stats?.notes || 0) + (stats?.flows || 0) + (stats?.prompts || 0)
    + (stats?.taskBoards || 0) + (stats?.tasks || 0);
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

export async function syncLocalToCloud() {
  return localRequest('/api/storage-sync/local-to-cloud', { method: 'POST' });
}

export async function syncCloudToLocal() {
  return localRequest('/api/storage-sync/cloud-to-local', { method: 'POST' });
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
