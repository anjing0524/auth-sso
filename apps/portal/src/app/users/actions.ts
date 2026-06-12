'use server';

/**
 * 用户管理 Server Actions (BFF 薄 Controller 网关)
 * 仅执行：DTO 入参接收 -> 调用权限拦截 -> 调用领域纯函数/仓储层契约 -> 执行 revalidatePath 缓存刷新。
 * 函数体控制在 20 行左右，严禁直接内联 SQL 查库。
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { checkPermission } from '@/lib/auth-middleware';
import { DrizzleUserRepository } from '@/infrastructure/persistence/drizzle-user-repo';
import { toggleUserStatus, User } from '@/domain/user/user';
import { toUserId } from '@/domain/user/types';
import { generateId } from '@/lib/crypto';
import bcrypt from 'bcryptjs';

/**
 * 创建新用户 Action Controller
 */
export async function createUserAction(prevState: any, formData: FormData) {
  // 1. BFF 鉴权
  const check = await checkPermission(await headers(), { permissions: ['user:create'] });
  if (!check.authorized) return { success: false, message: '权限不足，无法创建用户' };

  const name = formData.get('name') as string;
  const username = formData.get('username') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const deptId = formData.get('deptId') as string;

  if (!name || !username || !email || !password) {
    return { success: false, message: '请填写所有必填字段' };
  }

  try {
    const repo = new DrizzleUserRepository();
    
    // 唯一性校验
    const isExist = await repo.existsByUsernameOrEmail(username, email);
    if (isExist) return { success: false, message: '用户名或邮箱已存在' };

    // 组装领域实体
    const newUser: User = {
      id: toUserId(generateId(20)),
      publicId: `user_${generateId(8)}`,
      username,
      email,
      name,
      status: 'ACTIVE',
      deptId: deptId && deptId !== 'ALL' ? deptId as any : null,
      deptName: null,
      createdAt: new Date()
    };

    const hashedPassword = await bcrypt.hash(password, 10);

    // 调用持久化基础设施
    await repo.create(newUser, hashedPassword);

    revalidatePath('/users');
    return { success: true, message: '用户创建成功' };
  } catch (error: any) {
    return { success: false, message: error.message || '创建用户失败' };
  }
}

/**
 * 切换用户账户启用/禁用状态 Action Controller
 */
export async function toggleUserStatusAction(userIdStr: string, currentStatus: string) {
  // 1. BFF 鉴权
  const check = await checkPermission(await headers(), { permissions: ['user:edit'] });
  if (!check.authorized) return { success: false, message: '权限不足' };

  try {
    const repo = new DrizzleUserRepository();
    const userId = toUserId(userIdStr);
    
    // 2. 基础设施拉取
    const user = await repo.getById(userId);
    if (!user) return { success: false, message: '用户不存在' };

    // 3. 编排并分发至领域纯函数核心逻辑
    const updatedUser = toggleUserStatus(user);

    // 4. 持久化并刷新
    await repo.save(updatedUser);
    
    revalidatePath('/users');
    return { success: true, message: `用户状态已更新为 ${updatedUser.status === 'ACTIVE' ? '正常' : '已禁用'}` };
  } catch (error: any) {
    return { success: false, message: error.message || '更新状态失败' };
  }
}
