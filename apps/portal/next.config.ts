import type { NextConfig } from 'next';
import { baseNextConfig } from '../../next.base';

const nextConfig: NextConfig = {
  // 继承 workspace 基础配置（output standalone、安全 headers、optimizePackageImports）
  // as NextConfig：JSDoc @type 不保留 literal types，显式转换保证类型正确
  ...baseNextConfig as NextConfig,

  // Portal 特有：启用 Cache Components (Next.js 16)
  cacheComponents: true,

  // Playwright 以 127.0.0.1 访问本地 Next 开发服务，显式允许其加载开发资源。
  allowedDevOrigins: ['127.0.0.1'],

  // Portal 特有 headers 与基础 headers 合并
  async headers() {
    const base = (await baseNextConfig.headers?.()) ?? [];
    return [
      ...base,
      // 可在此追加 Portal 特有的额外 headers
    ];
  },
};

export default nextConfig;
