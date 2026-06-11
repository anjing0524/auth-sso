/**
 * 测试请求构造工具
 * 提供快速构造 NextRequest 对象的工厂函数
 */
import { NextRequest } from 'next/server';

/**
 * 创建 API 测试用 NextRequest
 *
 * @param path 请求路径（如 '/api/users'）
 * @param options 配置选项
 * @returns 构造好的 NextRequest 对象
 */
export function createTestRequest(
  path: string,
  options: {
    method?: string;
    body?: any;
    searchParams?: Record<string, string>;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = 'GET', body, searchParams, cookies, headers = {} } = options;

  // 构造 URL
  const url = new URL(path, 'http://localhost:4100');
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  // 构造 request init
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  const request = new NextRequest(url.toString(), init as any);

  // 设置 cookies（通过 headers 模拟）
  if (cookies) {
    const cookieString = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
    request.headers.set('cookie', cookieString);
  }

  return request;
}

/**
 * 创建带 Session Cookie 的已认证请求
 *
 * @param path 请求路径
 * @param sessionId Session ID
 * @param options 额外选项
 * @returns 带认证 cookie 的 NextRequest
 */
export function createAuthenticatedRequest(
  path: string,
  sessionId = 'session-123',
  options: Omit<Parameters<typeof createTestRequest>[1], 'cookies'> = {}
): NextRequest {
  return createTestRequest(path, {
    ...options,
    cookies: { portal_session_id: sessionId },
  });
}

/**
 * 从 Response 中解析 JSON
 *
 * @param response NextResponse 或 Response 对象
 * @returns 解析后的 JSON 数据
 */
export async function parseResponseJson<T = any>(response: Response): Promise<T> {
  return response.json();
}
