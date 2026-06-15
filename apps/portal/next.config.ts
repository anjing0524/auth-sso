import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用 Cache Components (Next.js 16)：读路径可用 "use cache" 持久化缓存 (R10 / §3.6)
  cacheComponents: true,

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