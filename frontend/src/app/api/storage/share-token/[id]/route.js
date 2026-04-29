import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig } from '@/lib/storage';
import { encodeBackendToken } from '@/lib/backendToken';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

export const POST = withAuth(async (req, { params }) => {
  const { id } = await params;
  if (id === 'local') {
    return bad('errors.backend_local_not_shareable', 'Cannot share the local backend', 400);
  }
  const cfg = await getConfig();
  const backend = cfg.backends.find((b) => b.id === id);
  if (!backend) {
    return bad('errors.backend_unknown', 'Backend not found', 404, { id });
  }
  // Token carries FULL secrets — that's the contract.
  const token = encodeBackendToken({
    name: backend.name,
    driver: backend.driver,
    config: backend.config,
  });
  return NextResponse.json({ token });
});
