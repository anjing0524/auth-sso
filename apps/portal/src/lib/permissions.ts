/**
 * 权限上下文工具函数
 * 获取用户的角色和权限，具备高性能的 Redis 旁路缓存支持
 */
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and } from 'drizzle-orm';
import { getRedis, type RedisClient } from '@/infrastructure/redis';
import type { DataScopeType, UserPermissionContext } from '@auth-sso/contracts';

// Re-export 以便其他模块统一导入
export type { UserPermissionContext };

/**
 * 获取用户的权限上下文
 * 优先读取 Redis 缓存，未命中则查询数据库并写入缓存 (TTL: 300秒)
 * 具备优雅的降级机制，若 Redis 连接异常则直接回退为数据库查询，保证服务高可用
 */
export async function getUserPermissionContext(userId: string): Promise<UserPermissionContext | null> {
  const cacheKey = `portal:user_perms:${userId}`;
  let redis: RedisClient | null = null;

  // 1. 尝试从 Redis 缓存中获取数据
  try {
    redis = getRedis();
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData) as UserPermissionContext;
    }
  } catch (cacheError: any) {
    // 降级容错：Redis 异常时不阻断核心鉴权业务，仅记录日志并继续查库
    console.warn(`[PermissionContext] Redis cache read failed for user ${userId}, falling back to DB:`, cacheError.message);
  }

  try {
    // 2. 从数据库查询用户信息
    const users = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    if (users.length === 0) {
      return null;
    }

    const user = users[0]!;

    // 强核准状态约束：如果用户状态不是激活状态 (ACTIVE)，立刻返回 null 拒绝加载权限与角色，防范封禁账号鉴权逃逸漏洞
    if (user.status !== 'ACTIVE') {
      console.warn(`[PermissionContext] Access denied: User ${userId} is not ACTIVE (current status: ${user.status})`);
      return null;
    }

    // 3. 从数据库查询用户的角色
    const userRolesData = await db
      .select({
        id: schema.roles.id,
        code: schema.roles.code,
        name: schema.roles.name,
        dataScopeType: schema.roles.dataScopeType,
        status: schema.roles.status,
      })
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId));

    // 过滤出处于激活状态 (ACTIVE) 的角色
    const roles = userRolesData.filter(r => r.status === 'ACTIVE');

    if (roles.length === 0) {
      const context: UserPermissionContext = {
        roles: [],
        permissions: [],
        dataScopeType: 'SELF',
        deptId: user.deptId ?? undefined,
      };

      // 写入缓存并直接返回
      if (redis) {
        try {
          await redis.setex(cacheKey, 300, JSON.stringify(context));
        } catch (e) {
          // 仅警告，不影响返回
        }
      }
      return context;
    }

    // 4. 从数据库查询角色绑定的激活状态权限列表
    const roleIds = roles.map(r => r.id);
    const permissionsData = await db
      .selectDistinct({ code: schema.permissions.code })
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(
        and(
          inArray(schema.rolePermissions.roleId, roleIds),
          eq(schema.permissions.status, 'ACTIVE')
        )
      );

    // 5. 确定数据范围类型 (多角色场景下取最高级别的数据权限)
    const dataScopeTypes: DataScopeType[] = ['ALL', 'DEPT_AND_SUB', 'DEPT', 'CUSTOM', 'SELF'];
    let maxDataScopeType: DataScopeType = 'SELF';

    for (const role of roles) {
      const roleDataScope = role.dataScopeType as DataScopeType;
      if (dataScopeTypes.indexOf(roleDataScope) < dataScopeTypes.indexOf(maxDataScopeType)) {
        maxDataScopeType = roleDataScope;
      }
    }

    const context: UserPermissionContext = {
      roles: roles.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
      permissions: permissionsData.map(p => p.code),
      dataScopeType: maxDataScopeType,
      deptId: user.deptId ?? undefined,
    };

    // 6. 将结果回写至 Redis 缓存，设定 5 分钟 (300秒) 的生存周期
    if (redis) {
      try {
        await redis.setex(cacheKey, 300, JSON.stringify(context));
      } catch (cacheWriteError: any) {
        console.warn(`[PermissionContext] Redis cache write failed for user ${userId}:`, cacheWriteError.message);
      }
    }

    return context;
  } catch (error: any) {
    console.error('[PermissionContext] Database query error:', error.message, error.stack);
    return null;
  }
}

/**
 * 清除指定用户的权限上下文缓存
 * 常用于用户基础信息修改、分配新角色等场景
 * @param userId 用户 ID
 */
export async function clearUserPermissionCache(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    const cacheKey = `portal:user_perms:${userId}`;
    await redis.del(cacheKey);
    console.log(`[PermissionContext] Cleared permissions cache for user: ${userId}`);
  } catch (error: any) {
    console.error(`[PermissionContext] Failed to clear permission cache for user ${userId}:`, error.message);
  }
}

/**
 * 批量清除指定用户的权限上下文缓存
 * 常用于角色权限变更、角色数据范围更新等会影响大批用户的场景
 * @param userIds 用户 ID 数组
 */
export async function clearUsersPermissionCache(userIds: string[]): Promise<void> {
  if (!userIds || userIds.length === 0) return;
  try {
    const redis = getRedis();
    await Promise.all(
      userIds.map(async (userId) => {
        const cacheKey = `portal:user_perms:${userId}`;
        await redis.del(cacheKey);
      })
    );
    console.log(`[PermissionContext] Batch cleared permissions cache for ${userIds.length} users`);
  } catch (error: any) {
    console.error('[PermissionContext] Failed to batch clear permissions cache:', error.message);
  }
}