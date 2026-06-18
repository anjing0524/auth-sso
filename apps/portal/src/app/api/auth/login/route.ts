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
import { eq } from 'drizzle-orm';
import { validateLoginCredentials } from '@/domain/auth/login';
import { verifyPassword } from '@/domain/auth/password';
import { signLoginSession, LOGIN_SESSION_TTL } from '@/lib/auth/token';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';

export const runtime = 'nodejs';

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

    if (rows.length === 0) {
      throw new EntityNotFoundError('User', email);
    }

    const user = rows[0]!;

    // 3. 领域纯函数：状态校验 + 密码存在性检查
    validateLoginCredentials(user);

    // 4. 领域纯函数：bcrypt 密码比对
    const valid = await verifyPassword(password, user.passwordHash!);
    if (!valid) throw new BusinessRuleViolationError('邮箱或密码错误');

    // 5. 异步更新 lastLoginAt（fire-and-forget）
    db.update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id))
      .execute()
      .catch((err) => console.error('[Login] 更新 lastLoginAt 失败:', err));

    // 6. 签发 Login Session JWT → 写入 Cookie
    const session = await signLoginSession(user.id);

    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({ success: true });
    response.cookies.set('login_session', session, {
      path: '/api/auth/oauth2/authorize',
      httpOnly: true,
      secure: isProduction,
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
