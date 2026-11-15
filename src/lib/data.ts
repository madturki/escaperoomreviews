import { getCollection, type CollectionEntry } from 'astro:content';

export type Review = CollectionEntry<'reviews'>;
export type Article = CollectionEntry<'articles'>;
export type Venue = CollectionEntry<'venues'>;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const isPublished = ({ data }: { data: { draft: boolean } }) => import.meta.env.DEV || !data.draft;

export async function getReviews(): Promise<Review[]> {
  const reviews = await getCollection('reviews', isPublished);
  return reviews.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getArticles(): Promise<Article[]> {
  const [articles, reviews, tax] = await Promise.all([getCollection('articles', isPublished), getReviews(), getTaxonomies()]);
  return articles
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((article) => withCover(article, reviews, tax));
}

export async function getTaxonomies() {
  const [genres, countries, regions, cities, venues] = await Promise.all([
    getCollection('genres'),
    getCollection('countries'),
    getCollection('regions'),
    getCollection('cities'),
    getCollection('venues'),
  ]);
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
  return {
    genres: byId(genres),
    countries: byId(countries),
    regions: byId(regions),
    cities: byId(cities),
    venues: byId(venues),
  };
}

export type Taxonomies = Awaited<ReturnType<typeof getTaxonomies>>;

export function countryOfRegion(tax: Taxonomies, regionId?: string) {
  return regionId ? tax.regions.get(regionId)?.data.country : undefined;
}

export function sortByScore(reviews: Review[]): Review[] {
  return [...reviews].sort((a, b) => (b.data.score ?? -1) - (a.data.score ?? -1));
}

export function roomName(review: Review): string {
  const quoted = review.data.title.match(/^Review of ["“](.+?)["”] at /);
  if (quoted) return quoted[1];
  if (review.data.room) return review.data.room.replace(/\s+[(-].*$/, '').trim();
  return review.data.title;
}

export function bookingHref(bookingUrl: string, room: string): string {
  const params = new URLSearchParams({
    utm_source: 'escaperoomreviews.ca',
    utm_medium: 'referral',
    utm_content: room,
  });
  try {
    const url = new URL(bookingUrl);
    for (const [key, value] of params) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    const joiner = bookingUrl.includes('?') ? '&' : '?';
    return `${bookingUrl}${joiner}${params.toString()}`;
  }
}

function unwrap(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('“') && trimmed.endsWith('”'))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function reviewBlurb(review: Review): string {
  const summary = review.data.summary ? unwrap(review.data.summary) : '';
  if (summary) return summary;
  const description = review.data.description ? unwrap(review.data.description) : '';
  if (description && !/^escape room booking/i.test(description)) return description;
  const paragraph = review.body
    ?.split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('#') && !part.startsWith('!'));
  if (!paragraph) return '';
  const plain = paragraph
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= 280) return plain;
  return `${plain.slice(0, 277).replace(/\s+\S*$/, '')}…`;
}

export function isClosed(review: Review, tax: Taxonomies): boolean {
  return (
    review.data.tags.some((tag) => tag.toLowerCase() === 'closed') ||
    !!(review.data.venue && tax.venues.get(review.data.venue)?.data.closed)
  );
}

export function genreCover(reviews: Review[], genreId: string): { image: string; imageAlt?: string } | undefined {
  const best = sortByScore(
    reviews.filter(
      (review) => review.data.reviewed && review.data.score != null && review.data.image && review.data.genres.includes(genreId),
    ),
  )[0];
  if (!best?.data.image) return undefined;
  return { image: best.data.image, imageAlt: best.data.imageAlt };
}

function withGenreCover(article: Article, reviews: Review[]): Article {
  const genreId = article.data.bestOfGenre;
  if (!genreId) return article;
  const cover = genreCover(reviews, genreId);
  if (!cover) return article;
  return { ...article, data: { ...article.data, image: cover.image, imageAlt: cover.imageAlt } };
}

export interface VenueRanking {
  venueId: string;
  average: number;
  reviews: Review[];
  top: Review;
}

export function topVenues(reviews: Review[], tax: Taxonomies, regionId: string, limit = 10): VenueRanking[] {
  const groups = new Map<string, Review[]>();
  for (const review of reviews) {
    if (review.data.region !== regionId || review.data.score == null || !review.data.venue) continue;
    if (isClosed(review, tax)) continue;
    const list = groups.get(review.data.venue) ?? [];
    list.push(review);
    groups.set(review.data.venue, list);
  }
  return [...groups.entries()]
    .map(([venueId, list]) => {
      const ranked = sortByScore(list);
      const average = ranked.reduce((sum, review) => sum + (review.data.score ?? 0), 0) / ranked.length;
      return { venueId, average, reviews: ranked, top: ranked[0] };
    })
    .sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average;
      if (b.reviews.length !== a.reviews.length) return b.reviews.length - a.reviews.length;
      const topScore = (b.top.data.score ?? 0) - (a.top.data.score ?? 0);
      if (topScore) return topScore;
      const name = (id: string) => tax.venues.get(id)?.data.name ?? id;
      return name(a.venueId).localeCompare(name(b.venueId));
    })
    .slice(0, limit);
}

function withCover(article: Article, reviews: Review[], tax: Taxonomies): Article {
  if (article.data.bestOfGenre) return withGenreCover(article, reviews);
  if (article.data.image || !article.data.topVenues) return article;
  const ranking = topVenues(reviews, tax, article.data.topVenues, 1)[0];
  const image = ranking?.top.data.image;
  if (!ranking || !image) return article;
  const venueName = tax.venues.get(ranking.venueId)?.data.name ?? 'the venue';
  return {
    ...article,
    data: { ...article.data, image, imageAlt: article.data.imageAlt ?? `${roomName(ranking.top)} at ${venueName}` },
  };
}

export function bestInGenre(reviews: Review[], genreId: string): Review[] {
  return reviews
    .filter((review) => review.data.reviewed && review.data.score != null && review.data.score >= 8 && review.data.genres.includes(genreId))
    .sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0) || roomName(a).localeCompare(roomName(b)))
    .slice(0, 10);
}

export interface ReviewFilter {
  country?: string;
  region?: string;
  city?: string;
  venue?: string;
  format?: string;
}

export function filterReviews(reviews: Review[], tax: Taxonomies, f: ReviewFilter): Review[] {
  return reviews.filter(({ data }) => {
    if (f.region && data.region !== f.region) return false;
    if (f.country && countryOfRegion(tax, data.region) !== f.country) return false;
    if (f.city && !data.cities.includes(f.city)) return false;
    if (f.venue && data.venue !== f.venue) return false;
    if (f.format && data.format !== f.format) return false;
    return true;
  });
}

export const url = {
  post: (id: string) => `/${id}/`,
  genre: (id: string) => `/category/genre/${id}/`,
  venue: (id: string) => `/category/location/${id}/`,
  region: (id: string) => `/category/city/${id}/`,
  city: (regionId: string, id: string) => `/category/city/${regionId}/${id}/`,
  country: (id: string) => `/country/${id}/`,
  tag: (name: string) => `/tag/${slugify(name)}/`,
};

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function scoreClass(score?: number | null): string {
  if (score == null) return 'score--none';
  if (score >= 8.5) return 'score--top';
  if (score >= 7.5) return 'score--high';
  if (score >= 6) return 'score--mid';
  return 'score--low';
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export interface MapPin {
  venue: string;
  venueName: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  url: string;
  reviewCount: number;
  topScore: number | null;
  region?: string;
  country?: string;
  city?: string;
}

export function buildPins(tax: Taxonomies, reviews: Review[], f: { country?: string; region?: string; city?: string } = {}): MapPin[] {
  const pins: MapPin[] = [];
  for (const venue of tax.venues.values()) {
    if (venue.data.closed) continue;
    const venueReviews = reviews.filter((r) => r.data.venue === venue.id);
    const scores = venueReviews.map((r) => r.data.score).filter((s): s is number => s != null);
    for (const loc of venue.data.locations) {
      const country = loc.country ?? countryOfRegion(tax, loc.region);
      if (f.region && loc.region !== f.region) continue;
      if (f.country && country !== f.country) continue;
      if (f.city && loc.city !== f.city) continue;
      pins.push({
        venue: venue.id,
        venueName: venue.data.name,
        name: loc.name ?? venue.data.name,
        address: [
          loc.address,
          loc.city && (tax.cities.get(loc.city)?.data.name ?? loc.city),
          loc.region && tax.regions.get(loc.region)?.data.name,
          loc.postalCode,
        ]
          .filter(Boolean)
          .join(', '),
        lat: loc.lat,
        lng: loc.lng,
        phone: loc.phone,
        url: url.venue(venue.id),
        reviewCount: venueReviews.length,
        topScore: scores.length ? Math.max(...scores) : null,
        region: loc.region,
        country,
        city: loc.city,
      });
    }
  }
  return pins;
}
