export const DEFAULT_PROJECT_ID = 'proj-default';
export const DEFAULT_PROJECT_NAME = 'Default';

export function ensureProjectId(item, fallback = DEFAULT_PROJECT_ID) {
  if (item && typeof item === 'object' && (!item.project_id || typeof item.project_id !== 'string')) {
    return { ...item, project_id: fallback };
  }
  return item;
}

export function migrateList(list, fallback = DEFAULT_PROJECT_ID) {
  let changed = false;
  const migrated = list.map((item) => {
    if (item && typeof item === 'object' && !item.project_id) {
      changed = true;
      return { ...item, project_id: fallback };
    }
    return item;
  });
  return { list: migrated, changed };
}

export function filterByProject(items, projectId) {
  if (!projectId) return items;
  return items.filter((it) => it && it.project_id === projectId);
}
