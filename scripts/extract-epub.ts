#!/usr/bin/env bun
/**
 * Extract 毛泽东选集 EPUB → src/content/volumes/*.md
 *
 * Usage:
 *   bun scripts/extract-epub.ts [path-to.epub | path-to/OEBPS]
 *
 * Default looks for /tmp/mao-epub/OEBPS.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const OUT_DIR = join(process.cwd(), 'src/content/volumes');

interface Nav {
  title: string;
  src: string;
  children: Nav[];
}

interface Volume {
  title: string;
  num: number;
  periods: {
    title: string;
    src: string;
    articles: { title: string; src: string }[];
    isPreface: boolean;
  }[];
}

function resolveOebps(input?: string): string {
  const raw = resolve(input ?? '/tmp/mao-epub');
  if (raw.endsWith('.epub')) {
    const dest = join(tmpdir(), 'mao-epub-extract');
    spawnSync('rm', ['-rf', dest], { stdio: 'inherit' });
    mkdirSync(dest, { recursive: true });
    const r = spawnSync('unzip', ['-qo', raw, '-d', dest], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`unzip failed: ${raw}`);
    const oebps = join(dest, 'OEBPS');
    if (existsSync(oebps)) return oebps;
    throw new Error(`OEBPS not found inside ${raw}`);
  }
  if (existsSync(join(raw, 'toc.ncx'))) return raw;
  if (existsSync(join(raw, 'OEBPS', 'toc.ncx'))) return join(raw, 'OEBPS');
  throw new Error(`Cannot find toc.ncx under ${raw}`);
}

/** Stack-based NCX navPoint parser (no xml2js). */
function parseNavPoints(xml: string): Nav[] {
  const root: Nav[] = [];
  const stack: Nav[][] = [root];
  let current: Nav | null = null;

  const re =
    /<navPoint\b[^>]*>|<navLabel>\s*<text>([^<]*)<\/text>\s*<\/navLabel>|<content\s+[^>]*src="([^"]+)"[^>]*\/>|<\/navPoint>/g;

  for (const m of xml.matchAll(re)) {
    const tag = m[0];
    if (tag.startsWith('<navPoint')) {
      current = { title: '', src: '', children: [] };
      const top = stack[stack.length - 1];
      if (!top) throw new Error('navPoint stack empty');
      top.push(current);
      stack.push(current.children);
    } else if (m[1] !== undefined && current) {
      current.title = m[1];
    } else if (m[2] !== undefined && current) {
      current.src = m[2];
    } else if (tag === '</navPoint>') {
      stack.pop();
      const parent = stack[stack.length - 1];
      current = parent?.[parent.length - 1] ?? null;
    }
  }
  return root;
}

function volNum(title: string): number {
  const m = /第(.+?)卷/.exec(title);
  if (!m?.[1]) return 0;
  return CN_NUM[m[1]] ?? (parseInt(m[1], 10) || 0);
}

function toVolumes(navs: Nav[]): Volume[] {
  return navs.map((vol) => ({
    title: vol.title,
    num: volNum(vol.title),
    periods: vol.children.map((period) => {
      const articles = period.children.map((a) => ({ title: a.title, src: a.src }));
      return {
        title: period.title,
        src: period.src,
        articles,
        isPreface: articles.length === 0,
      };
    }),
  }));
}

function cleanHtml(html: string): string {
  return html
    .replace(/<span[^>]*>/g, '')
    .replace(/<\/span>/g, '')
    .replace(/<a[^>]*>/g, '')
    .replace(/<\/a>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/^ {1,4}/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slug(title: string): string {
  return title
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"');
}

function xhtmlToMd(
  filePath: string,
  title: string,
  volume: Volume,
  periodTitle: string | null,
  order: number,
): string {
  const html = readFileSync(filePath, 'utf-8');
  const dateMatch = /<span class="f2">([^<]+)<\/span>/.exec(html);
  const date = dateMatch?.[1]?.replace(/[（）]/g, '').trim() ?? null;

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html);
  if (!bodyMatch?.[1]) return '';

  let body = bodyMatch[1]
    .replace(/<h[123][^>]*>[\s\S]*?<\/h[123]>/g, '')
    .replace(/<p class="a0"[^>]*>[\s\S]*?<\/p>/g, '');

  body = body.replace(/<p class="zs"[^>]*>([\s\S]*?)<\/p>/g, (_m: string, content: string) => {
    const numMatch = /<a[^>]*>([※＊*]?\s*〔(\d+)〕\s*)<\/a>/.exec(content);
    const starMatch = /<a[^>]*>(\s*\*\s*)<\/a>/.exec(content);
    if (numMatch?.[2]) {
      return `\n[^${numMatch[2]}]: ${cleanHtml(content.replace(/<a[^>]*>[^<]*<\/a>/, '')).trim()}\n`;
    }
    if (starMatch) {
      return `\n[^*]: ${cleanHtml(content.replace(/<a[^>]*>[^<]*<\/a>/, '')).trim()}\n`;
    }
    const cleaned = cleanHtml(content).trim();
    return cleaned ? `\n${cleaned}\n` : '';
  });

  body = body
    .replace(/〔(\d+)〕/g, '[^$1]')
    .replace(/<p class="a"[^>]*>([\s\S]*?)<\/p>/g, (_m: string, content: string) => {
      const t = cleanHtml(content).trim();
      return t ? `\n${t}\n` : '';
    });

  body = cleanHtml(body).replace(/^注\s+释$/gm, '');

  const fm = [
    '---',
    `title: "${escapeYaml(title)}"`,
    `volume: ${volume.num}`,
    `volumeTitle: "${escapeYaml(volume.title)}"`,
    `order: ${order}`,
    periodTitle ? `period: "${escapeYaml(periodTitle)}"` : null,
    date ? `date: "${date}"` : null,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  return `${fm}\n\n# ${title}\n\n${body.trim()}\n`;
}

function main() {
  const oebps = resolveOebps(process.argv[2]);
  const toc = readFileSync(join(oebps, 'toc.ncx'), 'utf-8');
  const volumes = toVolumes(parseNavPoints(toc));

  let order = 0;
  for (const vol of volumes) {
    const volDir = join(OUT_DIR, `vol${vol.num}`);
    mkdirSync(volDir, { recursive: true });

    for (const period of vol.periods) {
      if (period.isPreface) {
        const md = xhtmlToMd(join(oebps, period.src), period.title, vol, null, order);
        writeFileSync(join(volDir, `${slug(period.title)}.md`), md);
        order++;
        continue;
      }
      for (const article of period.articles) {
        const md = xhtmlToMd(join(oebps, article.src), article.title, vol, period.title, order);
        writeFileSync(join(volDir, `${slug(article.title)}.md`), md);
        order++;
      }
    }
  }

  console.log(`Extracted ${order} articles → ${OUT_DIR}`);
}

main();
