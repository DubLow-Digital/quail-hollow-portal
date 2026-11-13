import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, checkAdminSession } from '@/lib/auth/session-policy';
import { appEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { metaFromHeaders } from '@/lib/request-meta';
import { assertSameOrigin } from '@/lib/security/origin';

export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const check = checkAdminSession(
    appEnv().AUTH_SECRET,
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (check.ok) {
    await audit({
      actorType: 'admin',
      actorId: check.session.aid,
      action: 'admin.logout',
      targetType: 'admin',
      targetId: check.session.aid,
      meta: metaFromHeaders(request.headers),
    });
  }
  const res = NextResponse.redirect(new URL('/admin/signin?signedout=1', request.url), 303);
  res.cookies.delete(ADMIN_SESSION_COOKIE);
  return res;
}
