import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  ...(process.env.LEXON_VISUAL_DEV === '1'
    ? { devIndicators: false, allowedDevOrigins: ['127.0.0.1'] }
    : {}),
};
export default config;
