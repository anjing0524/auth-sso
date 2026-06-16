import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用 Cache Components (Next.js 16)：读路径可用 "use cache" 持久化缓存 (R10 / §3.6)
  cacheComponents: true,

  // 优化 barrel imports：构建时将 lucide-react 的 barrel 导入自动转为直接路径导入
  // 避免加载 ~1500+ 模块，减少 dev 启动时间和 production cold start
  // @see https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  // 启用standalone输出以支持Vercel部署
  output: "standalone",

  // 生产环境优化
  poweredByHeader: false,

  // 安全headers配置
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          }
        ]
      }
    ];
  }
};

export default nextConfig;