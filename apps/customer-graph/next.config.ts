import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // WebAssembly and blob URL support
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:",
            "worker-src 'self' blob:",
            "connect-src 'self' https:",
            "img-src 'self' data: blob:",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self'",
          ].join('; '),
        },
      ],
    },
  ],
  // Vercel deployment configuration for monorepo
  output: 'standalone',
};

export default nextConfig;