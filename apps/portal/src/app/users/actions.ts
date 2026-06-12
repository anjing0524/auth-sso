'use server';

/**
 * 用户管理 Server Actions
 * 用于 React 19 & Next.js App Router 架构下的后端数据读取与突变
 */

import { db, schema } from '@/lib/db';
import { eq, ne, or, ilike, inArray, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { checkPermission, getDataScopeFilter, checkDataScope } from '@/lib/auth-middleware';
import { logAuditEvent, getClientIP } from '@/lib/audit';
import { generateId } from '@/lib/crypto';
import { COMMON_ERRORS, USER_ERRORS, UserStatus } from '@auth-sso/contracts';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

/**
 * 分页与过滤获取用户列表
 * 
 * @param params 过滤与分页参数
 * @returns 用户列表数据及分页信息
 */
export async function getUsers(params: {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
}) {
  // 1. 鉴权：检查当前用户是否具有用户列表查看权限
  const check = await checkPermission(await headers(), { permissions: ['user:list'] });
  if (!check.authorized || !check.userId) {
    throw new Error('未授权访问或权限不足');
  }

  const { page, pageSize, keyword, status } = params;
  const offset = (page - 1) * pageSize;

  // 2. 获取数据范围过滤规则
  const scopeFilter = await getDataScopeFilter(check.userId);

  // 3. 构建查询
  const query = db
    .select({
      id: schema.users.id,
      publicId: schema.users.publicId,
      username: schema.users.username,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      status: schema.users.status,
      deptId: schema.users.deptId,
      deptName: schema.departments.name,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id));

  // 默认排除逻辑删除的用户
  const conditions = [ne(schema.users.status, 'DELETED')];

  if (keyword) {
    const searchFilter = or(
      ilike(schema.users.name, `%${keyword}%`),
      ilike(schema.users.email, `%${keyword}%`),
      ilike(schema.users.username, `%${keyword}%`)
    );
    if (searchFilter) {
      conditions.push(searchFilter);
    }
  }

  if (status && status !== 'ALL') {
    conditions.push(eq(schema.users.status, status as UserStatus));
  }

  // 应用数据范围过滤
  if (scopeFilter.type === 'LIST') {
    const allowedDeptIds = scopeFilter.deptIds || [];
    if (allowedDeptIds.length === 0) {
      return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
    }
    conditions.push(inArray(schema.users.deptId, allowedDeptIds));
  } else if (scopeFilter.type === 'SELF') {
    conditions.push(eq(schema.users.id, check.userId));
  }

  // 4. 执行数据查询与计数查询
  const users = await query
    .where(and(...conditions))
    .orderBy(desc(schema.users.createdAt))
    .limit(pageSize)
    .offset(offset);

  const countResult = await db
    .select({ count: drizzleSql`COUNT(*)::int` })
    .from(schema.users)
    .where(and(...conditions));

  const total = Number(countResult[0]?.count ?? 0);

  return {
    data: users.map((u) => ({
      id: u.id,
      publicId: u.publicId,
      username: u.username,
      email: u.email,
      name: u.name || u.username || 'Unknown',
      avatarUrl: u.avatarUrl,
      status: u.status,
      deptId: u.deptId,
      deptName: u.deptName || '未分配',
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * 表单动作：创建新用户
 * 兼容 React 19 useActionState，接收 prevState 和 FormData
 * 
 * @param prevState 上一次的 State 状态
 * @param formData 表单数据
 * @returns 包含成功状态、提示消息或错误信息的对象
 */
export async function createUserAction(prevState: any, formData: FormData) {
  // 1. 权限检查
  const check = await checkPermission(await headers(), { permissions: ['user:create'] });
  if (!check.authorized || !check.userId) {
    return { success: false, error: 'FORBIDDEN', message: '权限不足，无法创建用户' };
  }

  const name = formData.get('name') as string;
  const username = formData.get('username') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const deptId = formData.get('deptId') as string;

  // 2. 参数基本校验
  if (!name || !username || !email || !password) {
    return { success: false, error: 'VALIDATION_ERROR', message: '请填写所有必填字段' };
  }

  // 3. 数据范围校验：当前管理员是否有权限向该部门添加用户
  if (deptId) {
    const hasScope = await checkDataScope(check.userId, deptId);
    if (!hasScope) {
      return { success: false, error: 'FORBIDDEN', message: '无权在该部门创建用户' };
    }
  }

  try {
    // 4. 重复校验
    const existingUser = await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.username, username), eq(schema.users.email, email)));

    if (existingUser.length > 0) {
      return { success: false, error: 'USER_ALREADY_EXISTS', message: '用户名或邮箱已存在' };
    }

    // 5. 生成主键与加密密码
    const id = generateId(20);
    const publicId = `user_${generateId(8)}`;
    const hashedPassword = await bcrypt.hash(password, 10);

    // 6. 执行数据库事务
    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({
        id,
        publicId,
        username,
        email,
        name,
        passwordHash: hashedPassword,
        status: 'ACTIVE',
        deptId: deptId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await tx.insert(schema.accounts).values({
        id: generateId(20),
        userId: id,
        accountId: email,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    // 7. 记录审计日志
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') || undefined;
    
    // 异步记录审计，不阻塞主流程
    logAuditEvent({
      userId: check.userId,
      operation: 'USER_CREATE',
      url: '/users',
      method: 'ACTION',
      params: JSON.stringify({ username, email, name, deptId }),
      ip: '127.0.0.1', // Server Action 环境下默认本机，或可进一步解析
      userAgent,
      status: 200,
    }).catch(console.error);

    // 8. 刷新路径缓存，触发客户端重新获取数据
    revalidatePath('/users');

    return { success: true, message: '用户创建成功' };
  } catch (error: any) {
    console.error('[createUserAction] Error:', error);
    return { success: false, error: 'INTERNAL_ERROR', message: `创建用户失败: ${error.message}` };
  }
}

/**
 * 切换用户账户启用/禁用状态
 * 
 * @param targetUserId 目标用户 ID
 * @param currentStatus 当前状态
 * @returns 成功或失败的反馈对象
 */
export async function toggleUserStatusAction(
  targetUserId: string,
  currentStatus: 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'DELETED'
) {
  // 1. 权限检查
  const check = await checkPermission(await headers(), { permissions: ['user:edit'] }); // 假设编辑权限
  if (!check.authorized || !check.userId) {
    return { success: false, message: '权限不足' };
  }

  if (currentStatus === 'DELETED') {
    return { success: false, message: '逻辑删除的用户无法更新状态' };
  }

  const newStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';

  try {
    // 2. 数据范围校验：检查是否有对目标用户所属部门的操作权限
    const [targetUser] = await db
      .select({ deptId: schema.users.deptId })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId));

    if (targetUser && targetUser.deptId) {
      const hasScope = await checkDataScope(check.userId, targetUser.deptId);
      if (!hasScope) {
        return { success: false, message: '无权操作该部门的用户' };
      }
    }

    // 3. 执行更新
    await db
      .update(schema.users)
      .set({ status: newStatus as UserStatus, updatedAt: new Date() })
      .where(eq(schema.users.id, targetUserId));

    // 4. 刷新路径缓存
    revalidatePath('/users');

    return { success: true, message: `用户状态已更新为 ${newStatus === 'ACTIVE' ? '正常' : '已禁用'}` };
  } catch (error) {
    console.error('[toggleUserStatusAction] Error:', error);
    return { success: false, message: '更新状态失败' };
  }
}

/**
 * 获取所有部门列表（用于下拉选择）
 * 
 * @returns 部门列表简要信息
 */
export async function getDepartments() {
  try {
    const list = await db
      .select({
        id: schema.departments.id,
        name: schema.departments.name,
      })
      .from(schema.departments)
      .orderBy(schema.departments.name);

    return list;
  } catch (error) {
    console.error('[getDepartments] Error:', error);
    return [];
  }
}
