import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { defineConfig } from 'astro/config';
import type { Plugin } from 'vite';

/** Dev: serve build-time pagefind index; also honor Vite's `?import` rewrite. */
function pagefindDev(): Plugin {
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };
  return {
    name: 'pagefind-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/pagefind/')) {
          next();
          return;
        }
        const pathname = req.url.split('?')[0] ?? '';
        const file = join(server.config.root, 'dist', pathname.slice(1));
        if (!existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  site: 'https://mao.xihale.top',
  vite: { plugins: [pagefindDev()] },
});
