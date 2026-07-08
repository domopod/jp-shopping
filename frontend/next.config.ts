import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Rewrites disabled: backend service at 127.0.0.1:3001 is not running.
  // Re-enable when a backend service is available to serve /uploads/:path*
  // async rewrites() {
  //   return [
  //     {
  //       source: '/uploads/:path*',
  //       destination: 'http://127.0.0.1:3001/uploads/:path*',
  //     },
  //   ];
  // },
};

export default nextConfig;
