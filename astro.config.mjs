// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync, copyFileSync } from 'node:fs';

// GitHub Pages can't redirect, so each rule becomes a meta-refresh page.
// Upload, pagination, and other pattern rules stay in the script in src/pages/404.astro.
const unreviewedReviewSlugs = new Set(
  readdirSync(new URL('./src/content/reviews/', import.meta.url))
    .filter((file) => file.endsWith('.md'))
    .filter((file) => {
      const text = readFileSync(new URL(`./src/content/reviews/${file}`, import.meta.url), 'utf8');
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      return /^reviewed:\s*false\s*$/m.test(frontmatter);
    })
    .map((file) => file.slice(0, -3)),
);

const redirects = Object.fromEntries(
  [...readFileSync(new URL('./deploy/nginx/redirects.conf', import.meta.url), 'utf8')
    .matchAll(/^rewrite (?:\(\?i\))?\^\/([\w\/-]+?)\/\?\$ (\S*\/) permanent;$/gm)]
    .map(([, from, to]) => [`/${from}/`, to]),
);

// GitHub Pages only receives the exact rules above. Feed and date-archive
// patterns, and unreviewed room URLs, otherwise come back as 404s.
const addRedirect = (from, to) => {
  if (!redirects[from]) redirects[from] = to;
};
const markdownSlugs = (dir) =>
  readdirSync(new URL(dir, import.meta.url))
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -3));
const jsonIds = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).map((entry) => entry.id);

// An absolute URL keeps the .xml target. A site path matches the RSS route,
// and trailingSlash then turns it into /rss.xml/, which does not exist.
const rss = 'https://www.escaperoomreviews.ca/rss.xml';
addRedirect('/feed/', rss);
addRedirect('/comments/feed/', rss);
addRedirect('/2024/09/', '/blog/');
addRedirect('/category/city/ontario/markham/feed/', rss);

for (const slug of [
  ...markdownSlugs('./src/content/reviews/'),
  ...markdownSlugs('./src/content/articles/'),
  ...markdownSlugs('./src/content/pages/'),
  ...markdownSlugs('./src/content/venues/'),
]) {
  addRedirect(`/${slug}/feed/`, rss);
}
for (const id of jsonIds('./src/data/genres.json')) addRedirect(`/category/genre/${id}/feed/`, rss);
for (const id of jsonIds('./src/data/regions.json')) addRedirect(`/category/city/${id}/feed/`, rss);
for (const city of JSON.parse(readFileSync(new URL('./src/data/cities.json', import.meta.url), 'utf8'))) {
  addRedirect(`/category/city/${city.region}/${city.id}/feed/`, rss);
}
for (const slug of unreviewedReviewSlugs) addRedirect(`/${slug}/`, '/on-our-list/');

export default defineConfig({
  site: 'https://www.escaperoomreviews.ca',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  redirects,
  integrations: [
    sitemap({
      filter: (page) => {
        if (/\/(search|country)\/$/.test(page)) return false;
        const slug = new URL(page).pathname.replace(/^\/|\/$/g, '');
        return !unreviewedReviewSlugs.has(slug);
      },
    }),
    {
      name: 'sitemap-xml',
      hooks: {
        'astro:build:done': ({ dir }) => copyFileSync(new URL('sitemap-0.xml', dir), new URL('sitemap.xml', dir)),
      },
    },
  ],
});
