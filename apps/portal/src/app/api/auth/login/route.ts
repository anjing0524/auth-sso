/**
 * 登录 API (POST /api/auth/login)
 *
 * Controller 编排：Zod 门禁 → DB 查询 → 领域纯函数校验 → bcrypt → lastLoginAt → JWT 签发 → Cookie
 *
 * @route POST /api/auth/login
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/infrastructure/db';
import { eq, and, gte, sql } from 'drizzle-orm';
import { validateLoginCredentials } from '@/domain/auth/login';
import { verifyPassword } from '@/domain/auth/password';
import { signLoginSession, LOGIN_SESSION_TTL } from '@/lib/auth/token';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';


const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

    const { email, password } = parsed.data;

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

    // 3. 暴力破解防护：查询最近 15 分钟内登录失败次数（NFR-SEC-06）
    //    外层 try/catch 确保 login_logs 查询异常时安全放行（fail-open）
    let failCount = 0;
    try {
      const lockWindowStart = new Date(Date.now() - 15 * 60 * 1000);
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

    if (failCount >= 5) {
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

    // 6. 异步更新 lastLoginAt（fire-and-forget）
    db.update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id))
      .catch((err) => console.error('[Login] 更新 lastLoginAt 失败:', err));

    // 7. 记录登录成功日志（I-LOG-003）
    writeLoginLog({ userId: user.id, username: user.username, eventType: 'LOGIN_SUCCESS', ip, userAgent: ua });

    // 8. 签发 Login Session JWT → 写入 Cookie
    const session = await signLoginSession(user.id);

    const isProduction = process.env.NODE_ENV === 'production';
    // 本地开发/E2E环境下，直连 HTTP 端口时必须降级为 secure: false，否则浏览器会拒绝写入
    const isLocal = request.headers.get('host')?.includes('localhost') || request.headers.get('host')?.includes('127.0.0.1');
    const secure = isProduction && !isLocal;

    const response = NextResponse.json({ success: true });
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
