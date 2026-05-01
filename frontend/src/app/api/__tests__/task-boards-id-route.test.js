import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// /api/task-boards/[id] PATCH for attachment lifecycle. The route mirrors a
// real lock + write cycle on a tiny in-memory boards store -- enough to
// assert the side-effects (stamp / cleanup) fire after the file write.

function makeStore(initialBoards) {
  let boards = JSON.parse(JSON.stringify(initialBoards));
  return {
    read: async () => ({ boards: JSON.parse(JSON.stringify(boards)) }),
    write: async (data) => { boards = JSON.parse(JSON.stringify(data.boards)); },
    snapshot: () => boards,
  };
}

describe('PATCH /api/task-boards/[id] -- attachments', () => {
  let route;
  let attachments;
  let store;

  beforeEach(async () => {
    vi.resetModules();
    store = makeStore([{
      id: 'b-1',
      project_id: 'p-1',
      name: 'Sprint',
      columns: [
        { id: 'c-1', title: 'Todo', task_ids: ['t-1'], created_at: 'x', updated_at: 'x' },
      ],
      tasks: [{
        id: 't-1',
        title: 'Existing',
        description: '',
        start_date: null,
        end_date: null,
        assignee: '',
        attachments: [
          {
            id: 'att-old',
            name: 'old.png',
            mime: 'image/png',
            size: 100,
            kind: 'image',
            url: '/api/task-attachments/att-old/content?project_id=p-1',
            created_at: '2026-04-29',
          },
        ],
        created_at: 'x',
        updated_at: 'x',
      }],
      created_at: 'x',
      updated_at: 'x',
    }]);

    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => store.read()),
      writeProjectFile: vi.fn(async (pid, file, data) => store.write(data)),
      withProjectLock: vi.fn(async (_pid, _file, fn) => fn()),
      validateGroupBelongsToProject: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/taskAttachments', () => ({
      normalizePublicAttachments: (raw) => Array.isArray(raw)
        ? raw
            .filter((a) => a && typeof a.id === 'string')
            .map((a) => ({
              id: a.id,
              name: a.name || '',
              mime: a.mime || '',
              size: a.size || 0,
              kind: a.kind === 'image' ? 'image' : 'document',
              url: a.url || '',
              created_at: a.created_at || '2026-04-30',
            }))
        : [],
      stampAttachmentsForTask: vi.fn(async () => undefined),
      deleteAttachmentCompletely: vi.fn(async () => undefined),
      // The PATCH route hydrates the response through the canonical project
      // index. The store-level tests don't exercise the hydration logic
      // (covered separately in taskAttachments.test.js), so the mock just
      // passes the boards through.
      hydrateBoardsAttachments: vi.fn(async (_pid, boards) => boards),
    }));
    attachments = await import('@/lib/taskAttachments');
    route = await import('@/app/api/task-boards/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('create_task with attachments stamps them and returns the task', async () => {
    const req = new Request('http://localhost/api/task-boards/b-1?project_id=p-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_task',
        column_id: 'c-1',
        task: {
          title: 'New',
          attachments: [
            { id: 'att-new-1', name: 'a.png', mime: 'image/png', size: 5, kind: 'image' },
            { id: 'att-new-2', name: 'b.pdf', mime: 'application/pdf', size: 6, kind: 'document' },
          ],
        },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const created = body.tasks.find((t) => t.title === 'New');
    expect(created.attachments).toHaveLength(2);
    expect(attachments.stampAttachmentsForTask).toHaveBeenCalledWith(
      'p-1',
      ['att-new-1', 'att-new-2'],
      created.id,
      'b-1',
    );
    expect(attachments.deleteAttachmentCompletely).not.toHaveBeenCalled();
  });

  it('update_task removing one attachment triggers a delete side-effect', async () => {
    const req = new Request('http://localhost/api/task-boards/b-1?project_id=p-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_task',
        task_id: 't-1',
        task: {
          title: 'Existing',
          attachments: [], // remove the lone existing attachment
        },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const updated = body.tasks.find((t) => t.id === 't-1');
    expect(updated.attachments).toHaveLength(0);
    expect(attachments.deleteAttachmentCompletely).toHaveBeenCalledWith('p-1', 'att-old');
  });

  it('update_task without attachments key keeps existing ones (no diff side-effect)', async () => {
    const req = new Request('http://localhost/api/task-boards/b-1?project_id=p-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_task',
        task_id: 't-1',
        task: { title: 'Renamed' },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const updated = body.tasks.find((t) => t.id === 't-1');
    expect(updated.title).toBe('Renamed');
    expect(updated.attachments).toHaveLength(1);
    expect(attachments.deleteAttachmentCompletely).not.toHaveBeenCalled();
    expect(attachments.stampAttachmentsForTask).not.toHaveBeenCalled();
  });

  it('delete_task tears down all attachments belonging to that task', async () => {
    const req = new Request('http://localhost/api/task-boards/b-1?project_id=p-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_task', task_id: 't-1' }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(0);
    expect(attachments.deleteAttachmentCompletely).toHaveBeenCalledWith('p-1', 'att-old');
  });

  it('rejects more than 20 attachments in a single task', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      id: `att-${i}`, name: `f-${i}.png`, mime: 'image/png', size: 1, kind: 'image',
    }));
    const req = new Request('http://localhost/api/task-boards/b-1?project_id=p-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_task',
        column_id: 'c-1',
        task: { title: 'Too many', attachments: tooMany },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.task_attachment_limit');
  });
});

describe('DELETE /api/task-boards/[id] -- attachments cleanup', () => {
  let route;
  let attachments;
  let store;

  beforeEach(async () => {
    vi.resetModules();
    store = makeStore([{
      id: 'b-with-att',
      project_id: 'p-1',
      name: 'Board to delete',
      columns: [{ id: 'c-1', title: 'Todo', task_ids: ['t-1', 't-2'], created_at: 'x', updated_at: 'x' }],
      tasks: [
        {
          id: 't-1',
          title: 'Task 1',
          description: '',
          start_date: null,
          end_date: null,
          assignee: '',
          attachments: [
            { id: 'att-a', name: 'a.png', mime: 'image/png', size: 1, kind: 'image', url: '', created_at: '' },
            { id: 'att-b', name: 'b.pdf', mime: 'application/pdf', size: 1, kind: 'document', url: '', created_at: '' },
          ],
          created_at: 'x',
          updated_at: 'x',
        },
        {
          id: 't-2',
          title: 'Task 2',
          description: '',
          start_date: null,
          end_date: null,
          assignee: '',
          attachments: [
            { id: 'att-c', name: 'c.png', mime: 'image/png', size: 1, kind: 'image', url: '', created_at: '' },
          ],
          created_at: 'x',
          updated_at: 'x',
        },
      ],
      created_at: 'x',
      updated_at: 'x',
    }]);

    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => store.read()),
      writeProjectFile: vi.fn(async (pid, file, data) => store.write(data)),
      withProjectLock: vi.fn(async (_pid, _file, fn) => fn()),
      validateGroupBelongsToProject: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/taskAttachments', () => ({
      normalizePublicAttachments: (raw) => Array.isArray(raw) ? raw : [],
      stampAttachmentsForTask: vi.fn(async () => undefined),
      deleteAttachmentCompletely: vi.fn(async () => ({ id: 'fake' })),
      hydrateBoardsAttachments: vi.fn(async (_pid, boards) => boards),
    }));
    attachments = await import('@/lib/taskAttachments');
    route = await import('@/app/api/task-boards/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('tears down every attachment of every task on the deleted board', async () => {
    const req = new Request('http://localhost/api/task-boards/b-with-att?project_id=p-1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'b-with-att' }) });
    expect(res.status).toBe(200);
    expect(attachments.deleteAttachmentCompletely).toHaveBeenCalledTimes(3);
    const calledIds = attachments.deleteAttachmentCompletely.mock.calls.map((c) => c[1]).sort();
    expect(calledIds).toEqual(['att-a', 'att-b', 'att-c']);
    // Board must be gone from the store.
    expect(store.snapshot()).toHaveLength(0);
  });

  it('still succeeds when a single attachment cleanup throws (best-effort)', async () => {
    attachments.deleteAttachmentCompletely.mockImplementationOnce(async () => { throw new Error('boom'); });
    const req = new Request('http://localhost/api/task-boards/b-with-att?project_id=p-1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'b-with-att' }) });
    expect(res.status).toBe(200);
    expect(attachments.deleteAttachmentCompletely).toHaveBeenCalledTimes(3);
    expect(store.snapshot()).toHaveLength(0);
  });

  it('returns 404 when the board id is unknown', async () => {
    const req = new Request('http://localhost/api/task-boards/b-missing?project_id=p-1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'b-missing' }) });
    expect(res.status).toBe(404);
    expect(attachments.deleteAttachmentCompletely).not.toHaveBeenCalled();
  });
});

describe('taskBoardsStore normalizes legacy tasks without attachments', () => {
  it('hydrates a task that has no attachments field as []', async () => {
    const { normalizeBoards } = await import('@/lib/taskBoardsStore');
    const { normalized } = normalizeBoards([{
      id: 'b',
      tasks: [{ id: 't', title: 'Old' }],
      columns: [{ id: 'c', title: 'Todo', task_ids: ['t'] }],
    }]);
    expect(normalized[0].tasks[0].attachments).toEqual([]);
  });
});
