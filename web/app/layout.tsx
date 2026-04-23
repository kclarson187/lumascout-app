import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://lumascout.app'),
  title: {
    default: 'LumaScout — Find incredible photo locations. Grow your photography business.',
    template: '%s · LumaScout',
  },
  description:
    'The network for photographers. Discover sunrise spots, blooming fields, hidden gems, and storm-chase routes. Sell packs, apply to gigs, collaborate with creators.',
  keywords: [
    'photography spots', 'photo locations', 'landscape photography', 'sunrise spots',
    'astrophotography', 'photographer marketplace', 'photo community', 'photography gigs',
    'Mapbox', 'photography platform', 'LumaScout',
  ],
  authors: [{ name: 'LumaScout' }],
  openGraph: {
    type: 'website',
    url: 'https://lumascout.app',
    siteName: 'LumaScout',
    title: 'LumaScout — Find incredible photo locations.',
    description:
      'The network for photographers. Map-first discovery, creator marketplace, referrals, and community for serious image-makers.',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'LumaScout' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LumaScout — Find incredible photo locations.',
    description: 'The network for photographers.',
    images: ['/og.jpg'],
  },
  alternates: { canonical: 'https://lumascout.app' },
  icons: { icon: '/favicon.ico', apple: '/apple-icon.png' },
  manifest: '/site.webmanifest',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-brand focus:text-black focus:px-3 focus:py-2 focus:rounded-lg focus:font-semibold"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
        {/* Structured data — SoftwareApplication */}
        <Script
          id="ld-json-app"
          type="application/ld+json"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'LumaScout',
              operatingSystem: 'iOS, Android, Web',
              applicationCategory: 'LifestyleApplication',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
              aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.9', reviewCount: '2100' },
              url: 'https://lumascout.app',
            }),
          }}
        />
      </body>
    </html>
  );
}
