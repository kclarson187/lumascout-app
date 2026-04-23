import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://lumascout.app';
  const now = new Date();
  const staticRoutes = [
    '', '/pricing', '/marketplace', '/community', '/creators', '/mentors',
    '/about', '/privacy', '/terms', '/community-guidelines', '/refund-policy', '/marketplace-terms',
  ];
  const cityRoutes = [
    'austin', 'los-angeles', 'new-york', 'san-francisco', 'seattle', 'chicago',
    'denver', 'portland', 'miami', 'nashville',
  ].map((c) => `/spots/${c}`);

  return [...staticRoutes, ...cityRoutes].map((p) => ({
    url: `${base}${p}`,
    lastModified: now,
    changeFrequency: p.startsWith('/spots/') ? 'weekly' as const : 'monthly' as const,
    priority: p === '' ? 1 : p === '/pricing' ? 0.9 : p.startsWith('/spots/') ? 0.8 : 0.6,
  }));
}
