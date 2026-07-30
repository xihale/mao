import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'volumes'>;

export const VOLUME_LABELS: Record<number, string> = {
  1: '第一卷',
  2: '第二卷',
  3: '第三卷',
  4: '第四卷',
  5: '第五卷',
  6: '第六卷（静火版）',
  7: '第七卷（静火版）',
};

export const VOLUME_NUMS = [1, 2, 3, 4, 5, 6, 7] as const;

export function sortArticles(a: Article, b: Article): number {
  return a.data.volume - b.data.volume || a.data.order - b.data.order;
}

export async function getArticlesSorted(): Promise<Article[]> {
  return (await getCollection('volumes')).sort(sortArticles);
}
