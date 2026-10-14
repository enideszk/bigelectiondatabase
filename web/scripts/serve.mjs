// Production server for the built site (no dependencies; Node 18+):
//
//   node scripts/serve.mjs            serves on 127.0.0.1:1235 (PORT / HOST to change)
//   node scripts/serve.mjs --check    checks that the build and the data are there, then exits
//
// Serves web/dist (`npm run build`), except /data/, which comes straight from web/public/data, so
// a new `etl export` is live at once without a rebuild. Meant to sit behind a reverse proxy
// (Caddy on Server-PC, hungary.enideszk.duckdns.org) that does TLS and compression; it listens on
// loopback only. Hashed build assets are cached for good, everything else revalidated (ETag).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(web, 'dist');
const DATA = path.join(web, 'public', 'data');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 1235);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The file a URL path maps to, or null when it is outside the served folders. */
function resolve(urlPath) {
  const [root, rest] = urlPath.startsWith('/data/') ? [DATA, urlPath.slice('/data/'.length)] : [DIST, urlPath === '/' ? 'index.html' : urlPath.slice(1)];
  const file = path.resolve(root, rest);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

async function check() {
  const missing = [];
  for (const file of [path.join(DIST, 'index.html'), path.join(DATA, 'meta.json')]) {
    try {
      await stat(file);
    } catch {
      missing.push(file);
    }
  }
  return missing;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const done = (status) => {
    if (status >= 400) console.log(`${new Date().toISOString()} ${status} ${req.method} ${req.url} ${Date.now() - started}ms`);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return done(405);
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return done(400);
  }
  const file = resolve(urlPath);
  let info;
  try {
    info = file ? await stat(file) : null;
  } catch {
    info = null;
  }
  if (!file || !info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return done(404);
  }
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
    // build assets carry a content hash in their name; everything else may change any time
    'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] }).end();
    return done(304);
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
});

const missing = await check();
if (process.argv.includes('--check')) {
  console.log(missing.length ? `missing:\n  ${missing.join('\n  ')}` : `ok: ${DIST} and ${DATA}`);
  process.exit(missing.length ? 1 : 0);
}
if (missing.length) {
  console.error(`cannot serve, missing:\n  ${missing.join('\n  ')}\nRun \`npm run build\` (web/) and \`.\\etl export\` first.`);
  process.exit(1);
}
server.listen(PORT, HOST, () => console.log(`${new Date().toISOString()} serving ${DIST} (+ /data from ${DATA}) on http://${HOST}:${PORT}`));
