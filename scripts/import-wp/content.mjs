import TurndownService from 'turndown';
import { decodeHTML } from 'entities';

const SITE_HOST_RE = /^(?:https?:)?\/\/(?:www\.)?escaperoomreviews\.ca/i;
const UPLOAD_RE = /(?:(?:https?:)?\/\/(?:www\.)?escaperoomreviews\.ca)?\/wp-content\/uploads\/([^"'\s)?#]+)/gi;
const SIZE_SUFFIX_RE = /-\d+x\d+(?=\.[a-z0-9]+$)/i;
const SHORTCODE_RE = /\[\/?[a-zA-Z_-]+(?:\s[^\]]*)?\]/g;

export function decode(text = '') {
  return decodeHTML(text).replace(/\u00a0/g, ' ').trim();
}

/** Upload path relative to wp-content/uploads with any WordPress thumbnail size suffix removed. */
export function originalUploadPath(path) {
  return decodeURIComponent(path).replace(SIZE_SUFFIX_RE, '');
}

function autop(html) {
  if (/<p[\s>]/i.test(html)) return html;
  return html
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (/^<(h\d|ul|ol|blockquote|figure|table|div|hr)/i.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, '<br>')}</p>`))
    .join('\n');
}

/** Strips WordPress/plugin markup that has no place in a static site. */
export function cleanHtml(html) {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/<div id="mc_embed_signup"[\s\S]*?<\/form>\s*<\/div>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<figure class="wp-block-embed[^"]*">\s*<div class="wp-block-embed__wrapper">\s*(\S+)\s*<\/div>\s*<\/figure>/gi, '<p><a href="$1">$1</a></p>');
  out = out.replace(SHORTCODE_RE, '');
  return autop(out);
}

/** Rewrites upload URLs to /images/... and collects the files that need copying. */
export function rewriteMedia(html, usedUploads) {
  return html
    .replace(/\s(srcset|sizes)="[^"]*"/gi, '')
    .replace(UPLOAD_RE, (_m, path) => {
      const original = originalUploadPath(path);
      usedUploads.add(original);
      return `/images/${original}`;
    });
}

export function rewriteLinks(html) {
  return html.replace(/href="([^"]+)"/gi, (m, href) => {
    if (!SITE_HOST_RE.test(href)) return m;
    let path = href.replace(SITE_HOST_RE, '') || '/';
    if (!path.startsWith('/')) path = `/${path}`;
    if (!/[?#.]/.test(path.split('/').pop()) && !path.endsWith('/')) path += '/';
    return `href="${path}"`;
  });
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  hr: '---',
});
turndown.keep(['table', 'iframe', 'video']);
turndown.remove(['button', 'input', 'label', 'select', 'textarea']);
turndown.addRule('figcaption', {
  filter: 'figcaption',
  replacement: (content) => (content.trim() ? `\n\n_${content.trim()}_\n\n` : ''),
});

export function htmlToMarkdown(html) {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainText(html, max = 160) {
  const text = decode(html.replace(/<[^>]+>/g, ' ').replace(SHORTCODE_RE, ' ')).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export function extractShortcodes(html) {
  const result = [];
  for (const m of html.matchAll(/\[([a-zA-Z_-]+)((?:\s[^\]]*)?)\]/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z_]+)=["“”]([^"“”]*)["“”]/g)) attrs[a[1]] = a[2];
    result.push({ name: m[1], attrs });
  }
  return result;
}
