import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

const criterion = z.object({
  name: z.string(),
  score: z.number(),
});

const reviews = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/reviews' }),
  schema: z.object({
    title: z.string(),
    room: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    venue: z.string().optional(),
    region: z.string().optional(),
    cities: z.array(z.string()).default([]),
    genres: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    format: z.enum(['room', 'boxed', 'virtual', 'outdoor']).default('room'),
    reviewed: z.boolean().default(true),
    score: z.number().nullable().optional(),
    criteria: z.array(criterion).default([]),
    summary: z.string().optional(),
    bookingUrl: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    genres: z.array(z.string()).default([]),
    region: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    updated: z.coerce.date().optional(),
    reviewList: z
      .object({
        country: z.string().optional(),
        region: z.string().optional(),
        city: z.string().optional(),
        venue: z.string().optional(),
        format: z.enum(['room', 'boxed', 'virtual', 'outdoor']).optional(),
        sort: z.enum(['score', 'date']).default('score'),
        limit: z.number().optional(),
        ranked: z.boolean().default(false),
      })
      .optional(),
    map: z
      .object({
        country: z.string().optional(),
        region: z.string().optional(),
        city: z.string().optional(),
      })
      .optional(),
    ads: z.boolean().default(false),
    contact: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const venues = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/venues' }),
  schema: z.object({
    name: z.string(),
    website: z.string().optional(),
    closed: z.boolean().default(false),
    locations: z
      .array(
        z.object({
          name: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          region: z.string().optional(),
          postalCode: z.string().optional(),
          country: z.string().optional(),
          lat: z.number(),
          lng: z.number(),
          phone: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

const genres = defineCollection({
  loader: file('./src/data/genres.json'),
  schema: z.object({
    name: z.string(),
    image: z.string().optional(),
    description: z.string().optional(),
  }),
});

const countries = defineCollection({
  loader: file('./src/data/countries.json'),
  schema: z.object({ name: z.string() }),
});

const regions = defineCollection({
  loader: file('./src/data/regions.json'),
  schema: z.object({
    name: z.string(),
    country: z.string(),
  }),
});

const cities = defineCollection({
  loader: file('./src/data/cities.json'),
  schema: z.object({
    name: z.string(),
    region: z.string(),
  }),
});

export const collections = { reviews, articles, pages, venues, genres, countries, regions, cities };
