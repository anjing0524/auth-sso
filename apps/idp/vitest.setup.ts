/**
 * Vitest 全局 Setup 文件 (IdP)
 *
 * 职责：
 * Mock server-only 模块（IdP 的 redis/auth 等模块 import 了 server-only）
 */
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));
