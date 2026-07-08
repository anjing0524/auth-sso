/**
 * Vitest 全局 Setup 文件
 *
 * 职责：
 * 1. Mock server-only 模块（Portal 的 session/redis/audit 等模块 import 了 server-only）
 * 2. Mock next/cache 的 cacheLife/cacheTag（data.ts 读模型使用 "use cache" 指令需要）
 * 3. 扩展 @testing-library/jest-dom 匹配器（toBeInTheDocument 等）
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock server-only：该包在非 Next.js 服务器环境中会抛出异常，测试环境需要空 mock
vi.mock('server-only', () => ({}));

// Mock next/cache：data.ts 读模型使用 "use cache" + cacheLife + cacheTag，
// 测试环境不需要实际缓存语义，提供空实现即可
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

// Mock next/headers：API 测试在 node 环境下运行，headers()/cookies() 不在请求上下文中。
// 默认返回空 Headers（.get() → null）和空 cookies（.get() → undefined），
// 使认证检查走兜底逻辑。各测试可按需通过 vi.mocked() 覆盖。
vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
  cookies: vi.fn(() => Promise.resolve({ get: vi.fn() })),
}));

