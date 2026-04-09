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
    // WASM 文件专用 Headers
    {
      source: '/wasm/:path*.wasm',
      headers: [
        {
          key: 'Content-Type',
          value: 'application/wasm',
        },
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    },
    // WASM glue JS 文件
    {
      source: '/wasm/:path*.js',
      headers: [
        {
          key: 'Content-Type',
          value: 'application/javascript',
        },
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    },
  ],
  // Vercel deployment configuration for monorepo
  output: 'standalone',
};

export default nextConfig;