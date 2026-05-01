import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { findProjectBackend } from '@/lib/projectIndex';
import { findAttachmentEntry, readProjectBinary } from '@/lib/taskAttachments';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// MIMEs we feel safe rendering inline in the browser. PDFs benefit too --
// modern browsers all have native PDF viewers and the user typically wants a
// preview rather than a download. Office files force `attachment` so the OS
// hands them off to Word/Excel/PowerPoint.
function dispositionFor(mime) {
  if (typeof mime !== 'string') return 'attachment';
  if (mime.startsWith('image/')) return 'inline';
  if (mime === 'application/pdf') return 'inline';
  return 'attachment';
}

// GET /api/task-attachments/[id]/content?project_id=...
//
// Auth-gated proxy. Never returns a presigned S3 URL -- all bytes flow
// through this route so the permission check is centralized (withAuth + the
// per-project index lookup) and the bucket prefix never leaks.
export const GET = withAuth(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return bad('errors.invalid_body', 'project_id is required');

  const backendId = await findProjectBackend(projectId);
  if (!backendId) {
    return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
  }

  const entry = await findAttachmentEntry(projectId, id);
  if (!entry) return bad('errors.task_attachment_not_found', 'attachment not found', 404, { id });

  const out = await readProjectBinary(projectId, entry.object_path);
  if (!out) {
    // Index says it exists but the bytes are gone (manual deletion, partial
    // restore). Surface as 404 -- the caller treats this as "missing".
    return bad('errors.task_attachment_not_found', 'attachment binary missing', 404, { id });
  }

  // Content-Type comes from the index (authoritative on what the user
  // uploaded). Disposition mirrors the rules above so images/PDFs preview.
  const disposition = `${dispositionFor(entry.mime)}; filename="${entry.name.replace(/"/g, '\\"')}"`;
  const headers = new Headers();
  headers.set('Content-Type', entry.mime || 'application/octet-stream');
  headers.set('Content-Length', String(out.buffer.length));
  headers.set('Content-Disposition', disposition);
  // Cache for a year -- the URL contains a stable UUID and a content edit
  // would be a delete+reupload (new id). private since the response carries
  // user data.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new NextResponse(out.buffer, { status: 200, headers });
});
