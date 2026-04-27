import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { writeStore, withStoreLock } from '@/lib/storage';
import { withAuth } from '@/lib/auth';
import {
  BOARD_NAME_MAX,
  DEFAULT_COLUMNS,
} from '@/lib/taskBoardsConfig';
import {
  TASK_BOARDS_REL,
  readAndMigrateBoards,
  readNormalizedInsideLock,
} from '@/lib/taskBoardsStore';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';

function bad(detailKey, detail, status = 400, detailParams) {
  return NextResponse.json(
    { detail, detail_key: detailKey, detail_params: detailParams },
    { status }
  );
}

export const GET = withAuth(async () => {
  const data = await readAndMigrateBoards();
  return NextResponse.json(data);
});

export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch {
    return bad('errors.invalid_body', 'Invalid JSON');
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return bad('errors.task_board_name_required', 'Board name is required');
  if (name.length > BOARD_NAME_MAX) {
    return bad(
      'errors.task_board_name_too_long',
      `Board name must be at most ${BOARD_NAME_MAX} characters`,
      400,
      { max: BOARD_NAME_MAX }
    );
  }

  const projectId = (typeof body?.project_id === 'string' && body.project_id) ? body.project_id : DEFAULT_PROJECT_ID;
  const groupId = (typeof body?.group_id === 'string' && body.group_id) ? body.group_id : null;

  const board = await withStoreLock(TASK_BOARDS_REL, async () => {
    const now = new Date().toISOString();
    const data = await readNormalizedInsideLock();
    const boards = [...data.boards];
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
    await writeStore(TASK_BOARDS_REL, { boards, updated_at: now });
    return created;
  });

  return NextResponse.json(board, { status: 201 });
});
