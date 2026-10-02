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
      'https://escaperoomreviews.us5.list-manage.com/subscribe/post?u=3cbf5b8352130aadcb483bf8a&id=e5c6d9cf24&f_id=00aa0ce6f0',
    honeypot: 'b_3cbf5b8352130aadcb483bf8a_e5c6d9cf24',
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
