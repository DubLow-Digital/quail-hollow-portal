import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin } from '@/lib/security/origin';
import { createUserSupabase } from '@/lib/supabase/server';
import { serviceSupabase } from '@/lib/supabase/admin';
import { isSupabaseAuthCookie } from '@/lib/supabase/cookie-options';
import { CLIENT_SESSION_COOKIE } from '@/lib/auth/session-policy';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';

/** Client sign-out. Revokes the Supabase refresh token and clears every session cookie. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const reason = request.nextUrl.searchParams.get('reason') === 'idle' ? 'idle' : 'user';

  try {
    const supabase = await createUserSupabase();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { data: client } = await serviceSupabase()
        .from('clients')
        .select('id')
        .eq('auth_user_id', data.user.id)
        .maybeSingle();
      await supabase.auth.signOut({ scope: 'local' });
      if (client) {
        await audit({
          actorType: 'client',
          actorId: client.id,
          action: 'client.logout',
          targetType: 'client',
          targetId: client.id,
          metadata: { reason },
          meta: metaFromHeaders(request.headers),
        });
      }
    }
  } catch {
    // Clearing cookies below still signs the browser out.
  }

  const target = reason === 'idle' ? '/login?expired=1' : '/login?signedout=1';
  const res = NextResponse.redirect(new URL(target, request.url), 303);
  for (const cookie of request.cookies.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) res.cookies.delete(cookie.name);
  }
  res.cookies.delete(CLIENT_SESSION_COOKIE);
  return res;
}
