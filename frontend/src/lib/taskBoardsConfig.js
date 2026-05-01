export const BOARD_NAME_MAX = 50;
export const COLUMN_TITLE_MAX = 50;
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 50000;
export const TASK_ASSIGNEE_MAX = 80;

export const DEFAULT_COLUMNS = ['Todo', 'Doing', 'Done'];

// Attachments. 20 MB / 20 anexos / allowlist of MIME + extension pairs. Kept
// in the same module as the rest of the task-boards limits so the frontend
// (TaskEditorModal) and backend (api/task-attachments + api/task-boards) stay
// in lock-step on what counts as valid.
export const TASK_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const TASK_ATTACHMENT_MAX_PER_TASK = 20;

// MIME types we accept directly. The MIME alone is enough -- a server-side
// signature check would be safer, but we already gate the upload route with
// withAuth and never execute the bytes (download-only proxy), so extension/
// MIME validation is the practical floor.
export const TASK_ATTACHMENT_IMAGE_MIMES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

export const TASK_ATTACHMENT_DOCUMENT_MIMES = Object.freeze([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

// File extensions that act as a fallback when the browser hands us a generic
// `application/octet-stream`. Office uploads from older browsers / mobile do
// this routinely. Lowercased, leading dot included for direct .endsWith checks.
export const TASK_ATTACHMENT_DOCUMENT_EXTENSIONS = Object.freeze([
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.ppt', '.pptx',
]);

export const TASK_ATTACHMENT_IMAGE_EXTENSIONS = Object.freeze([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
]);

// Convenience tuple: classifies a file as image | document | null. Returns
// null when neither MIME nor extension is on the allowlist -- the caller
// must reject such uploads.
export function classifyAttachment({ mime, name }) {
  const m = (mime || '').toLowerCase();
  const ext = (() => {
    const idx = (name || '').lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
  })();
  if (TASK_ATTACHMENT_IMAGE_MIMES.includes(m)) return 'image';
  if (TASK_ATTACHMENT_DOCUMENT_MIMES.includes(m)) return 'document';
  if (TASK_ATTACHMENT_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (TASK_ATTACHMENT_DOCUMENT_EXTENSIONS.includes(ext)) return 'document';
  return null;
}
