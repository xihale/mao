import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const volumes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/volumes' }),
  schema: z.object({
    title: z.string(),
    volume: z.number(),
    volumeTitle: z.string(),
    order: z.number(),
    period: z.string().optional(),
    date: z.string().optional(),
  }),
});

export const collections = { volumes };
