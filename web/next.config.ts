import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'customer-assets.emergentagent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.lumascout.app' },
      { protocol: 'https', hostname: '**.s3.amazonaws.com' },
      { protocol: 'https', hostname: 'api.mapbox.com' },
    ],
  },
  experimental: {
    // Next 15 enables PPR + async RSC by default for stable features we use.
  },
};

export default nextConfig;
