import 'server-only';
import { graphEnv } from '@/lib/env';
import { sharePointSource } from '@/lib/graph/explorer';
import type { FileSource } from './explorer-types';
import { sampleSource } from './sample-tree';

/** True when every SharePoint (Graph) setting is present. */
export function sharePointConfigured(): boolean {
  try {
    graphEnv();
    return true;
  } catch {
    return false;
  }
}

/**
 * The admin file browser reads SharePoint when it is configured. Until then, setting
 * FILES_DEMO=true shows a clearly labeled sample tree so the screen can be previewed.
 * Real SharePoint always wins, so a forgotten FILES_DEMO flag can never hide real files.
 */
export function fileSource(): FileSource | null {
  if (sharePointConfigured()) return sharePointSource;
  if (process.env.FILES_DEMO === 'true') return sampleSource;
  return null;
}
