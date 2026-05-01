import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  cleanupOrphanUploads,
  resolveInFlightUpload,
  cancelInFlightUploads,
  splitUploadCandidatesByAvailableSlots,
  consumeSessionUploadId,
} from '../taskAttachmentsCleanup.js';

describe('cleanupOrphanUploads', () => {
  it('deletes every id when the modal closes without submitting (cancel path)', async () => {
    const deleteFn = vi.fn(async () => undefined);
    const result = await cleanupOrphanUploads({
      submitted: false,
      ids: ['att-1', 'att-2', 'att-3'],
      deleteFn,
    });
    expect(deleteFn).toHaveBeenCalledTimes(3);
    expect(deleteFn.mock.calls.map((c) => c[0])).toEqual(['att-1', 'att-2', 'att-3']);
    expect(result).toEqual({ deleted: 3, skipped: 0 });
  });

  it('skips deletion when the modal already submitted', async () => {
    const deleteFn = vi.fn(async () => undefined);
    const result = await cleanupOrphanUploads({
      submitted: true,
      ids: ['att-just-saved'],
      deleteFn,
    });
    expect(deleteFn).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, skipped: 1 });
  });

  it('swallows deletion errors and continues with the next id (best-effort)', async () => {
    const deleteFn = vi.fn(async (id) => {
      if (id === 'att-bad') throw new Error('network');
    });
    const result = await cleanupOrphanUploads({
      submitted: false,
      ids: ['att-1', 'att-bad', 'att-3'],
      deleteFn,
    });
    expect(deleteFn).toHaveBeenCalledTimes(3);
    expect(result.deleted).toBe(2);
  });

  it('handles an empty id list as a no-op', async () => {
    const deleteFn = vi.fn();
    const result = await cleanupOrphanUploads({ submitted: false, ids: [], deleteFn });
    expect(deleteFn).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, skipped: 0 });
  });

  it('after a failed save (submitted stays false), all session ids are cleaned on cancel', async () => {
    // Models the failed-save flow: the editor uploaded att-1 + att-2, the
    // user clicks Save, the parent's PATCH 500s, the modal stays open with
    // submittedRef === false, then the user clicks Cancel. cleanup must
    // delete both session ids.
    const deleteFn = vi.fn(async () => undefined);
    const submittedRef = { current: false };
    // Simulate handleSubmit: only flips on success -- the parent rejected,
    // so it stays false.
    try {
      await Promise.reject(new Error('PATCH 500'));
      submittedRef.current = true;
    } catch { /* parent toasted */ }
    expect(submittedRef.current).toBe(false);

    await cleanupOrphanUploads({
      submitted: submittedRef.current,
      ids: ['att-1', 'att-2'],
      deleteFn,
    });
    expect(deleteFn).toHaveBeenCalledTimes(2);
  });
});

describe('resolveInFlightUpload', () => {
  it('returns "committed" and does NOT call delete when tempId was not cancelled', async () => {
    const deleteFn = vi.fn();
    const out = await resolveInFlightUpload({
      tempId: 'tmp-1',
      uploadedId: 'att-fresh',
      cancelledIds: new Set(),
      deleteFn,
    });
    expect(out).toBe('committed');
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('returns "cancelled" and deletes the just-committed attachment when the row was removed mid-upload', async () => {
    // Models the race: user removes the row -> handleRemoveAttachment puts
    // tempId in cancelledIds + aborts. The abort lost the race, the POST
    // already returned 201. resolveInFlightUpload tears down the orphan.
    const deleteFn = vi.fn(async () => undefined);
    const cancelledIds = new Set(['tmp-late']);
    const out = await resolveInFlightUpload({
      tempId: 'tmp-late',
      uploadedId: 'att-orphan',
      cancelledIds,
      deleteFn,
    });
    expect(out).toBe('cancelled');
    expect(deleteFn).toHaveBeenCalledWith('att-orphan');
    // tempId is consumed -- a second resolve for the same id is a committed no-op.
    expect(cancelledIds.has('tmp-late')).toBe(false);
  });

  it('swallows delete errors on cancellation (best-effort)', async () => {
    const deleteFn = vi.fn(async () => { throw new Error('network'); });
    const cancelledIds = new Set(['tmp-x']);
    const out = await resolveInFlightUpload({
      tempId: 'tmp-x',
      uploadedId: 'att-x',
      cancelledIds,
      deleteFn,
    });
    expect(out).toBe('cancelled');
    expect(cancelledIds.has('tmp-x')).toBe(false);
  });
});

describe('cancelInFlightUploads', () => {
  it('marks temp ids as cancelled before aborting active controllers', () => {
    const cancelledIds = new Set();
    const ctrlA = { abort: vi.fn() };
    const ctrlB = { abort: vi.fn() };
    const controllers = new Map([
      ['tmp-a', ctrlA],
      ['tmp-b', ctrlB],
    ]);

    const ids = cancelInFlightUploads({ controllers, cancelledIds });

    expect(ids).toEqual(['tmp-a', 'tmp-b']);
    expect(cancelledIds.has('tmp-a')).toBe(true);
    expect(cancelledIds.has('tmp-b')).toBe(true);
    expect(ctrlA.abort).toHaveBeenCalledTimes(1);
    expect(ctrlB.abort).toHaveBeenCalledTimes(1);
    expect(controllers.size).toBe(0);
  });

  it('lets a late 201 after close resolve as cancelled and delete the orphan', async () => {
    const cancelledIds = new Set();
    const controllers = new Map([['tmp-close', { abort: vi.fn() }]]);
    const deleteFn = vi.fn(async () => undefined);

    cancelInFlightUploads({ controllers, cancelledIds });
    const out = await resolveInFlightUpload({
      tempId: 'tmp-close',
      uploadedId: 'att-late',
      cancelledIds,
      deleteFn,
    });

    expect(out).toBe('cancelled');
    expect(deleteFn).toHaveBeenCalledWith('att-late');
  });
});

describe('splitUploadCandidatesByAvailableSlots', () => {
  it('keeps only valid candidates that fit in the remaining attachment slots', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({ name: `f-${i}.png` }));
    const result = splitUploadCandidatesByAvailableSlots(candidates, 18, 20);

    expect(result.accepted.map((c) => c.name)).toEqual(['f-0.png', 'f-1.png']);
    expect(result.rejectedCount).toBe(3);
  });

  it('rejects every candidate when the task is already at the limit', () => {
    const result = splitUploadCandidatesByAvailableSlots([{ name: 'extra.png' }], 20, 20);

    expect(result.accepted).toEqual([]);
    expect(result.rejectedCount).toBe(1);
  });
});

describe('consumeSessionUploadId', () => {
  it('removes a session upload id and reports that it was consumed', () => {
    const result = consumeSessionUploadId(['att-old', 'att-new', 'att-other'], 'att-new');

    expect(result).toEqual({
      nextIds: ['att-old', 'att-other'],
      consumed: true,
    });
  });

  it('leaves saved-task attachments alone when the id was not uploaded in this modal session', () => {
    const result = consumeSessionUploadId(['att-new'], 'att-existing');

    expect(result).toEqual({
      nextIds: ['att-new'],
      consumed: false,
    });
  });
});

// hydrateBoardsAttachments needs a real storage backend so it can read the
// task-attachments.json index. Reuse the file driver via PULSE_FRONTEND_ROOT
// so the test runs without mocking the storage layer.
describe('hydrateBoardsAttachments', () => {
  let tmpDir;
  let storage;
  let taskAttachments;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-hydrate-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();
    storage = await import('../storage.js');
    taskAttachments = await import('../taskAttachments.js');
    await storage.resetForTests();

    // Seed v2 storage-config + manifest so resolveProjectStorage finds the project.
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 3,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    }));
    await storage.writeStoreToBackend('local', 'data/projects-manifest.json', {
      v: 1,
      projects: [{ id: 'p1', name: 'P1' }],
    });
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PULSE_FRONTEND_ROOT;
  });

  it('replaces stub {id} attachments with full public objects from the index', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/task-attachments.json', {
      attachments: [
        {
          id: 'att-1',
          task_id: 't-1',
          board_id: 'b-1',
          object_path: 'attachments/att-1/photo.png',
          name: 'photo.png',
          mime: 'image/png',
          size: 1234,
          kind: 'image',
          created_at: '2026-04-30T10:00:00Z',
        },
      ],
    });
    const boards = [{
      id: 'b-1',
      tasks: [{ id: 't-1', attachments: [{ id: 'att-1' }] }],
    }];
    const out = await taskAttachments.hydrateBoardsAttachments('p1', boards);
    const att = out[0].tasks[0].attachments[0];
    expect(att).toMatchObject({
      id: 'att-1',
      name: 'photo.png',
      mime: 'image/png',
      size: 1234,
      kind: 'image',
      created_at: '2026-04-30T10:00:00Z',
    });
    expect(att.url).toContain('/api/task-attachments/att-1/content');
    expect(att.url).toContain('project_id=p1');
  });

  it('falls back to task-side metadata when the index has no matching id', async () => {
    // Empty index on disk.
    await storage.writeStoreToBackend('local', 'data/projects/p1/task-attachments.json', {
      attachments: [],
    });
    const boards = [{
      id: 'b-1',
      tasks: [{
        id: 't-1',
        attachments: [{
          id: 'att-orphan',
          name: 'remembered.png',
          mime: 'image/png',
          size: 99,
          kind: 'image',
          created_at: '2026-04-30',
        }],
      }],
    }];
    const out = await taskAttachments.hydrateBoardsAttachments('p1', boards);
    const att = out[0].tasks[0].attachments[0];
    expect(att.name).toBe('remembered.png');
    // URL still points at the content route -- it'll 404 cleanly when the
    // route can't find the binary.
    expect(att.url).toContain('/api/task-attachments/att-orphan/content');
  });

  it('passes through tasks that have no attachments', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/task-attachments.json', { attachments: [] });
    const boards = [{
      id: 'b-1',
      tasks: [{ id: 't-1', title: 'No files', attachments: [] }],
    }];
    const out = await taskAttachments.hydrateBoardsAttachments('p1', boards);
    expect(out[0].tasks[0].attachments).toEqual([]);
  });

  it('returns the input unchanged when boards is empty (no index read)', async () => {
    const out = await taskAttachments.hydrateBoardsAttachments('p1', []);
    expect(out).toEqual([]);
  });
});
