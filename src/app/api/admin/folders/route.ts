import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/auth/admin';
import { graphEnv } from '@/lib/env';
import { listChildFolders } from '@/lib/graph/drive';
import { GraphError } from '@/lib/graph/client';

const DRIVE_ITEM_ID = /^[A-Za-z0-9!_.-]{1,200}$/;

/** Admin-only: child folders for the folder browser. Defaults to the client root folder. */
export async function GET(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parent = request.nextUrl.searchParams.get('parent') ?? graphEnv().SP_CLIENT_ROOT_FOLDER_ID;
  if (!DRIVE_ITEM_ID.test(parent))
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const folders = await listChildFolders(parent);
    return NextResponse.json({ folders: folders.map(({ id, name }) => ({ id, name })) });
  } catch (err) {
    const status = err instanceof GraphError && err.status === 404 ? 404 : 502;
    return NextResponse.json({ error: 'graph_error' }, { status });
  }
}
