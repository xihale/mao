import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

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
