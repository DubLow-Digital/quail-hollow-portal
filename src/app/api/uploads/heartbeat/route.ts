import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin } from '@/lib/security/origin';

/**
 * Keeps the portal session's idle timer fresh during a long upload. The proxy has already
 * validated and refreshed the session before this handler runs.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
