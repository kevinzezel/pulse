import { NextResponse } from 'next/server';
import { createSessionToken, getCookieName, getCookieOptions, isValidPassword } from '@/lib/auth';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { detail: 'Invalid request body', detail_key: 'errors.invalid_body' },
      { status: 400 }
    );
  }

  if (!isValidPassword(body?.password)) {
    return NextResponse.json(
      { detail: 'Invalid password', detail_key: 'errors.invalid_password' },
      { status: 401 }
    );
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getCookieName(), token, getCookieOptions());
  return res;
}
