// Virtual group tokens used by the library and quick-selector to represent
// "filters that aren't real groups". Real group ids start with "pgid-".
export const PROMPT_GROUP_ALL = '__all__';
export const PROMPT_GROUP_PINNED = '__pinned__';
export const PROMPT_GROUP_UNGROUPED = '__ungrouped__';

// Scope filters drive which prompts are visible before any group filter runs.
export const PROMPT_SCOPE_VISIBLE = 'visible';
export const PROMPT_SCOPE_GLOBAL = 'global';
export const PROMPT_SCOPE_PROJECT = 'project';

export const VALID_PROMPT_SCOPES = Object.freeze([
  PROMPT_SCOPE_VISIBLE,
  PROMPT_SCOPE_GLOBAL,
  PROMPT_SCOPE_PROJECT,
]);
