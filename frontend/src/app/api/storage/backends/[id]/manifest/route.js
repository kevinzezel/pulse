import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readStoreFromBackend } from '@/lib/storage';

export const GET = withAuth(async (req, { params }) => {
  const { id } = await params;
  try {
    const manifest = await readStoreFromBackend(id, 'projects-manifest.json', { v: 1, projects: [] });
    return NextResponse.json(manifest);
  } catch (err) {
    if (/unknown backend/i.test(err?.message || '')) {
      return NextResponse.json(
        { detail: 'Backend not found', detail_key: 'errors.backend_unknown', detail_params: { id } },
        { status: 404 },
      );
    }
    throw err;
  }
});
