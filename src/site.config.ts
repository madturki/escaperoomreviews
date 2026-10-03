export const SITE = {
  name: 'Escape Room Reviews',
  tagline: 'Honest reviews of the best escape rooms in Canada and beyond',
  description:
    'Room-by-room escape room reviews and ratings from a husband and wife team. Browse by genre, venue, city, or find escape rooms near you.',
  url: 'https://www.escaperoomreviews.ca',
  email: 'media@escaperoomreviews.ca',
  defaultImage: '/og-default.png',
  mailchimp: {
    action:
      'https://escaperoomreviews.us3.list-manage.com/subscribe/post?u=534d6a2cc6466a442fe954a33&id=0e4bbf910b&f_id=00b6c3e1f0',
    honeypot: 'b_534d6a2cc6466a442fe954a33_0e4bbf910b',
  },
  adsense: {
    enabled: true,
    client: 'ca-pub-5954496023571705',
    slot: '1149963089',
  },
};

export const NAV = [
  { label: 'Latest', href: '/blog/' },
  { label: 'Genres', href: '/category/genre/' },
  { label: 'Venues', href: '/category/location/' },
  { label: 'Locations', href: '/category/city/' },
  { label: 'Map', href: '/map/' },
  { label: 'Top 50 Ontario', href: '/top-50-escape-rooms-in-ontario/' },
  { label: 'Search', href: '/search/' },
];
