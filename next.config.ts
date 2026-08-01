import type { NextConfig } from 'next';

/**
 * Console build config.
 *
 * Image optimisation is deliberately left off. This console renders tables and
 * status, never photographs, so there is nothing to optimise -- and leaving it
 * configured would imply the `sharp` image pipeline is in use when no code path
 * here can reach it.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Operations data must never be cached by a proxy or a browser, and a
        // console that releases escrow should not be embeddable anywhere.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;
