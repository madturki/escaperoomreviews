#!/usr/bin/env node
/**
 * One-time importer: WordPress SQL dump -> Markdown/JSON content for the Astro site.
 *
 *   npm run import-wp                # refuses to run if content already exists
 *   npm run import-wp -- --force     # wipes generated content and re-imports
 *   npm run import-wp -- --skip-images
 *
 * Paths can be overridden with WP_SQL and WP_UPLOADS environment variables.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { unserialize } from 'php-serialize';
import { parseDump } from './sql.mjs';
import { decode, cleanHtml, rewriteMedia, rewriteLinks, htmlToMarkdown, plainText, extractShortcodes } from './content.mjs';
import { copyImages } from './images.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SQL = process.env.WP_SQL ?? path.resolve(ROOT, '../../escape_room_reviews.sql');
const UPLOADS = process.env.WP_UPLOADS ?? path.resolve(ROOT, '../../Site Backup/wp-content/uploads');
const FORCE = process.argv.includes('--force');
const SKIP_IMAGES = process.argv.includes('--skip-images');

const CONTENT = path.join(ROOT, 'src/content');
const DATA = path.join(ROOT, 'src/data');
const IMAGES_OUT = path.join(ROOT, 'public/images');
const REDIRECTS_OUT = path.join(ROOT, 'deploy/nginx/redirects.conf');
const REPORT_OUT = path.join(ROOT, 'scripts/import-wp/import-report.md');
const GENERATED_DIRS = ['reviews', 'articles', 'pages', 'venues'].map((d) => path.join(CONTENT, d));

const COUNTRIES = [
  { id: 'canada', name: 'Canada' },
  { id: 'united-states', name: 'United States' },
  { id: 'spain', name: 'Spain' },
];
const COUNTRY_OF_REGION = { ontario: 'canada', quebec: 'canada', saskatchewan: 'canada', 'new-york': 'united-states', spain: 'spain' };
const REGION_CODES = { ON: 'ontario', QC: 'quebec', SK: 'saskatchewan', NY: 'new-york', MADRID: 'spain' };
const COUNTRY_NAMES = { canada: 'canada', 'united states': 'united-states', usa: 'united-states', us: 'united-states', spain: 'spain', españa: 'spain' };
const LEGACY_GENRES = {
  horror: 'creepy',
  spooky: 'creepy',
  historical: 'historic',
  western: 'historic',
  'sci-fi': 'space',
  'tv-shows': 'books-movies',
  'real-world': 'modern-day',
};
const SKIP_PAGE_IDS = new Set(['24', '25']); // WordPress front page and posts page are rebuilt in Astro.
const POST_STATUSES = { publish: false, draft: true, private: true };

const report = {
  warnings: [],
  unknownShortcodes: new Map(),
};
const warn = (msg) => report.warnings.push(msg);

const slugify = (value) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const prune = (obj) =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)),
  );

function writeMarkdown(file, frontmatter, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fm = yaml.dump(prune(frontmatter), { lineWidth: -1, noRefs: true, quotingType: '"' });
  fs.writeFileSync(file, `---\n${fm}---\n\n${body.trim()}\n`);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function safeUnserialize(value, context) {
  if (!value || value === 'a:0:{}') return null;
  try {
    return unserialize(value, {}, { strict: false });
  } catch (err) {
    warn(`Could not unserialize ${context}: ${err.message}`);
    return null;
  }
}

const dateOnly = (value) => (value && !value.startsWith('0000') ? value.slice(0, 10) : undefined);

// ---------------------------------------------------------------------------

function guardExistingContent() {
  const existing = GENERATED_DIRS.filter((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.md')));
  if (existing.length && !FORCE) {
    console.error(
      'Content already exists in src/content. The Markdown files are now the source of truth.\n' +
        'Re-run with --force to wipe and regenerate them from the WordPress dump.',
    );
    process.exit(1);
  }
  for (const dir of GENERATED_DIRS) fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  guardExistingContent();
  console.log(`Reading ${SQL}`);
  const db = parseDump(SQL, [
    'wp_posts',
    'wp_postmeta',
    'wp_terms',
    'wp_term_taxonomy',
    'wp_term_relationships',
    'wp_options',
    'wp_redirects',
  ]);

  const posts = db.get('wp_posts');
  const postById = new Map(posts.map((p) => [p.ID, p]));
  const meta = {};
  const oldSlugs = [];
  for (const m of db.get('wp_postmeta')) {
    (meta[m.post_id] ??= {})[m.meta_key] = m.meta_value;
    if (m.meta_key === '_wp_old_slug') oldSlugs.push({ postId: m.post_id, slug: m.meta_value });
  }
  const options = Object.fromEntries(db.get('wp_options').map((o) => [o.option_name, o.option_value]));

  const terms = new Map(db.get('wp_terms').map((t) => [t.term_id, t]));
  const taxonomy = db.get('wp_term_taxonomy');
  const ttById = new Map(taxonomy.map((t) => [t.term_taxonomy_id, t]));
  const relations = {};
  for (const r of db.get('wp_term_relationships')) (relations[r.object_id] ??= []).push(ttById.get(r.term_taxonomy_id));

  const termSlug = (tt) => terms.get(tt.term_id).slug;
  const termName = (tt) => decode(terms.get(tt.term_id).name);
  const categories = taxonomy.filter((t) => t.taxonomy === 'category');
  const rootId = (slug) => categories.find((t) => t.parent === '0' && termSlug(t) === slug)?.term_id;
  const ROOT_GENRE = rootId('genre');
  const ROOT_LOCATION = rootId('location');
  const ROOT_CITY = rootId('city');

  const usedUploads = new Set();
  const attachmentUrl = (id) => {
    const file = id && meta[id]?._wp_attached_file;
    if (!file) return undefined;
    usedUploads.add(file);
    return `/images/${file}`;
  };

  // --- Taxonomies ---------------------------------------------------------
  const genreTerms = categories.filter((t) => t.parent === ROOT_GENRE);
  const regionTerms = categories.filter((t) => t.parent === ROOT_CITY);
  const regionTermIds = new Set(regionTerms.map((t) => t.term_id));
  const cityTerms = categories.filter((t) => regionTermIds.has(t.parent));
  const venueTerms = categories.filter((t) => t.parent === ROOT_LOCATION);
  const termById = new Map(categories.map((t) => [t.term_id, t]));

  const genreImages = {};
  const gallery = safeUnserialize(meta['1364']?.foogallery_attachments, 'genre gallery');
  for (const attId of Object.values(gallery ?? {})) {
    const target = meta[attId]?._foogallery_custom_url?.match(/\/category\/genre\/([^/]+)/)?.[1];
    if (target) genreImages[target] = attachmentUrl(attId);
  }

  const genres = genreTerms
    .map((t) => prune({ id: termSlug(t), name: termName(t), image: genreImages[termSlug(t)], description: decode(t.description) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const regions = regionTerms
    .map((t) => {
      const id = termSlug(t);
      if (!COUNTRY_OF_REGION[id]) warn(`Region "${id}" has no country mapping; defaulted to canada.`);
      return { id, name: termName(t), country: COUNTRY_OF_REGION[id] ?? 'canada' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const cities = cityTerms
    .map((t) => ({ id: termSlug(t), name: termName(t), region: termSlug(termById.get(t.parent)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const cityIds = new Set(cities.map((c) => c.id));
  const regionIds = new Set(regions.map((r) => r.id));
  const genreIds = new Set(genres.map((g) => g.id));

  writeJson(path.join(DATA, 'genres.json'), genres);
  writeJson(path.join(DATA, 'countries.json'), COUNTRIES);
  writeJson(path.join(DATA, 'regions.json'), regions);
  writeJson(path.join(DATA, 'cities.json'), cities);

  // --- Reviewer plugin templates -----------------------------------------
  const templates = {};
  for (const [id, t] of Object.entries(safeUnserialize(options.rwp_templates, 'rwp_templates') ?? {})) {
    const name = decode(t.template_name);
    templates[id] = {
      name,
      criteria: Object.values(t.template_criterias ?? {}).map((c) => decode(String(c))),
      format: /boxed/i.test(name) ? 'boxed' : /virtual/i.test(name) ? 'virtual' : 'room',
    };
  }

  const transformBody = (html, context) => {
    for (const sc of extractShortcodes(html)) {
      if (!['rwp_box', 'rwp-reviews-list', 'smart_post_show', 'wpsl', 'foogallery'].includes(sc.name)) {
        report.unknownShortcodes.set(sc.name, [...(report.unknownShortcodes.get(sc.name) ?? []), context]);
      }
    }
    return htmlToMarkdown(rewriteLinks(rewriteMedia(cleanHtml(html), usedUploads)));
  };

  // --- Store Locator locations --------------------------------------------
  const venueIds = new Set(venueTerms.map(termSlug));
  const locationsByVenue = new Map();
  const extraVenues = new Map();
  const venueByNameSlug = new Map(venueTerms.map((t) => [slugify(termName(t)), termSlug(t)]));
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const stores = posts.filter((p) => p.post_type === 'wpsl_stores' && p.post_status === 'publish');

  for (const s of stores) {
    const m = meta[s.ID] ?? {};
    const name = decode(s.post_title);
    const fromUrl = m.wpsl_url?.match(/\/category\/location\/([^/]+)/)?.[1];
    let venue = fromUrl && venueIds.has(fromUrl) ? fromUrl : undefined;
    venue ??= venueByNameSlug.get(slugify(name));
    venue ??= [...venueByNameSlug.entries()].find(([nameSlug]) => slugify(name).startsWith(nameSlug))?.[1];
    if (!venue) {
      venue = slugify(name);
      extraVenues.set(venue, name);
      warn(`Store "${name}" did not match a venue category; created venue "${venue}".`);
    }
    const cityName = decode(m.wpsl_city ?? '');
    const city = cityIds.has(slugify(cityName)) ? slugify(cityName) : cityName || undefined;
    const state = (m.wpsl_state ?? '').trim();
    const region =
      REGION_CODES[state.toUpperCase()] ??
      (regionIds.has(slugify(state)) ? slugify(state) : undefined) ??
      cityById.get(city)?.region;
    const countryRaw = (m.wpsl_country ?? '').trim().toLowerCase();
    const country = COUNTRY_OF_REGION[region] ?? COUNTRY_NAMES[countryRaw] ?? (countryRaw ? slugify(countryRaw) : undefined);
    if (!region) warn(`Store "${name}": could not map state "${state}" / city "${cityName}" to a region.`);
    const lat = Number(m.wpsl_lat);
    const lng = Number(m.wpsl_lng);
    if (!m.wpsl_lat || !m.wpsl_lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      warn(`Store "${name}" has no coordinates; left off the map.`);
      continue;
    }
    const website = /^https?:\/\//i.test(m.wpsl_url ?? '') && !/escaperoomreviews\.ca/i.test(m.wpsl_url) ? m.wpsl_url : undefined;
    locationsByVenue.set(venue, [
      ...(locationsByVenue.get(venue) ?? []),
      prune({
        name,
        address: [decode(m.wpsl_address ?? ''), decode(m.wpsl_address2 ?? '')].filter(Boolean).join(', '),
        city,
        region,
        postalCode: decode(m.wpsl_zip ?? '') || undefined,
        country,
        lat,
        lng,
        phone: decode(m.wpsl_phone ?? '') || undefined,
        website,
      }),
    ]);
  }

  // --- Posts (reviews + articles) ----------------------------------------
  const counts = { reviews: 0, articles: 0, drafts: 0, unreviewed: 0 };
  const postSlugById = new Map();
  const reviewsByVenue = new Map();

  for (const p of posts) {
    if (p.post_type !== 'post' || !(p.post_status in POST_STATUSES)) continue;
    const draft = POST_STATUSES[p.post_status];
    const title = decode(p.post_title) || `Untitled draft ${p.ID}`;
    const slug = p.post_name ? decodeURIComponent(p.post_name) : slugify(title) || `draft-${p.ID}`;
    postSlugById.set(p.ID, slug);
    const m = meta[p.ID] ?? {};
    const cats = (relations[p.ID] ?? []).filter((t) => t?.taxonomy === 'category');
    const tags = (relations[p.ID] ?? []).filter((t) => t?.taxonomy === 'post_tag').map(termName);

    const postGenres = cats.filter((t) => t.parent === ROOT_GENRE).map(termSlug);
    const postVenues = cats.filter((t) => t.parent === ROOT_LOCATION).map(termSlug);
    const postCities = cats.filter((t) => regionTermIds.has(t.parent)).map(termSlug);
    const postRegions = [
      ...new Set([
        ...cats.filter((t) => t.parent === ROOT_CITY).map(termSlug),
        ...cats.filter((t) => regionTermIds.has(t.parent)).map((t) => termSlug(termById.get(t.parent))),
      ]),
    ];
    if (postRegions.length > 1) warn(`${slug}: multiple regions (${postRegions.join(', ')}); using ${postRegions[0]}.`);

    const image = attachmentUrl(m._thumbnail_id);
    const imageAlt = m._thumbnail_id ? decode(meta[m._thumbnail_id]?._wp_attachment_image_alt ?? '') || undefined : undefined;
    const body = transformBody(p.post_content, slug);
    const date = dateOnly(p.post_date) ?? dateOnly(p.post_modified);
    const modified = dateOnly(p.post_modified);
    const updated = !draft && modified && modified > date ? modified : undefined;

    const rwpEntries = Object.values(safeUnserialize(m.rwp_reviews, `${slug} rwp_reviews`) ?? {});
    const isReview = rwpEntries.length > 0 || slug.startsWith('review-of') || postVenues.length > 0;
    if (draft) counts.drafts++;

    if (!isReview) {
      counts.articles++;
      writeMarkdown(
        path.join(CONTENT, 'articles', `${slug}.md`),
        {
          title,
          date,
          updated,
          description: decode(m._yoast_wpseo_metadesc ?? '') || plainText(p.post_content),
          image,
          imageAlt,
          tags,
          genres: postGenres,
          region: postRegions[0],
          draft: draft || undefined,
        },
        body,
      );
      continue;
    }

    counts.reviews++;
    if (rwpEntries.length > 1) warn(`${slug}: ${rwpEntries.length} Reviewer boxes; only the first was imported.`);
    if (postVenues.length > 1) warn(`${slug}: multiple venues (${postVenues.join(', ')}); using ${postVenues[0]}.`);
    if (!postVenues.length) warn(`${slug}: review has no venue category.`);
    const venueLocations = locationsByVenue.get(postVenues[0]) ?? [];
    if (!postRegions.length && venueLocations.length) {
      postRegions.push(...new Set(venueLocations.map((l) => l.region).filter(Boolean)));
      postCities.push(...new Set(venueLocations.map((l) => l.city).filter((c) => cityIds.has(c))));
      warn(`${slug}: no city category; used venue location (${postRegions.join(', ')} / ${postCities.join(', ') || 'no city'}).`);
    }
    if (!postRegions.length && !postGenres.includes('virtual')) warn(`${slug}: review has no region/city category.`);

    const r = rwpEntries[0];
    const tpl = r && templates[r.review_template];
    const criteria = r
      ? Object.values(r.review_scores ?? {}).map((s, i) => ({ name: tpl?.criteria[i] ?? `Criterion ${i + 1}`, score: Number(s) }))
      : [];
    let score = null;
    if (r?.review_custom_overall_score !== undefined && String(r.review_custom_overall_score).trim() !== '') {
      score = Number(r.review_custom_overall_score);
    } else if (m.rwp_reviewer_score) {
      score = Number(m.rwp_reviewer_score);
    } else if (criteria.length) {
      score = criteria.reduce((sum, c) => sum + c.score, 0) / criteria.length;
    }
    if (score !== null) score = Math.round(score * 100) / 100;
    const reviewed = score !== null && score > 0;
    if (!reviewed) counts.unreviewed++;
    const links = Object.values(r?.review_custom_links ?? {});
    const bookingRaw = links.find((l) => /book/i.test(l.label ?? ''))?.url ?? links[0]?.url;
    const booking = bookingRaw ? decode(bookingRaw) : undefined;
    const summary = r ? decode(r.review_summary ?? '') : '';
    const format = tpl?.format ?? (postGenres.includes('virtual') && !postVenues.length ? 'virtual' : 'room');

    const venue = postVenues[0];
    if (venue) reviewsByVenue.set(venue, [...(reviewsByVenue.get(venue) ?? []), { slug, tags, booking }]);
    const pluginTitle = r ? decode(r.review_title ?? '') : '';
    const quotedTitle = title.match(/[“"]([^”"]+)[”"]/)?.[1];
    const room = pluginTitle && !/^review box \d+$/i.test(pluginTitle) ? pluginTitle : quotedTitle;

    writeMarkdown(
      path.join(CONTENT, 'reviews', `${slug}.md`),
      {
        title,
        room,
        date,
        updated,
        venue,
        region: postRegions[0],
        cities: postCities,
        genres: postGenres,
        tags,
        format,
        reviewed,
        score: reviewed ? score : undefined,
        criteria: reviewed ? criteria : undefined,
        summary: summary || undefined,
        bookingUrl: booking,
        image,
        imageAlt,
        description: decode(m._yoast_wpseo_metadesc ?? '') || plainText(summary || p.post_content),
        draft: draft || undefined,
      },
      body,
    );
  }

  // --- Venues --------------------------------------------------------------
  const allVenues = [
    ...venueTerms.map((t) => ({ id: termSlug(t), name: termName(t), description: decode(t.description) })),
    ...[...extraVenues].map(([id, name]) => ({ id, name, description: '' })),
  ];
  for (const v of allVenues) {
    const locations = (locationsByVenue.get(v.id) ?? []).map(({ website, ...loc }) => loc);
    const website = (locationsByVenue.get(v.id) ?? []).find((l) => l.website)?.website;
    const venueReviews = reviewsByVenue.get(v.id) ?? [];
    if (venueReviews.length && venueReviews.every((r) => r.tags.some((t) => t.toLowerCase() === 'closed'))) {
      warn(`Venue "${v.id}": every review is tagged "closed"; consider setting closed: true.`);
    }
    writeMarkdown(path.join(CONTENT, 'venues', `${v.id}.md`), { name: v.name, website, locations }, v.description);
  }

  // --- Pages --------------------------------------------------------------
  const scopeFor = (value) => {
    if (!value) return {};
    const s = slugify(value);
    if (cityIds.has(s)) return { city: s };
    if (regionIds.has(s)) return { region: s };
    const country = COUNTRIES.find((c) => c.id === s);
    return country ? { country: country.id } : {};
  };
  let pageCount = 0;
  for (const p of posts) {
    if (p.post_type !== 'page' || p.post_status !== 'publish' || SKIP_PAGE_IDS.has(p.ID)) continue;
    const slug = decodeURIComponent(p.post_name);
    const shortcodes = extractShortcodes(p.post_content);
    let map;
    let reviewList;
    const wpsl = shortcodes.find((s) => s.name === 'wpsl');
    if (wpsl) map = scopeFor(wpsl.attrs.start_location);
    const list = shortcodes.find((s) => s.name === 'rwp-reviews-list');
    if (list) {
      const tpl = templates[list.attrs.template];
      const limit = Number(decode(p.post_title).match(/top\s+(\d+)/i)?.[1]) || undefined;
      reviewList = { ...scopeFor(tpl?.name.split(' - ').pop()), format: tpl?.format ?? 'room', sort: 'score', ranked: true, limit };
    } else if (shortcodes.some((s) => s.name === 'smart_post_show')) {
      reviewList = { ...(map ?? {}), sort: 'score' };
    }
    pageCount++;
    writeMarkdown(
      path.join(CONTENT, 'pages', `${slug}.md`),
      {
        title: decode(p.post_title),
        description: plainText(p.post_content),
        updated: dateOnly(p.post_modified),
        reviewList,
        map,
        ads: /adsbygoogle/.test(p.post_content) || undefined,
        contact: slug === 'inquire' || undefined,
      },
      transformBody(p.post_content, slug),
    );
  }

  // --- Legacy /review/<name>/ links (from an older review plugin) ---------
  const allSlugs = [...postSlugById.values()];
  const legacyReviewTargets = new Map();
  const resolveLegacyReview = (name) => {
    const n = name.replace(/-escape-room$/, '');
    const candidates = [n, `review-of-${n}`, n.replace(/^review-of-/, 'review-of-')];
    return (
      allSlugs.find((s) => candidates.includes(s)) ??
      allSlugs.find((s) => s.startsWith(`review-of-${n.replace(/^review-of-/, '')}-at-`)) ??
      allSlugs.find((s) => s.startsWith(`review-of-the-${n.replace(/^review-of-/, '')}-at-`)) ??
      allSlugs.find((s) => s.startsWith(`review-of-${n.replace(/^review-of-/, '').replace(/-at-.*/, '')}`))
    );
  };
  for (const dir of ['reviews', 'articles', 'pages']) {
    for (const file of fs.readdirSync(path.join(CONTENT, dir))) {
      const full = path.join(CONTENT, dir, file);
      const text = fs.readFileSync(full, 'utf8');
      const fixed = text.replace(/\]\(\/review\/([^/)\s]+)\/?\)/g, (m, name) => {
        const target = resolveLegacyReview(name);
        if (!target) {
          warn(`${file}: could not resolve legacy link /review/${name}/`);
          return m;
        }
        legacyReviewTargets.set(name, target);
        return `](/${target}/)`;
      });
      if (fixed !== text) fs.writeFileSync(full, fixed);
    }
  }

  // --- Redirects ----------------------------------------------------------
  const redirectLines = [
    '# Generated by scripts/import-wp. Included inside the escaperoomreviews.ca server block.',
    '# Feeds and pagination',
    'rewrite ^/feed/?$ /rss.xml permanent;',
    'rewrite ^/comments/feed/?$ /rss.xml permanent;',
    'rewrite ^/.+/feed/?$ /rss.xml permanent;',
    'rewrite ^/page/\\d+/?$ /blog/ permanent;',
    'rewrite ^/blog/page/\\d+/?$ /blog/ permanent;',
    'rewrite ^/author/.*$ / permanent;',
    'rewrite ^/home/?$ / permanent;',
    '',
    '# Uploaded images moved to /images/ (WordPress size variants map to the original file)',
    'rewrite "^/wp-content/uploads/(.+?)(-\\d+x\\d+)?\\.(jpe?g|png|gif|webp|avif)$" /images/$1.$3 permanent;',
    '',
    '# Redirects from the EPS 301 Redirects plugin',
  ];
  for (const r of db.get('wp_redirects')) {
    const target = /^\d+$/.test(r.url_to) ? postSlugById.get(r.url_to) ?? decodeURIComponent(postById.get(r.url_to)?.post_name ?? '') : r.url_to;
    if (!target) {
      warn(`Redirect "${r.url_from}" points to unknown post ${r.url_to}.`);
      continue;
    }
    const to = /^https?:/.test(target) ? target : `/${target.replace(/^\/|\/$/g, '')}/`;
    redirectLines.push(`rewrite ^/${r.url_from.replace(/^\/|\/$/g, '')}/?$ ${to} permanent;`);
  }
  redirectLines.push('', '# Old post slugs');
  const liveSlugs = new Set([
    ...postSlugById.values(),
    ...posts.filter((p) => p.post_type === 'page' && p.post_status === 'publish').map((p) => decodeURIComponent(p.post_name)),
  ]);
  for (const { postId, slug } of oldSlugs) {
    const current = postSlugById.get(postId);
    if (!current || current === slug) continue;
    if (liveSlugs.has(slug)) {
      warn(`Old slug "${slug}" is now used by another post; no redirect created.`);
      continue;
    }
    redirectLines.push(`rewrite ^/${slug}/?$ /${current}/ permanent;`);
  }
  redirectLines.push('', '# Legacy /review/<name>/ URLs from an older review plugin');
  for (const [name, target] of legacyReviewTargets) redirectLines.push(`rewrite ^/review/${name}/?$ /${target}/ permanent;`);
  redirectLines.push('rewrite ^/review/.*$ /blog/ permanent;');
  redirectLines.push('', '# Legacy /reviews/... menu URLs from the original theme');
  for (const c of cities) redirectLines.push(`rewrite (?i)^/reviews/cities/${c.id}/?$ /category/city/${c.region}/${c.id}/ permanent;`);
  for (const id of venueIds) redirectLines.push(`rewrite (?i)^/reviews/locations/${id}/?$ /category/location/${id}/ permanent;`);
  for (const [legacy, genre] of Object.entries(LEGACY_GENRES)) {
    if (genreIds.has(genre)) redirectLines.push(`rewrite (?i)^/reviews/genres/${legacy}/?$ /category/genre/${genre}/ permanent;`);
  }
  for (const id of genreIds) redirectLines.push(`rewrite (?i)^/reviews/genres/${id}/?$ /category/genre/${id}/ permanent;`);
  redirectLines.push(
    'rewrite (?i)^/reviews/cities/.*$ /category/city/ permanent;',
    'rewrite (?i)^/reviews/locations/.*$ /category/location/ permanent;',
    'rewrite (?i)^/reviews/genres/.*$ /category/genre/ permanent;',
    '',
  );
  fs.mkdirSync(path.dirname(REDIRECTS_OUT), { recursive: true });
  fs.writeFileSync(REDIRECTS_OUT, redirectLines.join('\n'));

  // --- Images -------------------------------------------------------------
  let images = { copied: [], missing: [], rejected: [] };
  if (!SKIP_IMAGES) {
    console.log(`Copying ${usedUploads.size} referenced images...`);
    images = await copyImages(usedUploads, UPLOADS, IMAGES_OUT);
  }

  // --- Report -------------------------------------------------------------
  const lines = [
    '# WordPress import report',
    '',
    `Generated ${new Date().toISOString()} from \`${path.relative(ROOT, SQL)}\`.`,
    '',
    '| Item | Count |',
    '| --- | --- |',
    `| Reviews | ${counts.reviews} (${counts.unreviewed} not yet reviewed) |`,
    `| Articles | ${counts.articles} |`,
    `| Drafts (not published) | ${counts.drafts} |`,
    `| Pages | ${pageCount} |`,
    `| Venues | ${allVenues.length} |`,
    `| Map locations | ${[...locationsByVenue.values()].flat().length} |`,
    `| Genres / regions / cities | ${genres.length} / ${regions.length} / ${cities.length} |`,
    `| Images copied | ${SKIP_IMAGES ? 'skipped' : images.copied.length} |`,
    '',
    '## Warnings',
    '',
    ...(report.warnings.length ? report.warnings.map((w) => `- ${w}`) : ['None.']),
    '',
    '## Unknown shortcodes (removed)',
    '',
    ...(report.unknownShortcodes.size
      ? [...report.unknownShortcodes].map(([name, where]) => `- \`[${name}]\` in ${[...new Set(where)].join(', ')}`)
      : ['None.']),
    '',
    '## Missing images (referenced but not found in uploads)',
    '',
    ...(images.missing.length ? images.missing.map((f) => `- ${f}`) : ['None.']),
    '',
    '## Rejected files (not an image type)',
    '',
    ...(images.rejected.length ? images.rejected.map((f) => `- ${f}`) : ['None.']),
    '',
  ];
  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  console.log(lines.slice(4, 15).join('\n'));
  console.log(`\nReport written to ${path.relative(ROOT, REPORT_OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
