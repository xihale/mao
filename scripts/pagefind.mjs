// pagefind 索引：在 astro build 产出的 dist/ 上构建，并同步到 public/ 供 dev server。
//
// 前置条件：dist/ 已由 astro build 产出（含文章 HTML）。
// 产物：dist/pagefind（prod 运行时）+ public/pagefind（dev server）。

import { rm, cp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const DIST_PF = join(DIST, 'pagefind');
const PUBLIC_PF = join(ROOT, 'public', 'pagefind');

if (!await stat(DIST).then(() => true).catch(() => false)) {
  console.error('[pagefind] 错误：dist/ 不存在，请先运行 astro build');
  process.exit(1);
}

const t0 = Date.now();
execSync('bunx pagefind --site dist', { stdio: 'inherit', cwd: ROOT });

// 同步到 public（dev 用）
await rm(PUBLIC_PF, { recursive: true, force: true });
await cp(DIST_PF, PUBLIC_PF, { recursive: true });

console.log(`[pagefind] 索引就绪（${Date.now() - t0}ms）`);
