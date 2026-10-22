/**
 * Workspace 通用 Next.js 配置
 *
 * 导出可被各 Next.js app 继承的基础配置（纯对象，零运行时依赖）。
 * 类型由 app 端的 `import type { NextConfig } from 'next'` 保证。
 *
 * @module next.base
 */

/** @type {import('next').NextConfig} */
export const baseNextConfig = {
  // 生产环境优化
  poweredByHeader: false,

  // 启用 standalone 输出以支持 Docker 部署
  output: /** @type {'standalone'} */ ('standalone'),

  // 安全 headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },

  // 优化 barrel imports：构建时将 barrel 导入转为直接路径导入
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};
