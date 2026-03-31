import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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