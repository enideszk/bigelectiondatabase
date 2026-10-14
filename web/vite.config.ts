import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Folder under public/ that `etl export` writes (thousands of JSON files). */
const GENERATED = 'data';

/**
 * Serve public/data straight from disk in the dev server. Vite serves public files from a list
 * taken at startup and kept current by the file watcher, but the watcher ignores this folder (see
 * below), so files added by `etl export` would otherwise get the index.html fallback until a restart.
 */
function serveGenerated(): Plugin {
  return {
    name: 'serve-generated-data',
    configureServer(server) {
      const publicDir = path.resolve(server.config.publicDir);
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!url.startsWith(`/${GENERATED}/`)) return next();
        const file = path.join(publicDir, url);
        if (!file.startsWith(publicDir + path.sep)) return next();
        let stat;
        try {
          stat = statSync(file);
        } catch {
          return next();
        }
        if (!stat.isFile()) return next();
        const since = Date.parse(req.headers['if-modified-since'] ?? '');
        if (since && Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000)) {
          res.statusCode = 304;
          return res.end();
        }
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
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
  // Never watch the generated data (thousands of files written by `etl export`): polling them over
  // the share starves the dev server (seconds per request). serveGenerated() serves them instead;
  // after `etl export`, refresh the page.
  const ignored = [`**/public/${GENERATED}/**`];
  return {
    // Relative asset paths: the built site works from any folder or sub-path.
    base: './',
    plugins: [serveGenerated()],
    server: { watch: polling ? { usePolling: true, interval: 500, ignored } : { ignored } },
    build: { target: 'es2022' },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
