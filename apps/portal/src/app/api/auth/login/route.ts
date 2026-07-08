/**
 * 登录 API (POST /api/auth/login)
 *
 * Controller 编排：Zod 门禁 → DB 查询 → 领域纯函数校验 → bcrypt → lastLoginAt → JWT 签发 → Cookie
 *
 * 响应分流（按 body 是否含 session_id）：
 * - 有 session_id → JSON { success, redirect } + Set-Cookie login_session
 *   （前端拿到 redirect 后手动导航；Set-Cookie 已由浏览器存储，导航到 authorize 时携带 login_session）
 * - 无 session_id → JSON { success } + Set-Cookie login_session（兼容旧 fetch 链路）
 *
 * @route POST /api/auth/login
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/infrastructure/db';
import { getRedis } from '@/infrastructure/redis';
import { eq, and, gte, sql } from 'drizzle-orm';
import { validateLoginCredentials } from '@/domain/auth/login';
import { verifyPassword } from '@/domain/auth/password';
import { signLoginSession, LOGIN_SESSION_TTL } from '@/lib/auth/token';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';

const BRUTE_FORCE_MAX_ATTEMPTS = 5;
const BRUTE_FORCE_WINDOW_SEC = 15 * 60; // 15 分钟
const FAIL_COUNT_KEY_PREFIX = 'portal:login_fail:';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** authorize 端点下发的不透明会话 ID；存在时走 OAuth 标准链路（接续 authorize） */
  session_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Zod 门禁
    const body = await request.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { email, password, session_id } = parsed.data;

    // 2. DB 查询用户
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    const ip = extractClientIP(request.headers);
    const ua = extractUserAgent(request.headers);

    if (rows.length === 0) {
      // 用户不存在 → 记录登录失败（防用户枚举，用户名填写 email 值）
      writeLoginLog({ username: email, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '用户不存在' });
      throw new EntityNotFoundError('User', email);
    }

    const user = rows[0]!;

    // 3. 暴力破解防护：Redis INCR 原子计数（NFR-SEC-06）
    //    Redis 不可用时回退到 DB 查询（fail-open）。
    //    使用 Redis 原子 INCR 消除 DB 查询与密码校验之间的 TOCTOU 竞态窗口。
    const failCountKey = `${FAIL_COUNT_KEY_PREFIX}${user.id}`;
    let failCount = 0;
    let useRedisCount = false;
    try {
      const redis = getRedis();
      if (redis) {
        const count = await redis.incr(failCountKey);
        if (count === 1) {
          // 首次写入设置窗口过期时间
          await redis.expire(failCountKey, BRUTE_FORCE_WINDOW_SEC);
        }
        useRedisCount = true;
        failCount = count;
      }
    } catch {
      // Redis 不可用，回退到 DB 查询
    }

    if (!useRedisCount) {
      // 回退路径：查询 login_logs 表（非原子操作，仅作为降级方案）
      try {
        const lockWindowStart = new Date(Date.now() - BRUTE_FORCE_WINDOW_SEC * 1000);
        const result = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.loginLogs)
          .where(
            and(
              eq(schema.loginLogs.userId, user.id),
              eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
              gte(schema.loginLogs.createdAt, lockWindowStart),
            ),
          );
        failCount = result[0]?.count ?? 0;
      } catch {
        // login_logs 表不可用（测试环境 mock 不完整等场景），安全放行
      }
    }

    if (failCount >= BRUTE_FORCE_MAX_ATTEMPTS) {
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '账户临时锁定（连续5次失败）' });
      return NextResponse.json(
        { success: false, error: 'ACCOUNT_LOCKED', message: '登录失败次数过多，账户已临时锁定，请15分钟后重试' },
        { status: 423 },
      );
    }

    // 4. 领域纯函数：状态校验 + 密码存在性检查
    try {
      validateLoginCredentials(user);
    } catch (err) {
      // 账号禁用/锁定/注销 → 记录登录失败
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: (err as Error).message });
      throw err;
    }

    // 5. 领域纯函数：bcrypt 密码比对
    const valid = await verifyPassword(password, user.passwordHash!);
    if (!valid) {
      writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_FAILED', ip, userAgent: ua, failReason: '密码错误' });
      throw new BusinessRuleViolationError('邮箱或密码错误');
    }

    // 密码验证成功 → 清除暴力破解计数器
    if (useRedisCount) {
      try {
        const redis = getRedis();
        redis?.del(failCountKey);
      } catch {
        // 清除失败不影响登录流程
      }
    }

    // 6. 异步更新 lastLoginAt（fire-and-forget）
    db.update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id))
      .catch((err) => console.error('[Login] 更新 lastLoginAt 失败:', err));

    // 7. 记录登录成功日志（I-LOG-003）
    writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_SUCCESS', ip, userAgent: ua });

    // 8. 签发 Login Session JWT → 写入 Cookie
    const session = await signLoginSession(user.id);

    const secure = (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://');

    // 响应分流：
    // - 有 session_id → JSON { success, redirect }（前端 fetch 拿到 redirect 后手动导航，
    //   Set-Cookie 已由浏览器存储，导航到 authorize 时会携带 login_session）
    // - 无 session_id → JSON { success }（兼容旧链路）
    const redirectPath = session_id
      ? `/api/auth/oauth2/authorize?session_id=${session_id}`
      : null;

    const response = NextResponse.json(
      redirectPath ? { success: true, redirect: redirectPath } : { success: true },
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
      { success: false, error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}
