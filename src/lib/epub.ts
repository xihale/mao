import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import epubGen from 'epub-gen-memory';
import type { Chapter, Font } from 'epub-gen-memory';
import JSZip from 'jszip';
import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import matter from 'gray-matter';

const here = dirname(fileURLToPath(import.meta.url));

export interface EpubMeta {
  title: string;
  volume: number;
  volumeTitle: string;
  order: number;
  period?: string;
  date?: string;
}

interface ArticleFile {
  meta: EpubMeta;
  /** Markdown body without frontmatter. */
  body: string;
}

const md = new MarkdownIt({ html: false, xhtmlOut: true, typographer: false }).use(
  footnotePlugin,
);

/** Same CSS approach as the site: LXGW WenKai embedded, footnotes styled.
 * Single Regular face — the text has no bold/emphasis markup. */
const CSS = `
@font-face {
  font-family: "LXGW WenKai";
  font-style: normal;
  font-weight: 400;
  src: url(./fonts/LXGWWenKai.woff2);
}
body {
  font-family: "LXGW WenKai", serif;
  line-height: 1.6;
  margin: 5% 6%;
}
h1 { font-size: 1.3em; margin: 0.8em 0 0.4em; text-align: center; }
p { margin: 0 0 0.9em; text-indent: 2em; }
.footnote-ref a { text-decoration: none; font-size: 0.75em; vertical-align: super; }
.footnotes-sep { border: none; border-top: 1px solid #ccc; margin: 2em 10%; }
.footnotes { font-size: 0.85em; }
.footnotes h2 { display: none; }
.footnotes p { text-indent: 0; }
.footnote-backref { text-decoration: none; }
`;

/** Pre-subset static file (~833K, covers the full book charset; generated
 * via pyftsubset from LXGWWenKai-Regular.ttf). */
const FONTS: Font[] = [
  {
    filename: 'LXGWWenKai.woff2',
    url: 'file://' + join(here, '..', 'fonts', 'LXGWWenKai.woff2'),
  },
];

async function loadArticles(contentDir: string): Promise<ArticleFile[]> {
  const articles: ArticleFile[] = [];
  for (const dir of (await readdir(contentDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const files = (await readdir(join(contentDir, dir.name))).filter((f) =>
      f.endsWith('.md'),
    );
    for (const file of files) {
      const raw = await readFile(join(contentDir, dir.name, file), 'utf8');
      const { data, content } = matter(raw);
      articles.push({ meta: data as EpubMeta, body: content });
    }
  }
  return articles.sort((a, b) => a.meta.volume - b.meta.volume || a.meta.order - b.meta.order);
}

/** Volume separator page + one chapter per article; article h1 comes from frontmatter title. */
function buildChapters(articles: ArticleFile[]): Chapter[] {
  const chapters: Chapter[] = [];
  let currentVolume = -1;
  for (const { meta, body } of articles) {
    if (meta.volume !== currentVolume) {
      currentVolume = meta.volume;
      chapters.push({
        title: meta.volumeTitle,
        content: `<h1 class="volume-title">${meta.volumeTitle}</h1>`,
        filename: `vol${meta.volume}.xhtml`,
        excludeFromToc: false,
      });
    }
    const metaLine = [meta.period, meta.date].filter(Boolean).join(' · ');
    const html = md.render(body).replace(
      /<h1>.*?<\/h1>/s,
      `<h1>${meta.title}</h1>${metaLine ? `<p class="meta">${metaLine}</p>` : ''}`,
    );
    chapters.push({
      title: meta.title,
      content: html,
      filename: `v${meta.volume}o${meta.order}.xhtml`,
      excludeFromToc: false,
    });
  }
  return chapters;
}

/** epub-gen-memory's internal dom-serializer v1 escapes all non-ASCII to numeric
 * character references (3x size for CJK). Decode >= 0x80 back to UTF-8 (leave
 * control-char refs like &#xA; alone so XML stays valid). */
function decodeEntities(xml: string): string {
  return xml.replace(/&#x([0-9A-Fa-f]+);/g, (ref, hex: string) => {
    const cp = Number.parseInt(hex, 16);
    return cp >= 0x80 ? String.fromCodePoint(cp) : ref;
  });
}

const TEXT_EXT = new Set(['.xhtml', '.opf', '.ncx', '.css', '.xml', '.js', '.json']);

export async function buildEpub(outFile: string): Promise<void> {
  const contentDir = join(here, '..', 'content', 'volumes');
  const articles = await loadArticles(contentDir);
  if (articles.length === 0) throw new Error('No articles found');

  const buffer = await epubGen(
    {
      title: '毛泽东选集',
      author: '毛泽东',
      lang: 'zh-CN',
      publisher: 'mao.xihale.top',
      description: '毛泽东选集全七卷',
      css: CSS,
      fonts: FONTS,
      tocTitle: '目录',
      prependChapterTitles: false,
      numberChaptersInTOC: false,
      verbose: false,
    },
    buildChapters(articles),
  );

  // Re-zip with decoded UTF-8 text; keep `mimetype` first and STORE'd, fonts binary.
  const zip = await JSZip.loadAsync(buffer);
  const out = new JSZip();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (path === 'mimetype') {
      out.file(path, await entry.async('string'), { compression: 'STORE' });
    } else if (TEXT_EXT.has(extname(path))) {
      out.file(path, decodeEntities(await entry.async('string')), {
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
    } else {
      out.file(path, await entry.async('nodebuffer'), {
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
    }
  }
  await writeFile(outFile, await out.generateAsync({ type: 'nodebuffer' }));
}
