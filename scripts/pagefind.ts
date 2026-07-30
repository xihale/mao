import { cp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const dist = join(root, 'dist');
const distPf = join(dist, 'pagefind');
const publicPf = join(root, 'public', 'pagefind');

if (!(await stat(dist).then(() => true, () => false))) {
  console.error('[pagefind] dist/ missing — run astro build first');
  process.exit(1);
}

const t0 = Date.now();
execSync('bunx pagefind --site dist', { stdio: 'inherit', cwd: root });
await rm(publicPf, { recursive: true, force: true });
await cp(distPf, publicPf, { recursive: true });
console.log(`[pagefind] ready (${Date.now() - t0}ms)`);
