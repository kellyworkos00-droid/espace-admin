import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Listing photos come from Supabase storage and Unsplash.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

export default nextConfig;
