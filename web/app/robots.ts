import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/session/', '/app/', '/dashboard/', '/inbox/', '/seller/', '/admin/', '/login', '/register'] },
    ],
    sitemap: 'https://lumascout.app/sitemap.xml',
    host: 'https://lumascout.app',
  };
}
