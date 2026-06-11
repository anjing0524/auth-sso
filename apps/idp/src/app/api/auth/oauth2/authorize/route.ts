import { auth } from '../../../../../lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../db';
import * as schema from '../../../../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 拦截 OAuth2 授权请求，执行客户端访问权限检查
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');

  if (!clientId) {
    const { GET: betterAuthGet } = toNextJsHandler(auth);
    return betterAuthGet(request);
  }

  // 0. 检查客户端状态
  const client = await db.select()
    .from(schema.clients)
    .where(eq(schema.clients.clientId, clientId))
    .limit(1);

  if (client.length === 0 || client[0].status !== 'ACTIVE' || client[0].disabled) {
    console.warn(`[Authorize] Attempt to access invalid or disabled client: ${clientId}`);
    const errorUrl = new URL('/error', url.origin);
    errorUrl.searchParams.set('error', 'invalid_client');
    errorUrl.searchParams.set('message', '该应用系统已停用或不存在，请联系管理员。');
    return NextResponse.redirect(errorUrl);
  }

  // 1. 获取当前会话
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  // 2. 如果已登录，检查该用户是否有权访问此客户端
  if (session && session.user) {
    const userId = session.user.id;

    // 检查用户自身状态
    const user = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (user.length === 0 || user[0].status !== 'ACTIVE') {
      console.warn(`[Authorize] User ${userId} is not active (Status: ${user[0]?.status})`);
      const errorUrl = new URL('/error', url.origin);
      errorUrl.searchParams.set('error', 'user_inactive');
      errorUrl.searchParams.set('message', '您的账号已被锁定或禁用，请联系管理员。');
      return NextResponse.redirect(errorUrl);
    }

    // 查询该用户拥有的角色
    const userRoles = await db.select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));

    const roleIds = userRoles.map((ur) => ur.roleId);

    if (roleIds.length > 0) {
      // 检查角色详情，看是否是超级管理员，并过滤掉非 ACTIVE 状态的角色
      const roleDetails = await db.select()
        .from(schema.roles)
        .where(
          and(
            inArray(schema.roles.id, roleIds),
            eq(schema.roles.status, 'ACTIVE')
          )
        );

      const activeRoleIds = roleDetails.map(r => r.id);

      if (activeRoleIds.length === 0) {
        console.warn(`[Authorize] User ${userId} has roles, but none are ACTIVE.`);
        const errorUrl = new URL('/error', url.origin);
        errorUrl.searchParams.set('error', 'no_active_roles');
        errorUrl.searchParams.set('message', '您的角色已被停用，无法访问系统。');
        return NextResponse.redirect(errorUrl);
      }
      
      const isSuperAdmin = roleDetails.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');
      
      if (!isSuperAdmin) {
        // 非管理员，需要检查具体的客户端授权
        const allowed = await db.select()
          .from(schema.roleClients)
          .where(
            and(
              inArray(schema.roleClients.roleId, activeRoleIds),
              eq(schema.roleClients.clientId, clientId)
            )
          )
          .limit(1);

        if (allowed.length === 0) {
          console.warn(`[Authorize] User ${userId} is not authorized to access client ${clientId}`);
          // 重定向到错误提示页
          const errorUrl = new URL('/error', url.origin);
          errorUrl.searchParams.set('error', 'unauthorized_client');
          errorUrl.searchParams.set('message', '您没有访问该系统的权限，请联系管理员分配。');
          errorUrl.searchParams.set('client_id', clientId);
          return NextResponse.redirect(errorUrl);
        }
      }
    } else {
      // 无任何角色
      console.warn(`[Authorize] User ${userId} has no roles assigned.`);
      const errorUrl = new URL('/error', url.origin);
      errorUrl.searchParams.set('error', 'no_roles');
      errorUrl.searchParams.set('message', '您的账号尚未分配任何角色，无法访问系统。');
      return NextResponse.redirect(errorUrl);
    }
  }

  // 3. 检查通过或未登录（未登录时由 Better Auth 引导至登录页），继续处理
  const { GET: betterAuthGet } = toNextJsHandler(auth);
  return betterAuthGet(request);
}
