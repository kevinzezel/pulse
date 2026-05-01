import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Helpers ---------------------------------------------------------------

function buildFormData(name, mime, bytes) {
  const fd = new FormData();
  const blob = new Blob([bytes], { type: mime });
  // FormData accepts a Blob with a filename via the third argument.
  fd.append('file', blob, name);
  return fd;
}

function bytesOfSize(n) {
  // Use a typed array so the mocked storage actually receives non-zero bytes.
  return Buffer.alloc(n, 0x42);
}

// POST /api/task-attachments --------------------------------------------

describe('POST /api/task-attachments', () => {
  let route;
  let attachments;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    vi.doMock('@/lib/projectIndex', () => ({
      findProjectBackend: vi.fn(async (pid) => (pid === 'p-real' ? 'local' : null)),
    }));
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({
        boards: [{
          id: 'b-1',
          project_id: 'p-real',
          tasks: [{ id: 't-1', title: 'X', attachments: [] }],
        }],
      })),
    }));
    vi.doMock('@/lib/taskAttachments', () => ({
      addAttachmentEntry: vi.fn(async (pid, entry) => entry),
      buildAttachmentEntry: vi.fn(({ taskId, boardId, name, mime, size }) => ({
        id: 'att-fixed',
        task_id: taskId || null,
        board_id: boardId || null,
        object_path: `attachments/att-fixed/${name}`,
        name,
        mime,
        size,
        kind: mime.startsWith('image/') ? 'image' : 'document',
        created_at: '2026-04-30T00:00:00Z',
      })),
      publicAttachment: (entry, projectId) => ({
        id: entry.id,
        name: entry.name,
        mime: entry.mime,
        size: entry.size,
        kind: entry.kind,
        url: `/api/task-attachments/${entry.id}/content?project_id=${projectId}`,
        created_at: entry.created_at,
      }),
      writeProjectBinary: vi.fn(async () => undefined),
    }));
    attachments = await import('@/lib/taskAttachments');
    route = await import('@/app/api/task-attachments/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('400 without project_id', async () => {
    const req = new Request('http://localhost/api/task-attachments', {
      method: 'POST',
      body: buildFormData('foo.png', 'image/png', bytesOfSize(64)),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });

  it('404 when project_id is unknown', async () => {
    const req = new Request('http://localhost/api/task-attachments?project_id=p-missing', {
      method: 'POST',
      body: buildFormData('foo.png', 'image/png', bytesOfSize(64)),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.project_not_found');
  });

  it('uploads a valid PNG and returns metadata', async () => {
    const req = new Request('http://localhost/api/task-attachments?project_id=p-real', {
      method: 'POST',
      body: buildFormData('shot.png', 'image/png', bytesOfSize(1024)),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachment.id).toBe('att-fixed');
    expect(body.attachment.kind).toBe('image');
    expect(body.attachment.url).toContain('p-real');
    expect(attachments.writeProjectBinary).toHaveBeenCalledWith(
      'p-real',
      'attachments/att-fixed/shot.png',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/png' }),
    );
    expect(attachments.addAttachmentEntry).toHaveBeenCalled();
  });

  it('uploads a PDF as document kind', async () => {
    const req = new Request('http://localhost/api/task-attachments?project_id=p-real', {
      method: 'POST',
      body: buildFormData('spec.pdf', 'application/pdf', bytesOfSize(2048)),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachment.kind).toBe('document');
    expect(body.attachment.mime).toBe('application/pdf');
  });

  it('uploads an Office .docx as document kind', async () => {
    const req = new Request('http://localhost/api/task-attachments?project_id=p-real', {
      method: 'POST',
      body: buildFormData(
        'plan.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytesOfSize(4096),
      ),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachment.kind).toBe('document');
  });

  it('rejects invalid type with 400', async () => {
    const req = new Request('http://localhost/api/task-attachments?project_id=p-real', {
      method: 'POST',
      body: buildFormData('script.js', 'application/javascript', bytesOfSize(64)),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.task_attachment_invalid_type');
    expect(attachments.writeProjectBinary).not.toHaveBeenCalled();
  });

  it('rejects file above 20 MB', async () => {
    // 21 MB worth of bytes
    const tooBig = bytesOfSize(21 * 1024 * 1024);
    const req = new Request('http://localhost/api/task-attachments?project_id=p-real', {
      method: 'POST',
      body: buildFormData('huge.png', 'image/png', tooBig),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.task_attachment_too_large');
    expect(attachments.writeProjectBinary).not.toHaveBeenCalled();
  });

  it('rejects when task_id is supplied but board has no such task', async () => {
    const req = new Request(
      'http://localhost/api/task-attachments?project_id=p-real&board_id=b-1&task_id=t-missing',
      { method: 'POST', body: buildFormData('foo.png', 'image/png', bytesOfSize(64)) },
    );
    const res = await route.POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.task_not_found');
  });
});

// GET /api/task-attachments/[id]/content -------------------------------

describe('GET /api/task-attachments/[id]/content', () => {
  let route;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    vi.doMock('@/lib/projectIndex', () => ({
      findProjectBackend: vi.fn(async (pid) => (pid === 'p-real' ? 'local' : null)),
    }));
    vi.doMock('@/lib/taskAttachments', () => ({
      findAttachmentEntry: vi.fn(async (pid, attId) => {
        if (attId === 'att-1') {
          return {
            id: 'att-1',
            task_id: 't-1',
            board_id: 'b-1',
            object_path: 'attachments/att-1/photo.png',
            name: 'photo.png',
            mime: 'image/png',
            size: 4,
            kind: 'image',
            created_at: '2026-04-30',
          };
        }
        return null;
      }),
      readProjectBinary: vi.fn(async () => ({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
      })),
    }));
    route = await import('@/app/api/task-attachments/[id]/content/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the binary with the right headers (inline for images)', async () => {
    const req = new Request('http://localhost/api/task-attachments/att-1/content?project_id=p-real');
    const res = await route.GET(req, { params: Promise.resolve({ id: 'att-1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Length')).toBe('4');
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline; filename="photo\.png"$/);
    const ab = await res.arrayBuffer();
    expect(Buffer.from(ab).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  it('404 when attachment id is unknown', async () => {
    const req = new Request('http://localhost/api/task-attachments/att-x/content?project_id=p-real');
    const res = await route.GET(req, { params: Promise.resolve({ id: 'att-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.task_attachment_not_found');
  });
});

// DELETE /api/task-attachments/[id] ------------------------------------

describe('DELETE /api/task-attachments/[id]', () => {
  let route;
  let attachments;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    vi.doMock('@/lib/projectIndex', () => ({
      findProjectBackend: vi.fn(async () => 'local'),
    }));
    vi.doMock('@/lib/taskAttachments', () => ({
      deleteAttachmentCompletely: vi.fn(async (pid, id) => (id === 'att-1' ? { id } : null)),
    }));
    attachments = await import('@/lib/taskAttachments');
    route = await import('@/app/api/task-attachments/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('deletes an existing attachment', async () => {
    const req = new Request('http://localhost/api/task-attachments/att-1?project_id=p-real', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'att-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(attachments.deleteAttachmentCompletely).toHaveBeenCalledWith('p-real', 'att-1');
  });

  it('is idempotent for an already-missing id', async () => {
    const req = new Request('http://localhost/api/task-attachments/att-missing?project_id=p-real', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'att-missing' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(false);
  });
});
