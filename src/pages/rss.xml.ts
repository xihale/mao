import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const articles = await getCollection('volumes');
  const sorted = articles.sort((a, b) => {
    if (a.data.volume !== b.data.volume) return a.data.volume - b.data.volume;
    return a.data.order - b.data.order;
  });

  return rss({
    title: '毛泽东选集',
    description: '毛泽东选集全七卷在线阅读',
    site: context.site!,
    items: sorted.map(article => ({
      title: article.data.title,
      pubDate: article.data.date ? parseDate(article.data.date) : undefined,
      link: `/volumes/${article.id}`,
      categories: [article.data.volumeTitle],
    })),
    customData: '<language>zh-CN</language>',
  });
}

function parseDate(dateStr: string): Date {
  const yearMap: Record<string, string> = {
    '一九': '1919', '二零': '200', '一九三': '193', '一九四': '194',
    '一九五': '195', '一九六': '196', '一九七': '197',
  };
  // Try extracting year like "一九三七年七月"
  const m = dateStr.match(/(\d{4})/);
  if (m) return new Date(`${m[1]}-01-01`);
  // Fallback: return epoch
  return new Date('1930-01-01');
}
