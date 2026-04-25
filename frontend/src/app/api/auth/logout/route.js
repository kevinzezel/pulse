import { NextResponse } from 'next/server';
import { getCookieNames, getCookieOptions } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  for (const name of getCookieNames()) {
    res.cookies.set(name, '', { ...getCookieOptions(), maxAge: 0 });
  }
  return res;
}
