import {
  PROMPT_GROUP_ALL,
  PROMPT_GROUP_PINNED,
  PROMPT_GROUP_UNGROUPED,
  PROMPT_SCOPE_VISIBLE,
  PROMPT_SCOPE_GLOBAL,
  PROMPT_SCOPE_PROJECT,
} from './promptConstants';

export function isPromptVisibleInProject(prompt, projectId) {
  if (!prompt) return false;
  if (!prompt.project_id) return true;
  return prompt.project_id === projectId;
}

export function filterPromptsByScope(prompts, projectId, scope) {
  if (!Array.isArray(prompts)) return [];
  if (scope === PROMPT_SCOPE_GLOBAL) {
    return prompts.filter((p) => !p.project_id);
  }
  if (scope === PROMPT_SCOPE_PROJECT) {
    return prompts.filter((p) => p.project_id === projectId);
  }
  // PROMPT_SCOPE_VISIBLE (default): global + this project.
  return prompts.filter((p) => isPromptVisibleInProject(p, projectId));
}

// A prompt's group is the stored group_id only if that id still exists in the
// active library. Stale ids (group deleted) collapse to null so the UI never
// shows a prompt under a phantom group.
export function effectivePromptGroupId(prompt, validGroupIds) {
  if (!prompt) return null;
  if (!prompt.project_id) return null;
  const gid = prompt.group_id;
  if (gid && validGroupIds && validGroupIds.has(gid)) return gid;
  return null;
}

export function filterPromptsByGroupToken(prompts, groupToken, validGroupIds) {
  if (!Array.isArray(prompts)) return [];
  if (!groupToken || groupToken === PROMPT_GROUP_ALL) return prompts;
  if (groupToken === PROMPT_GROUP_PINNED) {
    return prompts.filter((p) => p.pinned === true);
  }
  if (groupToken === PROMPT_GROUP_UNGROUPED) {
    return prompts.filter((p) => effectivePromptGroupId(p, validGroupIds) === null);
  }
  return prompts.filter((p) => effectivePromptGroupId(p, validGroupIds) === groupToken);
}

export function searchPrompts(prompts, query) {
  if (!Array.isArray(prompts)) return [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return prompts;
  return prompts.filter((p) => {
    const name = String(p.name ?? '').toLowerCase();
    if (name.includes(q)) return true;
    const body = String(p.body ?? '').toLowerCase();
    return body.includes(q);
  });
}

export function sortPrompts(prompts) {
  if (!Array.isArray(prompts)) return [];
  const copy = [...prompts];
  copy.sort((a, b) => {
    const ap = a.pinned === true ? 1 : 0;
    const bp = b.pinned === true ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const at = a.updated_at || '';
    const bt = b.updated_at || '';
    if (at !== bt) return at < bt ? 1 : -1;
    const an = String(a.name ?? '').toLowerCase();
    const bn = String(b.name ?? '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return 0;
  });
  return copy;
}

export function getPromptGroupName(groupId, groups, t) {
  if (!groupId) return t ? t('prompts.noGroup') : '';
  const found = Array.isArray(groups) ? groups.find((g) => g.id === groupId) : null;
  return found ? found.name : (t ? t('prompts.noGroup') : '');
}
