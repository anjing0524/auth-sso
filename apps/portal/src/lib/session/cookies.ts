import 'server-only';

/**
 * JWT Cookie 读取工具（服务端调用）
 *
 * **只读**：Cookie 的写入与清除分散在各自的 handler 中（`login` 写 LoginSession、
 * `refresh` 写 AT/RT、`logout` 清除），因为这些 write 各自有不同的 Path 与属性
 * 要求。原先这里还有 `setJwtCookies` / `clearJwtCookies` 两个写入口，但**生产
 * 代码从未调用**（只有测试在用），且其属性集与生产实际写入不一致
 * （见 docs/roadmap.md 变更记录，架构评审候选 ⑨）。
 *
 * @module lib/session/cookies
 */
import { cookies } from 'next/headers';
import { COOKIE_NAMES } from '@auth-sso/contracts';

/**
 * 从当前请求的 Cookie 中读取 Access Token 字符串。
 *
 * 不 catch cookies() 的异常——构建期 prerendering 中断信号需要自然传播到 <Suspense>，
 * 请求期 cookies() 是平台标准 API，不会 throw。
 */
export async function getJwtFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.JWT)?.value ?? null;
}

/**
 * 从当前请求的 Cookie 中读取 Refresh Token 字符串
 */
export async function getRefreshTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.REFRESH)?.value ?? null;
}
