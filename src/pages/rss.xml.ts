import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getArticlesSorted } from '../lib/volumes';

export async function GET(context: APIContext) {
  const articles = await getArticlesSorted();

  return rss({
    title: '毛泽东选集',
    description: '毛泽东选集全七卷在线阅读',
    site: context.site!,
    items: articles.map((article) => ({
      title: article.data.title,
      pubDate: article.data.date ? parseYear(article.data.date) : undefined,
      link: `/${article.data.volume}/${article.data.order}`,
      categories: [article.data.volumeTitle],
    })),
    customData: '<language>zh-CN</language>',
  });
}

function parseYear(dateStr: string): Date | undefined {
  const m = dateStr.match(/(\d{4})/);
  return m?.[1] ? new Date(`${m[1]}-01-01`) : undefined;
}
