// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync, copyFileSync } from 'node:fs';

// GitHub Pages can't redirect, so each exact-path rule in redirects.conf becomes a meta-refresh page.
// Pattern rules (uploads, pagination, catch-alls) are handled by the script in src/pages/404.astro.
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
      filter: (page) => !/\/(search|country)\/$/.test(page),
    }),
    {
      name: 'sitemap-xml',
      hooks: {
        'astro:build:done': ({ dir }) => copyFileSync(new URL('sitemap-0.xml', dir), new URL('sitemap.xml', dir)),
      },
    },
  ],
});
