import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseString } from 'xml2js';

const EPUB_DIR = '/tmp/mao-epub/OEBPS';
const OUT_DIR = join(process.cwd(), 'src/content/volumes');
const SEARCH_INDEX_PATH = join(process.cwd(), 'public/search-index.json');

const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

const tocXml = readFileSync(join(EPUB_DIR, 'toc.ncx'), 'utf-8');
const searchIndex = [];

parseString(tocXml, (err, result) => {
  if (err) throw err;
  
  const navMap = result.ncx.navMap[0].navPoint;
  const volumes = [];
  
  for (const volNav of navMap) {
    const volTitle = volNav.navLabel[0].text[0];
    const volMatch = volTitle.match(/第(.+?)卷/);
    const volNum = volMatch ? (CN_NUM[volMatch[1]] || parseInt(volMatch[1]) || 0) : 0;
    const volSrc = volNav.content[0].$.src;
    
    const periods = [];
    const periodNavs = volNav.navPoint || [];
    
    for (const periodNav of periodNavs) {
      const periodTitle = periodNav.navLabel[0].text[0];
      const periodSrc = periodNav.content[0].$.src;
      const articleNavs = periodNav.navPoint || [];
      
      if (articleNavs.length > 0) {
        const articles = articleNavs.map(artNav => ({
          title: artNav.navLabel[0].text[0],
          src: artNav.content[0].$.src,
        }));
        periods.push({ title: periodTitle, src: periodSrc, articles });
      } else {
        periods.push({ title: periodTitle, src: periodSrc, articles: [], isPreface: true });
      }
    }
    
    volumes.push({ title: volTitle, num: volNum, src: volSrc, periods });
  }
  
  let count = 0;
  let order = 0;
  for (const vol of volumes) {
    const volDir = join(OUT_DIR, `vol${vol.num}`);
    mkdirSync(volDir, { recursive: true });
    
    for (const period of vol.periods) {
      if (period.isPreface) {
        const { md, plainText } = convertXhtmlToMd(join(EPUB_DIR, period.src), period.title, vol, null, order);
        const slug = generateSlug(period.title);
        writeFileSync(join(volDir, `${slug}.md`), md);
        searchIndex.push({ title: period.title, volume: vol.num, volumeTitle: vol.title, slug: `vol${vol.num}/${slug}`, content: plainText.slice(0, 500) });
        count++;
        order++;
        continue;
      }
      
      for (const article of period.articles) {
        const { md, plainText } = convertXhtmlToMd(join(EPUB_DIR, article.src), article.title, vol, period.title, order);
        const slug = generateSlug(article.title);
        writeFileSync(join(volDir, `${slug}.md`), md);
        searchIndex.push({ title: article.title, volume: vol.num, volumeTitle: vol.title, period: period.title, slug: `vol${vol.num}/${slug}`, content: plainText.slice(0, 800) });
        count++;
        order++;
      }
    }
  }
  
  // Write search index
  mkdirSync(join(process.cwd(), 'public'), { recursive: true });
  writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchIndex, null, 0));
  
  console.log(`Extracted ${count} articles`);
  console.log(`Search index: ${searchIndex.length} entries`);
});

function convertXhtmlToMd(filePath, title, volume, periodTitle = null, order = 0) {
  const html = readFileSync(filePath, 'utf-8');
  
  const dateMatch = html.match(/<span class="f2">([^<]+)<\/span>/);
  const date = dateMatch ? dateMatch[1].replace(/[（）]/g, '').trim() : null;
  
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (!bodyMatch) return { md: '', plainText: '' };
  
  let body = bodyMatch[1];
  
  // Remove headers
  body = body.replace(/<h[123][^>]*>[\s\S]*?<\/h[123]>/g, '');
  
  // Remove date paragraph
  body = body.replace(/<p class="a0"[^>]*>[\s\S]*?<\/p>/g, '');
  
  // Extract footnotes before processing
  const footnotes = [];
  body = body.replace(/<p class="zs"[^>]*>([\s\S]*?)<\/p>/g, (_, content) => {
    const numMatch = content.match(/<a[^>]*>([※＊\*]?\s*〔(\d+)〕\s*)<\/a>/);
    const starMatch = content.match(/<a[^>]*>(\s*\*\s*)<\/a>/);
    
    if (numMatch) {
      const num = numMatch[2];
      const cleanContent = cleanHtml(content.replace(/<a[^>]*>[^<]*<\/a>/, ''));
      footnotes.push({ num, content: cleanContent.trim() });
      return `\n[^${num}]: ${cleanContent.trim()}\n`;
    } else if (starMatch) {
      const cleanContent = cleanHtml(content.replace(/<a[^>]*>[^<]*<\/a>/, ''));
      footnotes.push({ num: '*', content: cleanContent.trim() });
      return `\n[^*]: ${cleanContent.trim()}\n`;
    }
    
    const cleanContent = cleanHtml(content);
    return cleanContent.trim() ? `\n${cleanContent.trim()}\n` : '';
  });
  
  // Convert footnote references in text: 〔1〕 -> [^1]
  body = body.replace(/〔(\d+)〕/g, '[^$1]');
  
  // Convert paragraphs
  body = body.replace(/<p class="a"[^>]*>([\s\S]*?)<\/p>/g, (_, content) => {
    content = cleanHtml(content);
    return content.trim() ? `\n${content.trim()}\n` : '';
  });
  
  // Clean remaining HTML
  body = cleanHtml(body);
  
  // Remove "注　释" markers
  body = body.replace(/^注\s+释$/gm, '');
  
  // Build frontmatter
  const frontmatter = [
    '---',
    `title: "${escapeYaml(title)}"`,
    `volume: ${volume.num}`,
    `volumeTitle: "${escapeYaml(volume.title)}"`,
    `order: ${order}`,
    periodTitle ? `period: "${escapeYaml(periodTitle)}"` : null,
    date ? `date: "${date}"` : null,
    footnotes.length > 0 ? `hasFootnotes: true` : null,
    '---',
  ].filter(Boolean).join('\n');
  
  const md = `${frontmatter}\n\n# ${title}\n\n${body.trim()}\n`;
  const plainText = body.replace(/\[\^\d+\]/g, '').replace(/[>\[\]]/g, '').replace(/\n+/g, ' ').trim();
  
  return { md, plainText };
}

function cleanHtml(html) {
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

function generateSlug(title) {
  return title
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function escapeYaml(str) {
  return str.replace(/"/g, '\\"');
}
