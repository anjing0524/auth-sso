import type { NextConfig } from 'next';
// 显式 .ts 扩展名：next build 的配置加载按 ESM 语义解析，无扩展名相对导入无法命中 .ts 文件
import { baseNextConfig } from '../../next.base.ts';

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
