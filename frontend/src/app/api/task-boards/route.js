import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
  validateGroupBelongsToProject,
} from '@/lib/projectStorage';
import {
  BOARD_NAME_MAX,
  DEFAULT_COLUMNS,
} from '@/lib/taskBoardsConfig';
import { normalizeBoards } from '@/lib/taskBoardsStore';
import { hydrateBoardsAttachments } from '@/lib/taskAttachments';

const FILE = 'task-boards.json';
const EMPTY = { boards: [] };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function getProjectId(req) {
  const url = new URL(req.url);
  return url.searchParams.get('project_id');
}

// Read + normalize the per-project boards file. Boards stored on disk may have
// stale task ids in columns, missing arrays, etc — `normalizeBoards` cleans the
// shape on every read so action handlers and clients can rely on it. Also
// force-stamps `project_id` on every board so legacy values (e.g. `proj-default`
// from before the v3→v4 migration) don't leak through GET responses; the file
// itself is per-project on disk so the URL projectId is the source of truth.
async function readNormalizedBoards(projectId) {
  const data = await readProjectFile(projectId, FILE, EMPTY);
  const { normalized } = normalizeBoards(data?.boards);
  return normalized.map((b) => ({ ...b, project_id: projectId }));
}

export const GET = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  try {
    const boards = await readNormalizedBoards(projectId);
    // Hydrate attachments through the canonical task-attachments.json index
    // so the response always carries authoritative name/mime/size/kind/url
    // even when a task on disk only stored {id} (e.g., right after a
    // create_task PATCH that didn't echo full metadata back).
    const hydrated = await hydrateBoardsAttachments(projectId, boards);
    return NextResponse.json({ boards: hydrated });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    throw err;
  }
});

export const POST = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return bad('errors.invalid_body', 'Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object') {
    return bad('errors.invalid_body', 'Expected object body', 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return bad('errors.task_board_name_required', 'Board name is required', 400);
  }
  if (name.length > BOARD_NAME_MAX) {
    return bad(
      'errors.task_board_name_too_long',
      `Board name must be at most ${BOARD_NAME_MAX} characters`,
      400,
      { max: BOARD_NAME_MAX },
    );
  }

  const groupId = (typeof body.group_id === 'string' && body.group_id) ? body.group_id : null;

  // Reject group_ids that belong to a different project. Catches the
  // frontend race where the user switches projects with a modal half-open
  // and the dropdown still lists groups from the previous project.
  const groupErr = await validateGroupBelongsToProject(projectId, 'task-board-groups.json', groupId);
  if (groupErr) return bad(groupErr.detailKey, groupErr.detail, 400, groupErr.params);

  try {
    const board = await withProjectLock(projectId, FILE, async () => {
      const data = await readProjectFile(projectId, FILE, EMPTY);
      const boards = Array.isArray(data?.boards) ? [...data.boards] : [];
      const now = new Date().toISOString();
      const created = {
        id: `tboard-${randomUUID()}`,
        name,
        project_id: projectId,
        group_id: groupId,
        columns: DEFAULT_COLUMNS.map((title) => ({
          id: `tcol-${randomUUID()}`,
          title,
          task_ids: [],
          created_at: now,
          updated_at: now,
        })),
        tasks: [],
        created_at: now,
        updated_at: now,
      };
      boards.push(created);
      await writeProjectFile(projectId, FILE, { boards });
      return created;
    });
    return NextResponse.json(board, { status: 201 });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    throw err;
  }
});

// PUT replace-array intentionally NOT exposed: there are no callers (verified
// via grep), and the action-based PATCH at /api/task-boards/[id] is the only
// supported way to mutate boards atomically. Reorder is a "move_board_group"
// PATCH action, not a PUT replace.
