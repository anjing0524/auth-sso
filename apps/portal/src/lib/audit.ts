/**
 * 审计日志工具
 * 用于记录用户操作、登录事件、权限变更等审计信息
 */
import { db, schema } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * 生成随机 ID
 */
function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 登录事件类型
 */
export type LoginEventType =
  | 'LOGIN_SUCCESS'      // 登录成功
  | 'LOGIN_FAILED'       // 登录失败
  | 'LOGOUT'             // 登出
  | 'TOKEN_REFRESH'      // Token 刷新成功
  | 'TOKEN_REFRESH_FAILED'; // Token 刷新失败

/**
 * 审计操作类型
 */
export type AuditOperation =
  | 'USER_CREATE'        // 创建用户
  | 'USER_UPDATE'        // 更新用户
  | 'USER_DELETE'        // 删除用户
  | 'USER_ROLE_ASSIGN'   // 分配角色
  | 'ROLE_CREATE'        // 创建角色
  | 'ROLE_UPDATE'        // 更新角色
  | 'ROLE_DELETE'        // 删除角色
  | 'ROLE_PERMISSION_ASSIGN' // 分配权限
  | 'PERMISSION_CREATE'  // 创建权限
  | 'PERMISSION_UPDATE'  // 更新权限
  | 'PERMISSION_DELETE'  // 删除权限
  | 'DEPARTMENT_CREATE'  // 创建部门
  | 'DEPARTMENT_UPDATE'  // 更新部门
  | 'DEPARTMENT_DELETE'  // 删除部门
  | 'CLIENT_CREATE'      // 创建 Client
  | 'CLIENT_UPDATE'      // 更新 Client
  | 'CLIENT_DELETE'      // 删除 Client
  | 'CLIENT_SECRET_REGENERATE' // 重新生成 Secret
  | 'TOKEN_REVOKE';      // 撤销 Token

/**
 * 登录日志参数
 */
export interface LoginLogParams {
  userId?: string;
  username: string;
  eventType: LoginEventType;
  ip?: string;
  userAgent?: string;
  location?: string;
  failReason?: string;
}

/**
 * 审计日志参数
 */
export interface AuditLogParams {
  userId?: string;
  username?: string;
  operation: AuditOperation;
  method?: string;
  url?: string;
  params?: string;
  ip?: string;
  userAgent?: string;
  status?: number;
  duration?: number;
  errorMsg?: string;
}

/**
 * 记录登录日志
 */
export async function logLoginEvent(params: LoginLogParams): Promise<void> {
  try {
    const id = generateId(20);

    await db.insert(schema.loginLogs).values({
      id,
      userId: params.userId ?? null,
      username: params.username,
      eventType: params.eventType,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      location: params.location ?? null,
      failReason: params.failReason ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    // 审计日志写入失败不应影响主流程
    console.error('[Audit] Failed to log login event:', error);
  }
}

/**
 * 记录审计日志
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    const id = generateId(20);

    await db.insert(schema.auditLogs).values({
      id,
      userId: params.userId ?? null,
      username: params.username ?? null,
      operation: params.operation,
      method: params.method ?? null,
      url: params.url ?? null,
      params: params.params ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      status: params.status ?? null,
      duration: params.duration ?? null,
      errorMsg: params.errorMsg ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    // 审计日志写入失败不应影响主流程
    console.error('[Audit] Failed to log audit event:', error);
  }
}

/**
 * 审计日志装饰器
 * 用于包装需要记录审计日志的函数
 */
export function withAuditLog<T>(
  operation: AuditOperation,
  fn: () => Promise<T>,
  getAuditContext: () => Promise<AuditLogParams> | AuditLogParams
): Promise<T> {
  return (async () => {
    const startTime = Date.now();
    let status = 200;
    let errorMsg: string | undefined;

    try {
      const result = await fn();
      return result;
    } catch (error) {
      status = 500;
      errorMsg = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      try {
        const context = await getAuditContext();
        await logAuditEvent({
          ...context,
          operation,
          status,
          duration: Date.now() - startTime,
          errorMsg,
        });
      } catch {
        // 审计日志记录失败不影响主流程
      }
    }
  })();
}