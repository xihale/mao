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

function parseDate(dateStr: string): Date | undefined {
  const m = dateStr.match(/(\d{4})/);
  return m ? new Date(`${m[1]}-01-01`) : undefined;
}
