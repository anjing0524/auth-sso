/**
 * Vitest 全局 Setup 文件
 *
 * 职责：
 * 1. Mock server-only 模块（Portal 的 session/redis/audit 等模块 import 了 server-only）
 * 2. 扩展 @testing-library/jest-dom 匹配器（toBeInTheDocument 等）
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock server-only：该包在非 Next.js 服务器环境中会抛出异常，测试环境需要空 mock
vi.mock('server-only', () => ({}));
