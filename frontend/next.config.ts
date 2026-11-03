import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  ...(process.env.LEXON_VISUAL_DEV === '1' ? { devIndicators: false } : {}),
  async rewrites() {
    const backend = (
      process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: backend + '/api/:path*' }];
  },
};
export default config;
