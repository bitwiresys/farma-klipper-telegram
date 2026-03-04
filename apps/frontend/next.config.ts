import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const raw = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? '';
    const base = raw.replace(/\/+$/, '');
    if (!base) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${base}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
