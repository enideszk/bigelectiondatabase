import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const GENERATED = ['data', 'tiles'];
const CONTENT_TYPES: Record<string, string> = { '.json': 'application/json', '.pmtiles': 'application/octet-stream' };

/**
 * Serve the generated folders (public/data, public/tiles) straight from disk in the dev server.
 * Vite serves public files from a list taken at startup and kept current by the file watcher, but
 * the watcher ignores these folders (see below), so files added by `etl build` would otherwise get
 * the index.html fallback until a restart. Supports Range requests (PMTiles reads byte ranges).
 */
function serveGenerated(): Plugin {
  return {
    name: 'serve-generated-data',
    configureServer(server) {
      const publicDir = path.resolve(server.config.publicDir);
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!GENERATED.some((folder) => url.startsWith(`/${folder}/`))) return next();
        const file = path.join(publicDir, url);
        if (!file.startsWith(publicDir + path.sep)) return next();
        let size: number;
        let modified: Date;
        try {
          const stat = statSync(file);
          if (!stat.isFile()) return next();
          size = stat.size;
          modified = stat.mtime;
        } catch {
          return next();
        }
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Last-Modified', modified.toUTCString());
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start > end || start >= size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          return createReadStream(file, { start, end }).pipe(res);
        }
        const since = Date.parse(req.headers['if-modified-since'] ?? '');
        if (since && Math.floor(modified.getTime() / 1000) <= Math.floor(since / 1000)) {
          res.statusCode = 304;
          return res.end();
        }
        res.setHeader('Content-Length', size);
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The dev server polls for file changes by default. Native file watching over the network share
  // (Z: = Server-PC's L:) exhausts the server's SMB resources and makes other programs' saves fail
  // with "Insufficient system resources". Set VITE_USE_POLLING=0 (environment or the repo-root .env)
  // to use native watching when the repo is on a local disk.
  const env = loadEnv(mode, '..', 'VITE_');
  const polling = (process.env.VITE_USE_POLLING ?? env.VITE_USE_POLLING ?? '1') !== '0';
  // Never watch the generated data (thousands of files written by `etl build`): polling them over
  // the share starves the dev server (seconds per request). serveGenerated() serves them instead;
  // after `etl build`, refresh the page.
  const ignored = GENERATED.map((folder) => `**/public/${folder}/**`);
  return {
    // Relative asset paths: the built site works from any folder or sub-path.
    base: './',
    plugins: [serveGenerated()],
    server: { watch: polling ? { usePolling: true, interval: 500, ignored } : { ignored } },
    build: { target: 'es2022' },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
