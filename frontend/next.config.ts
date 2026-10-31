import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  async rewrites() {
    const backend = (
      process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: backend + '/api/:path*' }];
  },
};
export default config;
