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
const cities = JSON.parse(readFileSync(new URL('./src/data/cities.json', import.meta.url), 'utf8'));
for (const city of cities) {
  addRedirect(`/category/city/${city.region}/${city.id}/feed/`, rss);
}
for (const slug of unreviewedReviewSlugs) addRedirect(`/${slug}/`, '/on-our-list/');

// Old WordPress tag, venue-feed, and archive pages. Real tag pages stay.
const slugify = (value) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const tagSlugs = new Set();
for (const dir of ['./src/content/reviews/', './src/content/articles/']) {
  for (const file of readdirSync(new URL(dir, import.meta.url)).filter((name) => name.endsWith('.md'))) {
    const text = readFileSync(new URL(`${dir}${file}`, import.meta.url), 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    // Tag pages are built from published reviews and articles only.
    if (/^draft:\s*true\s*$/m.test(frontmatter)) continue;
    if (dir.includes('reviews') && /^reviewed:\s*false\s*$/m.test(frontmatter)) continue;
    const tags = frontmatter.match(/^tags:\n((?:  - .*\n?)*)/m)?.[1] ?? '';
    for (const item of tags.matchAll(/^  - (.*)$/gm)) {
      const slug = slugify(item[1].trim().replace(/^['"]|['"]$/g, ''));
      if (slug) tagSlugs.add(slug);
    }
  }
}
for (const slug of tagSlugs) addRedirect(`/tag/${slug}/feed/`, rss);
for (const id of markdownSlugs('./src/content/venues/')) {
  addRedirect(`/category/location/${id}/feed/`, rss);
  if (!tagSlugs.has(id)) addRedirect(`/tag/${id}/`, `/category/location/${id}/`);
}
for (const city of cities) {
  if (!tagSlugs.has(city.id)) addRedirect(`/tag/${city.id}/`, `/category/city/${city.region}/${city.id}/`);
}
addRedirect('/tag/breakout/', '/category/location/');
addRedirect('/tag/breakout/feed/', rss);
addRedirect('/tag/ready-set-go/', '/category/location/ready-set-go-adventures/');
addRedirect('/tag/ready-set-go/feed/', rss);
for (const slug of ['bar', 'beer', 'musical', 'guelph', 'prohibition']) addRedirect(`/tag/${slug}/feed/`, rss);

for (let page = 2; page <= 21; page += 1) addRedirect(`/blog/page/${page}/`, '/blog/');
for (let page = 2; page <= 21; page += 1) addRedirect(`/page/${page}/`, '/blog/');
for (let page = 2; page <= 19; page += 1) addRedirect(`/category/city/page/${page}/`, '/category/city/');
for (let page = 2; page <= 16; page += 1) addRedirect(`/category/city/ontario/page/${page}/`, '/category/city/ontario/');
for (let page = 2; page <= 17; page += 1) addRedirect(`/author/admin/page/${page}/`, '/');
for (const path of [
  '/category/city/ontario/burlington/page/2/',
  '/category/city/ontario/mississauga/page/2/',
  '/category/city/ontario/toronto/page/3/',
  '/tag/ontario/page/3/',
  '/tag/toronto/page/2/',
]) {
  const parent = path.replace(/page\/\d+\/$/, '');
  addRedirect(path, redirects[parent] || parent);
}
addRedirect('/category/genre/modern-day/page/3/', '/category/genre/others/');

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
