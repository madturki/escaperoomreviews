import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../site.config';
import { getReviews, getArticles } from '../lib/data';

export async function GET(context: APIContext) {
  const [reviews, articles] = await Promise.all([getReviews(), getArticles()]);
  const items = [...reviews.filter((r) => r.data.reviewed), ...articles]
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .slice(0, 50)
    .map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.date,
      description: entry.data.description,
      link: `/${entry.id}/`,
    }));
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items,
    trailingSlash: true,
  });
}
