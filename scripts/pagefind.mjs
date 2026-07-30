// pagefind 索引按需构建：内容没变就跳过，变了才重建。
//
// 用法：
//   node scripts/pagefind.mjs          哈希命中则跳过，否则重建
//   node scripts/pagefind.mjs --force  无视哈希，强制重建
//
// 前置条件：dist/ 已由 astro build 产出（含文章 HTML）。
// 产物：.pagefind-cache/（持久缓存，gitignore）→ 同步到 dist/pagefind 与 public/pagefind。

import { createHash } from 'node:crypto';
import { readdir, readFile, rm, cp, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const DIST_PF = join(DIST, 'pagefind');          // 产物的运行时位置（prod）
const PUBLIC_PF = join(ROOT, 'public', 'pagefind'); // dev server 读取位置
const CACHE = join(ROOT, '.pagefind-cache');      // 持久缓存
const CACHE_PF = join(CACHE, 'pagefind');         // 缓存里的产物本体
const HASH_FILE = join(CACHE, '.content-hash');

const CONTENT_DIR = join(ROOT, 'src', 'content', 'volumes');
const SCHEMA_FILE = join(ROOT, 'src', 'content.config.ts');

const FORCE = process.argv.includes('--force');

// ── 递归收集 md 文件 ──
async function collectMd(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectMd(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// ── 计算内容指纹：所有 md 内容 + content.config.ts ──
async function computeHash() {
  const h = createHash('sha256');
  const files = (await collectMd(CONTENT_DIR)).sort();
  for (const f of files) {
    const buf = await readFile(f);
    h.update(f.slice(ROOT.length)); // 路径变化（增删/改名）也要计入
    h.update(buf);
  }
  // schema 变了（字段/类型）也应重建
  try { h.update(await readFile(SCHEMA_FILE)); } catch { /* schema 不存在则忽略 */ }
  return h.digest('hex');
}

async function readPrevHash() {
  try { return (await readFile(HASH_FILE, 'utf8')).trim(); } catch { return null; }
}

// ── 判断缓存产物是否完整（避免半截写入被当成有效缓存）──
async function cacheIntact() {
  try {
    await stat(join(CACHE_PF, 'pagefind-entry.json'));
    await stat(join(CACHE_PF, 'pagefind.js'));
    return true;
  } catch { return false; }
}

// ── 同步目录：from → to，先清空 to ──
async function syncDir(from, to, label) {
  await rm(to, { recursive: true, force: true });
  await mkdir(join(to, '..'), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`  → 同步到 ${label}`);
}

async function main() {
  const t0 = Date.now();
  const hash = await computeHash();
  const prev = await readPrevHash();
  const intact = await cacheIntact();

  const hit = !FORCE && hash === prev && intact;

  if (hit) {
    // 内容未变：直接把缓存拷进 dist，跳过 pagefind
    await syncDir(CACHE_PF, DIST_PF, 'dist/pagefind');
    const ms = (Date.now() - t0).toString().padStart(4);
    console.log(`[pagefind] 内容未变，跳过索引（${ms}ms）`);
    return;
  }

  // 需要重建：在 dist 上跑 pagefind
  if (FORCE) console.log('[pagefind] 强制重建索引');
  else if (!intact) console.log('[pagefind] 缓存不完整，重建索引');
  else console.log('[pagefind] 内容已变更，重建索引');

  if (!await stat(DIST).then(() => true).catch(() => false)) {
    console.error('[pagefind] 错误：dist/ 不存在，请先运行 astro build');
    process.exit(1);
  }

  // pagefind 直接输出到 dist/pagefind
  execSync('bunx pagefind --site dist', { stdio: 'inherit', cwd: ROOT });

  // 持久化到缓存目录
  await rm(CACHE, { recursive: true, force: true });
  await mkdir(CACHE, { recursive: true });
  await cp(DIST_PF, CACHE_PF, { recursive: true });
  await writeFile(HASH_FILE, hash, 'utf8');

  // 同步到 public（dev 用）
  await syncDir(CACHE_PF, PUBLIC_PF, 'public/pagefind');

  const ms = Date.now() - t0;
  console.log(`[pagefind] 索引就绪（${ms}ms）`);
}

main().catch((e) => {
  console.error('[pagefind] 失败：', e);
  process.exit(1);
});
