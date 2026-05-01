import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { findProjectBackend } from '@/lib/projectIndex';
import { readProjectFile } from '@/lib/projectStorage';
import {
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ATTACHMENT_MAX_PER_TASK,
  classifyAttachment,
} from '@/lib/taskBoardsConfig';
import {
  addAttachmentEntry,
  buildAttachmentEntry,
  publicAttachment,
  writeProjectBinary,
} from '@/lib/taskAttachments';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// POST /api/task-attachments?project_id=&board_id=&task_id=
//
// Multipart upload. The `task_id` query param is optional -- a fresh
// "new task" modal uploads attachments before the task is saved, so the
// index entry temporarily has task_id=null. The caller is expected to
// reissue the task with `attachments: [{ id, ... }]` so the api/task-boards
// PATCH stamps task_id onto the index entry.
export const POST = withAuth(async (req) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  const boardId = url.searchParams.get('board_id') || null;
  const taskId = url.searchParams.get('task_id') || null;

  if (!projectId) return bad('errors.invalid_body', 'project_id is required');

  // Project must exist on some backend manifest. Cheap check that doubles as
  // path-traversal defense -- a forged project_id never matches a manifest.
  const backendId = await findProjectBackend(projectId);
  if (!backendId) {
    return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
  }

  // When task_id is supplied, verify the (board, task) pair is real to keep
  // the index consistent. Skipped for new-task uploads (task_id null).
  if (taskId) {
    if (!boardId) return bad('errors.invalid_body', 'board_id is required when task_id is supplied');
    const data = await readProjectFile(projectId, 'task-boards.json', { boards: [] });
    const boards = Array.isArray(data?.boards) ? data.boards : [];
    const board = boards.find((b) => b?.id === boardId);
    if (!board) return bad('errors.task_board_not_found', 'Board not found', 404, { id: boardId });
    const task = (board.tasks || []).find((t) => t?.id === taskId);
    if (!task) return bad('errors.task_not_found', 'Task not found', 404, { id: taskId });
    const existing = Array.isArray(task.attachments) ? task.attachments.length : 0;
    if (existing >= TASK_ATTACHMENT_MAX_PER_TASK) {
      return bad('errors.task_attachment_limit', 'Too many attachments on this task', 400, { max: TASK_ATTACHMENT_MAX_PER_TASK });
    }
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return bad('errors.invalid_body', 'Invalid multipart body');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return bad('errors.invalid_body', 'file part is required');
  }

  const rawName = typeof file.name === 'string' ? file.name : '';
  if (!rawName.trim()) {
    return bad('errors.task_attachment_invalid_name', 'attachment name is empty');
  }

  const size = typeof file.size === 'number' ? file.size : 0;
  if (size <= 0) {
    return bad('errors.task_attachment_empty', 'attachment is empty');
  }
  if (size > TASK_ATTACHMENT_MAX_BYTES) {
    return bad('errors.task_attachment_too_large', 'attachment exceeds size limit', 400, {
      max_mb: Math.round(TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024)),
    });
  }

  const mime = typeof file.type === 'string' ? file.type : '';
  const kind = classifyAttachment({ mime, name: rawName });
  if (!kind) {
    return bad('errors.task_attachment_invalid_type', 'attachment type is not allowed', 400, { mime });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Index entry first so the binary path resolves to a known id. The id is
  // baked into the path so a path-traversal upload can't escape the project's
  // attachments tree (the id is a UUID minted server-side).
  const entry = buildAttachmentEntry({
    taskId,
    boardId,
    name: rawName,
    mime,
    size,
  });

  // The binary write happens BEFORE the index commit so a partial write
  // (storage failure mid-upload) leaves the index untouched -- the orphan
  // binary gets cleaned up on next project-delete.
  try {
    await writeProjectBinary(projectId, entry.object_path, buffer, { contentType: mime });
  } catch (err) {
    console.error('[task-attachments] binary write failed:', err);
    return bad('errors.storage.unavailable', `storage write failed: ${err?.message || err}`, 500);
  }

  await addAttachmentEntry(projectId, entry);

  return NextResponse.json({
    attachment: publicAttachment(entry, projectId),
  }, { status: 201 });
});
