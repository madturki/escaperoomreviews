// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync, copyFileSync } from 'node:fs';

// GitHub Pages can't redirect, so each exact-path rule in redirects.conf becomes a meta-refresh page.
// Pattern rules (uploads, pagination, catch-alls) are handled by the script in src/pages/404.astro.
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
