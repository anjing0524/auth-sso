/**
 * 登录 API (POST /api/auth/login)
 *
 * Controller 编排：Zod 门禁 → DB 查用户 → 暴力破解防护 → 领域校验 → bcrypt → JWT 签发 → Cookie
 * 响应分流：有 session_id 走 OAuth 链路，无则兼容旧 fetch 链路。
 *
 * @route POST /api/auth/login
 * @impl H-AUTH-002 — 邮箱/密码登录认证
 * @impl NFR-SEC-06 — 暴力破解防护（Redis INCR 原子计数）
 * @impl J-LOG-003 — 登录日志写入
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { EmailSchema } from '@/domain/shared/zod-schemas';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { validateLoginCredentials } from '@/domain/auth/login';
import { verifyPassword, verifyPasswordForUnknownUser } from '@/domain/auth/password';
import { checkBruteForce, checkIpRateLimit, clearBruteForceCounter, incrementBruteForce } from '@/lib/auth/brute-force';
import { signLoginSession, LOGIN_SESSION_TTL } from '@/lib/auth/token';
import {
  AUTH_REQUEST_BINDING_COOKIE,
  peekStoredAuthRequest,
} from '@/lib/session/auth-request-store';
import { InvalidCredentialsError } from '@/domain/shared/errors';
import { mapServerError } from '@/lib/server-error';
import { restError } from '@/lib/response';
import { AUTH_ERRORS, COMMON_ERRORS, COOKIE_NAMES } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { isCookieSecure } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('Login');

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
  session_id: z.string().optional(),
});

/**
 * 授权请求绑定校验（H-02）。
 *
 * 返回**通过校验**的 session_id；无 session_id、未暂存、绑定 Cookie 缺失/不匹配、
 * Redis 故障一律返回 undefined —— 调用方按"普通登录"处理（不进入 OAuth 回跳）。
 * 失败时只记日志：绝不因攻击者构造的 session_id 阻断正常登录。
 */
async function resolveBoundSessionId(
  request: NextRequest,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  try {
    const bindingCookie = request.cookies.get(AUTH_REQUEST_BINDING_COOKIE)?.value;
    const stored = await peekStoredAuthRequest(sessionId);
    if (bindingCookie && stored && stored.binding === bindingCookie) return sessionId;
    log.warn('授权请求绑定校验未通过，忽略 session_id（按普通登录处理）', {
      hasBindingCookie: Boolean(bindingCookie),
      hasStoredRequest: Boolean(stored),
    });
    return undefined;
  } catch (err) {
    // 绑定校验依赖 Redis：故障时退化为普通登录（不阻断登录，也不进入 OAuth 回跳）
    log.error('授权请求绑定校验失败，按普通登录处理', { error: (err as Error).message });
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Zod 门禁（H-31：malformed JSON / 非 JSON body 必须 400，而不是落 500）
    const body: unknown = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '请求体不是合法的 JSON 对象' },
        { status: 400 },
      );
    }
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message },
        { status: 400 },
      );
    }
    const { email, password, session_id } = parsed.data;
    // ADR-025：IP 维度计数键的占位值必须与 brute-force 模块一致（缺失 → 'unknown'）
    const ip = extractClientIP(request.headers) ?? 'unknown';
    const ua = extractUserAgent(request.headers);

    // 2. IP 维度限流（ADR-025）：在触达用户表之前削峰，使撞库/枚举有成本
    const ipLimited = await checkIpRateLimit(ip);
    if (ipLimited) {
      writeLoginLog({ username: email, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: 'IP 登录失败次数过多' });
      return NextResponse.json(
        { error: COMMON_ERRORS.RATE_LIMITED, message: ipLimited },
        { status: 429, headers: { 'Retry-After': '900' } },
      );
    }

    // 3. DB 查询用户（提前查询，userId 供后续暴力破解+校验复用，消除双查）
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (rows.length === 0) {
      // H-04：对未知用户也执行等成本 bcrypt，抹平"存在用户 ≈300ms / 不存在 ≈4ms"的枚举时延差；
      // ADR-025：未知邮箱只计入 IP 维度（账户维度没有真实账户可计数）
      await verifyPasswordForUnknownUser(password);
      await incrementBruteForce(null, ip);
      writeLoginLog({ username: email, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '用户不存在' });
      throw new InvalidCredentialsError();
    }
    const user = rows[0]!;

    // 4. 账户 × IP 维度锁定（ADR-025：单 IP 锁不死账户；同时受 IP 总量约束）
    const bruteCheck = await checkBruteForce(user.id, ip);
    if (bruteCheck.rateLimited) {
      await incrementBruteForce(null, ip);
      return NextResponse.json(
        { error: COMMON_ERRORS.RATE_LIMITED, message: bruteCheck.message },
        { status: 429, headers: { 'Retry-After': String(bruteCheck.retryAfterSeconds ?? 900) } },
      );
    }
    if (bruteCheck.locked) {
      // 被锁期间继续尝试的来源要计入 IP 维度（否则锁定期成了攻击者的免费窗口）
      await incrementBruteForce(null, ip);
      return NextResponse.json(
        { error: AUTH_ERRORS.ACCOUNT_LOCKED, message: bruteCheck.message },
        { status: 423, headers: { 'Retry-After': String(bruteCheck.retryAfterSeconds ?? 900) } },
      );
    }

    // 5. 领域校验：状态 + 密码
    try {
      validateLoginCredentials(user);
    } catch (err) {
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: (err as Error).message });
      throw err;
    }
    const valid = await verifyPassword(password, user.passwordHash!);
    if (!valid) {
      // 密码错误，增加暴力破解失败计数
      await incrementBruteForce(user.id, ip);
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '密码错误' });
      throw new InvalidCredentialsError();
    }

    // 6. 密码通过 → 清除该（账户,IP）的账户计数（IP 总量保留用于发现撞库）
    await clearBruteForceCounter(user.id, ip);

    // 7. 更新 lastLoginAt + 记录成功日志（await 确保审计时间准确）
    try {
      await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    } catch (err) {
      log.error('更新 lastLoginAt 失败，暴力破解 DB 回退路径可能受影响', { userId: user.id, error: (err as Error).message });
    }
    writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_SUCCESS', ip, userAgent: ua });

    // 8. 授权请求绑定校验（H-02）：只有 authorize 分支 B 在本浏览器写入的绑定
    //    Cookie 与 Redis 暂存值一致时，才把 session_id 写进 login_session 并回跳
    //    authorize。第三方注入的 `/login?session_id=…` 链接（受害者浏览器没有该
    //    Cookie）因此在登录处失效。
    const boundSessionId = await resolveBoundSessionId(request, session_id);

    // 9. 签发 Login Session JWT → Cookie（sid claim 仅绑定成功后携带）
    const session = await signLoginSession(user.id, boundSessionId);
    const secure = isCookieSecure();
    const redirectPath = boundSessionId
      ? `/api/auth/oauth2/authorize?session_id=${encodeURIComponent(boundSessionId)}`
      : null;

    const response = NextResponse.json(
      redirectPath ? { redirect: redirectPath } : {},
    );
    response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, session, {
      path: '/api/auth/oauth2/authorize',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: LOGIN_SESSION_TTL,
    });
    return response;
  } catch (err) {
    const mapped = mapServerError(err);
    // 信封形状只能有一处（restError）——此前这里手抄了逐字相同的三行
    return restError(mapped.error, mapped.message, mapped.status);
  }
}
