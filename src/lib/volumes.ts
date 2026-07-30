import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'volumes'>;

export interface VolumeGroup {
  volume: number;
  label: string;
  articles: Article[];
}

export function articleHref(a: Article): string {
  return `/${a.data.volume}/${a.data.order}`;
}

export async function getArticlesSorted(): Promise<Article[]> {
  return (await getCollection('volumes')).sort(
    (a, b) => a.data.volume - b.data.volume || a.data.order - b.data.order,
  );
}

/** Assumes `articles` already sorted by volume then order. */
export function groupByVolume(articles: Article[]): VolumeGroup[] {
  const map = new Map<number, VolumeGroup>();
  for (const a of articles) {
    let g = map.get(a.data.volume);
    if (!g) {
      g = { volume: a.data.volume, label: a.data.volumeTitle, articles: [] };
      map.set(a.data.volume, g);
    }
    g.articles.push(a);
  }
  return [...map.values()];
}
