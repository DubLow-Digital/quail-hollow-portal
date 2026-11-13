// A small in-memory stand-in for the parts of Microsoft Graph / SharePoint the portal uses,
// for end-to-end tests only (the portal talks to it when E2E_GRAPH_MOCK_URL is set to this
// loopback address). No dependencies. Not a general Graph emulator.
//
//   GET    /v1.0/drives/{d}/items/{id}                      item
//   GET    /v1.0/drives/{d}/items/{id}:/{path}:              item by path under a folder
//   GET    /v1.0/drives/{d}/items/{id}/children              children
//   POST   /v1.0/drives/{d}/items/{id}/children              create folder (conflictBehavior fail)
//   POST   /v1.0/drives/{d}/items/{id}:/{name}:/createUploadSession
//   GET    /v1.0/drives/{d}/items/{id}/search(q='...')       name search in a subtree
//   DELETE /v1.0/drives/{d}/items/{id}
//   PUT    /upload/{session}   chunk upload (Content-Range), CORS-enabled, no auth header allowed
//   GET    /upload/{session}   session status
//   GET    /content/{id}       file bytes (the "download URL")
//   GET    /__test/files       every file with its folder path (for assertions)
//   GET    /__test/health
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4010);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DRIVE = process.env.SP_DRIVE_ID || 'b!e2e-drive';
const ROOT = process.env.SP_CLIENT_ROOT_FOLDER_ID || 'E2EROOT';
const TOKEN = 'Bearer e2e-mock-token';

const items = new Map();
let seq = 0;
const newId = () => `01E2E${String(++seq).padStart(10, '0')}`;
const now = () => new Date().toISOString();

function add(item) {
  items.set(item.id, item);
  return item;
}
add({ id: 'LIBRARY', name: 'Documents', folder: true, parent: null, createdAt: now() });
add({ id: ROOT, name: 'Clients', folder: true, parent: 'LIBRARY', createdAt: now() });

const children = (id) => [...items.values()].filter((i) => i.parent === id);
function pathOf(item) {
  const names = [];
  for (let cur = item; cur && cur.id !== 'LIBRARY'; cur = items.get(cur.parent))
    names.unshift(cur.name);
  return names.join('/');
}
function json(item) {
  const out = {
    id: item.id,
    name: item.name,
    webUrl: `${ORIGIN}/sites/qh/${encodeURI(pathOf(item))}`,
    createdDateTime: item.createdAt,
    lastModifiedDateTime: item.createdAt,
    lastModifiedBy: { application: { displayName: 'Quail Hollow Client Portal' } },
    parentReference: item.parent ? { driveId: DRIVE, id: item.parent } : { driveId: DRIVE },
  };
  if (item.folder) out.folder = { childCount: children(item.id).length };
  else {
    out.file = { mimeType: item.mime || 'application/octet-stream' };
    out.size = item.bytes.length;
    out['@microsoft.graph.downloadUrl'] = `${ORIGIN}/content/${item.id}`;
  }
  return out;
}
function childByName(parentId, name) {
  return children(parentId).find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}
function uniqueName(parentId, name) {
  if (!childByName(parentId, name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  for (let n = 1; ; n++)
    if (!childByName(parentId, `${stem} ${n}${ext}`)) return `${stem} ${n}${ext}`;
}
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

const sessions = new Map();

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}
const graphError = (res, status, code) => send(res, status, { error: { code, message: code } });
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Range, Content-Type',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  try {
    if (path === '/__test/health') return send(res, 200, { ok: true });
    if (path === '/__test/files') {
      const files = [...items.values()]
        .filter((i) => !i.folder)
        .map((i) => ({ id: i.id, name: i.name, path: pathOf(i), size: i.bytes.length }));
      return send(res, 200, { files });
    }
    if (path.startsWith('/content/')) {
      const item = items.get(path.slice('/content/'.length));
      if (!item || item.folder) return graphError(res, 404, 'itemNotFound');
      res.writeHead(200, { 'Content-Type': item.mime || 'application/octet-stream' });
      return res.end(item.bytes);
    }

    // ---- upload sessions (called by the browser) ----
    if (path.startsWith('/upload/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      const session = sessions.get(path.slice('/upload/'.length));
      if (!session) return send(res, 404, { error: { code: 'itemNotFound' } }, CORS);
      if (req.headers.authorization)
        return send(res, 400, { error: { code: 'authorizationNotAllowed' } }, CORS);
      if (req.method === 'GET') {
        return send(res, 200, { nextExpectedRanges: [`${session.received}-`] }, CORS);
      }
      if (req.method !== 'PUT') return send(res, 405, {}, CORS);
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range'] || '');
      const body = await readBody(req);
      if (!range) return send(res, 400, { error: { code: 'invalidRange' } }, CORS);
      const [start, end, total] = range.slice(1).map(Number);
      if (start !== session.received || end - start + 1 !== body.length || total !== session.size) {
        return send(
          res,
          416,
          { error: { code: 'invalidRange' }, nextExpectedRanges: [`${session.received}-`] },
          CORS,
        );
      }
      // Chunks other than the last must be multiples of 320 KiB, as Graph requires.
      if (end + 1 < total && body.length % (320 * 1024) !== 0) {
        return send(res, 400, { error: { code: 'invalidChunkSize' } }, CORS);
      }
      session.chunks.push(body);
      session.received += body.length;
      if (session.received < total) {
        return send(res, 202, { nextExpectedRanges: [`${session.received}-`] }, CORS);
      }
      const name = uniqueName(session.parent, session.name);
      const ext = name.split('.').pop().toLowerCase();
      const item = add({
        id: newId(),
        name,
        folder: false,
        parent: session.parent,
        bytes: Buffer.concat(session.chunks),
        mime: MIME[ext],
        createdAt: now(),
      });
      sessions.delete(session.id);
      return send(res, 201, json(item), CORS);
    }

    // ---- Graph API (called by the portal server) ----
    if (!path.startsWith('/v1.0/')) return graphError(res, 404, 'notFound');
    if (req.headers.authorization !== TOKEN)
      return graphError(res, 401, 'InvalidAuthenticationToken');
    const m = /^\/v1\.0\/drives\/([^/]+)\/items\/([^/:]+)(.*)$/.exec(path);
    if (!m) return graphError(res, 404, 'notFound');
    if (decodeURIComponent(m[1]) !== DRIVE) return graphError(res, 403, 'accessDenied');
    const base = items.get(decodeURIComponent(m[2]));
    const rest = m[3];
    if (!base) return graphError(res, 404, 'itemNotFound');

    if (rest === '') {
      if (req.method === 'GET') return send(res, 200, json(base));
      if (req.method === 'DELETE') {
        items.delete(base.id);
        res.writeHead(204);
        return res.end();
      }
    }
    if (rest === '/children') {
      if (req.method === 'GET') return send(res, 200, { value: children(base.id).map(json) });
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!body.name || !body.folder) return graphError(res, 400, 'invalidRequest');
        if (childByName(base.id, body.name)) return graphError(res, 409, 'nameAlreadyExists');
        return send(
          res,
          201,
          json(
            add({ id: newId(), name: body.name, folder: true, parent: base.id, createdAt: now() }),
          ),
        );
      }
    }
    const search = /^\/search\(q='(.*)'\)$/.exec(decodeURIComponent(rest));
    if (search && req.method === 'GET') {
      const q = search[1].replace(/''/g, "'").toLowerCase();
      const found = [];
      const walk = (id) => {
        for (const c of children(id)) {
          if (c.name.toLowerCase().includes(q)) found.push(json(c));
          if (c.folder) walk(c.id);
        }
      };
      walk(base.id);
      return send(res, 200, { value: found });
    }
    const byPath = /^:\/(.+):(\/createUploadSession)?$/.exec(rest);
    if (byPath) {
      const segments = byPath[1].split('/').map(decodeURIComponent);
      if (byPath[2]) {
        if (req.method !== 'POST') return graphError(res, 405, 'methodNotAllowed');
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (body.item?.['@microsoft.graph.conflictBehavior'] !== 'rename')
          return graphError(res, 400, 'invalidRequest');
        const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        sessions.set(id, {
          id,
          parent: base.id,
          name: segments.join('/'),
          size: Number(body.item.fileSize),
          received: 0,
          chunks: [],
        });
        return send(res, 200, {
          uploadUrl: `${ORIGIN}/upload/${id}`,
          expirationDateTime: new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      let cur = base;
      for (const seg of segments) {
        cur = cur && cur.folder ? childByName(cur.id, seg) : null;
        if (!cur) return graphError(res, 404, 'itemNotFound');
      }
      return send(res, 200, json(cur));
    }
    return graphError(res, 400, 'invalidRequest');
  } catch (err) {
    console.error('mock graph error', err);
    return graphError(res, 500, 'generalException');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock graph on ${ORIGIN}`));
