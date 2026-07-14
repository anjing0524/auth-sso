/**
 * 登录 API (POST /api/auth/login)
 *
 * Controller 编排：Zod 门禁 → DB 查用户 → 暴力破解防护 → 领域校验 → bcrypt → JWT 签发 → Cookie
 * 响应分流：有 session_id 走 OAuth 链路，无则兼容旧 fetch 链路。
 *
 * @route POST /api/auth/login
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { validateLoginCredentials } from '@/domain/auth/login';
import { verifyPassword } from '@/domain/auth/password';
import { checkBruteForce, clearBruteForceCounter, incrementBruteForce } from '@/lib/auth/brute-force';
import { signLoginSession, LOGIN_SESSION_TTL } from '@/lib/auth/token';
import { InvalidCredentialsError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { AUTH_ERRORS, COMMON_ERRORS, COOKIE_NAMES } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { isCookieSecure } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('Login');

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  session_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Zod 门禁
    const body = await request.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message },
        { status: 400 },
      );
    }
    const { email, password, session_id } = parsed.data;
    const ip = extractClientIP(request.headers);
    const ua = extractUserAgent(request.headers);

    // 2. DB 查询用户（提前查询，userId 供后续暴力破解+校验复用，消除双查）
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (rows.length === 0) {
      writeLoginLog({ username: email, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '用户不存在' });
      throw new InvalidCredentialsError();
    }
    const user = rows[0]!;

    // 3. 暴力破解防护（复用步骤 2 的 userId，避免 brute-force 内重复查用户）
    const bruteCheck = await checkBruteForce(user.id);
    if (bruteCheck.locked) {
      return NextResponse.json(
        { error: AUTH_ERRORS.ACCOUNT_LOCKED, message: bruteCheck.message },
        { status: 423 },
      );
    }

    // 4. 领域校验：状态 + 密码
    try {
      validateLoginCredentials(user);
    } catch (err) {
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: (err as Error).message });
      throw err;
    }
    const valid = await verifyPassword(password, user.passwordHash!);
    if (!valid) {
      // 密码错误，增加暴力破解失败计数
      await incrementBruteForce(user.id);
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '密码错误' });
      throw new InvalidCredentialsError();
    }

    // 5. 密码通过 → 清除暴力破解计数器
    await clearBruteForceCounter(user.id);

    // 6. 更新 lastLoginAt + 记录成功日志（await 确保审计时间准确）
    try {
      await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    } catch (err) {
      log.error('更新 lastLoginAt 失败，暴力破解 DB 回退路径可能受影响', { userId: user.id, error: (err as Error).message });
    }
    writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_SUCCESS', ip, userAgent: ua });

    // 7. 签发 Login Session JWT → Cookie
    const session = await signLoginSession(user.id);
    const secure = isCookieSecure();
    const redirectPath = session_id ? `/api/auth/oauth2/authorize?session_id=${session_id}` : null;

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
    const mapped = mapDomainError(err);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}
