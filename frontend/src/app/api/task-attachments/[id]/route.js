import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { findProjectBackend } from '@/lib/projectIndex';
import { deleteAttachmentCompletely } from '@/lib/taskAttachments';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// DELETE /api/task-attachments/[id]?project_id=...
//
// Idempotent: a missing attachment returns 200. The route fronts both the
// "user clicks remove in editor" path and the "new task was cancelled, drop
// every attachment we uploaded" cleanup path -- both expect to be safe to
// retry without surfacing 404s.
export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return bad('errors.invalid_body', 'project_id is required');

  const backendId = await findProjectBackend(projectId);
  if (!backendId) {
    return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
  }

  const removed = await deleteAttachmentCompletely(projectId, id);
  return NextResponse.json({ id, removed: removed !== null });
});
