import 'server-only';
import { forgetGraphLocation } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase/admin';
import { log } from '@/lib/log';

/**
 * Where the client folders live in SharePoint: site, document library and the folder that
 * holds one folder per client. Vercel environment variables win when all are set; otherwise
 * the location picked on the Connect SharePoint page (stored in portal_settings) is used.
 * These are IDs and names, not secrets. Access itself is the portal's own Entra app.
 */

export interface SharePointLocation {
  siteId: string;
  driveId: string;
  rootFolderId: string;
  hostname: string | null;
  /** For display only. */
  siteName: string | null;
  libraryName: string | null;
  folderPath: string | null;
  webUrl: string | null;
}

export const LOCATION_KEYS = {
  siteId: 'sp_site_id',
  driveId: 'sp_drive_id',
  rootFolderId: 'sp_root_folder_id',
  hostname: 'sp_hostname',
  siteName: 'sp_site_name',
  libraryName: 'sp_library_name',
  folderPath: 'sp_folder_path',
  webUrl: 'sp_web_url',
} as const satisfies Record<keyof SharePointLocation, string>;

const ENV_KEYS = ['SP_SITE_ID', 'SP_DRIVE_ID', 'SP_CLIENT_ROOT_FOLDER_ID'] as const;
const CACHE_MS = 30_000;

let loadedAt = 0;
let fromPortal = false;

/** Pure: builds a location from stored settings, or null when any required value is missing. */
export function locationFromSettings(
  rows: { key: string; value: string }[],
): SharePointLocation | null {
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const siteId = get(LOCATION_KEYS.siteId);
  const driveId = get(LOCATION_KEYS.driveId);
  const rootFolderId = get(LOCATION_KEYS.rootFolderId);
  if (!siteId || !driveId || !rootFolderId) return null;
  return {
    siteId,
    driveId,
    rootFolderId,
    hostname: get(LOCATION_KEYS.hostname),
    siteName: get(LOCATION_KEYS.siteName),
    libraryName: get(LOCATION_KEYS.libraryName),
    folderPath: get(LOCATION_KEYS.folderPath),
    webUrl: get(LOCATION_KEYS.webUrl),
  };
}

function vercelHasLocation(): boolean {
  return !fromPortal && ENV_KEYS.every((k) => Boolean(process.env[k]?.trim()));
}

async function readSettings(): Promise<{ key: string; value: string }[]> {
  const { data, error } = await serviceSupabase()
    .from('portal_settings')
    .select('key, value')
    .like('key', 'sp_%');
  if (error) {
    log.warn('sharepoint.location_read_failed', { reason: error.code });
    return [];
  }
  return data ?? [];
}

/**
 * Makes the SharePoint location available to the Graph helpers. Call before any SharePoint
 * work in a request. Cheap: the stored location is cached for 30 seconds per server.
 */
export async function ensureSharePointLocation(force = false): Promise<void> {
  if (vercelHasLocation()) return;
  if (!force && Date.now() - loadedAt < CACHE_MS) return;
  loadedAt = Date.now();
  const location = locationFromSettings(await readSettings());
  if (!location) {
    if (fromPortal) {
      for (const k of [...ENV_KEYS, 'SP_HOSTNAME']) delete process.env[k];
      fromPortal = false;
      forgetGraphLocation();
    }
    return;
  }
  process.env.SP_SITE_ID = location.siteId;
  process.env.SP_DRIVE_ID = location.driveId;
  process.env.SP_CLIENT_ROOT_FOLDER_ID = location.rootFolderId;
  if (location.hostname) process.env.SP_HOSTNAME = location.hostname;
  fromPortal = true;
  forgetGraphLocation();
}

export interface LocationStatus {
  source: 'vercel' | 'portal' | 'none';
  location: SharePointLocation | null;
}

export async function sharePointLocationStatus(): Promise<LocationStatus> {
  if (vercelHasLocation()) {
    return {
      source: 'vercel',
      location: {
        siteId: process.env.SP_SITE_ID!,
        driveId: process.env.SP_DRIVE_ID!,
        rootFolderId: process.env.SP_CLIENT_ROOT_FOLDER_ID!,
        hostname: process.env.SP_HOSTNAME ?? null,
        siteName: null,
        libraryName: null,
        folderPath: null,
        webUrl: null,
      },
    };
  }
  const location = locationFromSettings(await readSettings());
  return { source: location ? 'portal' : 'none', location };
}

export async function saveSharePointLocation(
  location: SharePointLocation,
  adminId: string,
): Promise<{ ok: true } | { ok: false; reason: 'missing_table' | 'failed' }> {
  const now = new Date().toISOString();
  const rows = (Object.keys(LOCATION_KEYS) as (keyof SharePointLocation)[])
    .filter((k) => location[k])
    .map((k) => ({
      key: LOCATION_KEYS[k],
      value: String(location[k]).slice(0, 2000),
      updated_by: adminId,
      updated_at: now,
    }));
  const { error } = await serviceSupabase()
    .from('portal_settings')
    .upsert(rows, { onConflict: 'key' });
  if (error) {
    log.error('sharepoint.location_save_failed', { reason: error.code });
    // 42P01 / PGRST205: the portal_settings table does not exist yet.
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    return { ok: false, reason: missing ? 'missing_table' : 'failed' };
  }
  await ensureSharePointLocation(true);
  return { ok: true };
}
