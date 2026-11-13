import 'server-only';
import { headers } from 'next/headers';
import { isIP } from 'node:net';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Client IP as seen by Vercel's edge (first x-forwarded-for hop), validated for `inet`. */
export function ipFromHeaders(h: Headers): string | null {
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwarded || h.get('x-real-ip')?.trim() || '';
  return isIP(candidate) ? candidate : null;
}

export function metaFromHeaders(h: Headers): RequestMeta {
  const ua = h.get('user-agent');
  return { ip: ipFromHeaders(h), userAgent: ua ? ua.slice(0, 512) : null };
}

export async function requestMeta(): Promise<RequestMeta> {
  return metaFromHeaders(await headers());
}
