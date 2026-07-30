import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { articleHref, getArticlesSorted } from '../lib/volumes';

export async function GET(context: APIContext) {
  const articles = await getArticlesSorted();
  const site = context.site;
  if (!site) throw new Error('site is required in astro.config (rss)');

  return rss({
    title: '毛泽东选集',
    description: '毛泽东选集全七卷在线阅读',
    site,
    items: articles.map((a) => ({
      title: a.data.title,
      pubDate: yearDate(a.data.date),
      link: articleHref(a),
      categories: [a.data.volumeTitle],
    })),
    customData: '<language>zh-CN</language>',
  });
}

function yearDate(date?: string): Date | undefined {
  if (!date) return undefined;
  const y = /(\d{4})/.exec(date)?.[1];
  return y ? new Date(`${y}-01-01`) : undefined;
}
