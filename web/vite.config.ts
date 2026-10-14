import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // The dev server polls for file changes by default. Native file watching over the network share
  // (Z: = Server-PC's L:) exhausts the server's SMB resources and makes other programs' saves fail
  // with "Insufficient system resources". Set VITE_USE_POLLING=0 (environment or the repo-root .env)
  // to use native watching when the repo is on a local disk.
  const env = loadEnv(mode, '..', 'VITE_');
  const polling = (process.env.VITE_USE_POLLING ?? env.VITE_USE_POLLING ?? '1') !== '0';
  // Never watch the generated data (thousands of files written by `etl build`): polling them over
  // the share starves the dev server (seconds per request). After `etl build`, refresh the page.
  const ignored = ['**/public/data/**', '**/public/tiles/**'];
  return {
    // Relative asset paths: the built site works from any folder or sub-path.
    base: './',
    server: { watch: polling ? { usePolling: true, interval: 500, ignored } : { ignored } },
    build: { target: 'es2022' },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
