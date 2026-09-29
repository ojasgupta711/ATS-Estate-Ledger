// ATS Estate Ledger — local server (no dependencies, Node 20+).
//
// Saves everything in the project's storage/ folder:
//
//   storage/
//     data/app-data.json                 all clients, trusts, accounts and imports
//     data/backups/app-data-<time>.json  the previous 30 versions
//     clients/<Estate name>/uploads/<yyyy-mm>/<time>__<file>.xlsx   original spreadsheets
//     clients/<Estate name>/reports/<file>.pdf                       generated estate summaries
//
// API (all under /api):
//   GET  /api/health                         → { ok, server, storage }
//   GET  /api/data                           → saved data (204 when nothing saved yet)
//   GET  /api/data/revision                  → { revision, savedAt, savedBy } (for keeping browsers in sync)
//   PUT  /api/data                           ← JSON + X-Base-Revision header; writes app-data.json (keeps a
//                                              backup). 409 + latest data if someone else saved first.
//   POST /api/files?client=&kind=&name=      ← raw file body; saves it, returns { path, url, size, sha256, savedAt }
//   GET  /api/files?client=&kind=            → files saved for a client
//   GET  /api/files/<path>[?download=1]      → the file itself
//
// When a production build exists (npm run build → dist/), the server also serves the app.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE = path.resolve(process.env.ATS_STORAGE_DIR || path.join(ROOT, 'storage'));
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 3001);
const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB
const KEEP_BACKUPS = 30;

const DATA_FILE = path.join(STORAGE, 'data', 'app-data.json');
const BACKUP_DIR = path.join(STORAGE, 'data', 'backups');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.woff2': 'font/woff2',
};

// ---------- helpers ----------

/** Makes a name safe for Windows, macOS and Linux folders. */
function safeName(name, fallback = 'file') {
  let s = String(name || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  return (s || fallback).slice(0, 120);
}

/** Resolves a path inside storage/ and refuses anything that escapes it. */
function inStorage(rel) {
  const full = path.resolve(STORAGE, rel);
  if (full !== STORAGE && !full.startsWith(STORAGE + path.sep)) throw Object.assign(new Error('Invalid path'), { status: 400 });
  return full;
}

const toPosix = (p) => p.split(path.sep).join('/');
const fileUrl = (rel) => `/api/files/${toPosix(rel).split('/').map(encodeURIComponent).join('/')}`;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error(`File is larger than ${Math.round(limit / 1048576)} MB`), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = body === undefined ? '' : isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/** Atomic write: write a temp file, then rename over the target. */
async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

// ---------- handlers ----------

// Several people can use the app at once. Every save bumps a revision number; a save based on
// an older revision is refused (409) with the latest data, so the browser can merge instead of
// silently overwriting someone else's work.
let current = null; // { revision, savedAt, savedBy }

async function readMeta() {
  if (current) return current;
  if (!existsSync(DATA_FILE)) return (current = { revision: 0, savedAt: null, savedBy: null });
  try {
    const d = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    current = { revision: Number(d._revision) || 1, savedAt: d._savedAt ?? null, savedBy: d._savedBy ?? null };
  } catch {
    current = { revision: 1, savedAt: null, savedBy: null };
  }
  return current;
}

// Saves are handled one at a time so two people saving at the same moment can't interleave.
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function getData(res) {
  if (!existsSync(DATA_FILE)) return send(res, 204);
  const text = await readFile(DATA_FILE, 'utf8');
  send(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8' });
}

async function getRevision(res) {
  send(res, 200, await readMeta());
}

async function putData(req, res) {
  const body = await readBody(req, MAX_UPLOAD);
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return send(res, 400, 'Body is not valid JSON');
  }
  if (!parsed || !Array.isArray(parsed.clients) || !Array.isArray(parsed.accounts)) return send(res, 400, 'Not ATS Estate Ledger data');

  const meta = await readMeta();
  const base = Number(req.headers['x-base-revision'] ?? -1);
  if (existsSync(DATA_FILE) && base !== meta.revision) {
    const latest = await readFile(DATA_FILE, 'utf8');
    return send(res, 409, latest, { 'Content-Type': 'application/json; charset=utf-8' });
  }
  const savedBy = decodeURIComponent(String(req.headers['x-user'] ?? '')) || null;
  const next = { revision: meta.revision + 1, savedAt: new Date().toISOString(), savedBy };
  parsed._revision = next.revision;
  parsed._savedAt = next.savedAt;
  parsed._savedBy = savedBy;
  const out = Buffer.from(JSON.stringify(parsed, null, 2));

  if (existsSync(DATA_FILE)) {
    await mkdir(BACKUP_DIR, { recursive: true });
    const prev = await readFile(DATA_FILE);
    if (!prev.equals(out)) {
      await writeFile(path.join(BACKUP_DIR, `app-data-${stamp()}.json`), prev);
      const backups = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) await rm(path.join(BACKUP_DIR, old), { force: true });
    }
  }
  await writeAtomic(DATA_FILE, out);
  current = next;
  send(res, 200, { ok: true, ...next });
}

async function postFile(req, res, q) {
  const kind = q.get('kind');
  if (kind !== 'uploads' && kind !== 'reports') return send(res, 400, 'kind must be "uploads" or "reports"');
  const client = safeName(q.get('client'), 'Unassigned');
  const name = safeName(q.get('name'), kind === 'reports' ? 'report.pdf' : 'upload');
  const body = await readBody(req, MAX_UPLOAD);
  if (!body.length) return send(res, 400, 'Empty file');

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Uploads keep every version (timestamped); a report with the same name is replaced by the newer one.
  const dir = kind === 'uploads' ? inStorage(path.join('clients', client, 'uploads', month)) : inStorage(path.join('clients', client, 'reports'));
  await mkdir(dir, { recursive: true });
  const full = kind === 'uploads' ? await uniquePath(dir, `${stamp(now)}__${name}`) : path.join(dir, name);
  await writeAtomic(full, body);

  const rel = path.relative(STORAGE, full);
  send(res, 201, {
    path: toPosix(rel),
    url: fileUrl(rel),
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    savedAt: now.toISOString(),
  });
}

async function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (!e.name.endsWith('.tmp')) out.push(full);
  }
  return out;
}

async function listFiles(res, q) {
  const kind = q.get('kind');
  if (kind !== 'uploads' && kind !== 'reports') return send(res, 400, 'kind must be "uploads" or "reports"');
  const dir = inStorage(path.join('clients', safeName(q.get('client'), 'Unassigned'), kind));
  const files = await Promise.all(
    (await walk(dir)).map(async (full) => {
      const st = await stat(full);
      const rel = path.relative(STORAGE, full);
      return { name: path.basename(full), path: toPosix(rel), url: fileUrl(rel), size: st.size, sha256: '', savedAt: st.mtime.toISOString() };
    }),
  );
  send(res, 200, files.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
}

async function getFile(res, relEncoded, q) {
  const rel = relEncoded.split('/').map(decodeURIComponent).join(path.sep);
  const full = inStorage(rel);
  if (!rel.startsWith(`clients${path.sep}`) || !existsSync(full)) return send(res, 404, 'File not found');
  const st = await stat(full);
  if (!st.isFile()) return send(res, 404, 'File not found');
  const name = path.basename(full);
  const disposition = q.get('download') === '1' ? 'attachment' : 'inline';
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': `${disposition}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  });
  createReadStream(full).pipe(res);
}

async function serveApp(req, res, pathname) {
  if (!existsSync(DIST)) {
    return send(
      res,
      200,
      'ATS Estate Ledger server is running.\n\nFor development open http://localhost:5173 (started by "npm run dev").\nTo serve the app from here, run "npm run build" first, then "npm start".',
    );
  }
  let file = path.resolve(DIST, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(DIST) || !existsSync(file) || (await stat(file)).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true, server: true, storage: STORAGE });
    if (p === '/api/data' && req.method === 'GET') return await getData(res);
    if (p === '/api/data/revision' && req.method === 'GET') return await getRevision(res);
    if (p === '/api/data' && req.method === 'PUT') return await serialize(() => putData(req, res));
    if (p === '/api/files' && req.method === 'POST') return await postFile(req, res, url.searchParams);
    if (p === '/api/files' && req.method === 'GET') return await listFiles(res, url.searchParams);
    if (p.startsWith('/api/files/') && req.method === 'GET') return await getFile(res, p.slice('/api/files/'.length), url.searchParams);
    if (p.startsWith('/api/')) return send(res, 404, 'Not found');
    if (req.method === 'GET') return await serveApp(req, res, p);
    send(res, 405, 'Method not allowed');
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, e.message || 'Server error');
    else res.end();
  }
});

await mkdir(path.join(STORAGE, 'data'), { recursive: true });
await mkdir(path.join(STORAGE, 'clients'), { recursive: true });

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ATS Estate Ledger server  → http://localhost:${PORT}`);
  console.log(`Storage folder            → ${STORAGE}`);
  if (existsSync(DIST)) console.log(`Serving the built app     → http://localhost:${PORT}`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other server or set PORT to another number.`);
  else console.error(e);
  process.exit(1);
});
