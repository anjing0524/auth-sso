import 'server-only';

/**
 * 审计日志服务模块
 * 提供对用户登录日志 (LoginLogs) 和核心操作审计日志 (AuditLogs) 的统一入库与装饰器式包装记录。
 * 具备严密的 try-catch 故障隔离，确保存储介质 (如数据库) 异常时绝对不阻塞或干扰核心业务故事链路的顺利运转。
 */
import { db, schema } from '@/lib/db';
import { NextRequest } from 'next/server';
import { generateId } from './crypto';

/**
 * 获取 HTTP 请求的真实客户端 IP 地址
 * 按照常见代理头部的优先级依次解析 x-forwarded-for 与 x-real-ip
 *
 * @param request NextRequest 请求对象
 * @returns 解析得到的客户端 IP 地址，若无法解析则返回 'unknown'
 */
export function getClientIP(request: NextRequest): string {
  try {
    const xForwardedFor = request.headers.get('x-forwarded-for');
    if (xForwardedFor) {
      return xForwardedFor.split(',')[0].trim();
    }
    const xRealIP = request.headers.get('x-real-ip');
    if (xRealIP) {
      return xRealIP;
    }
  } catch (error) {
    console.error('[Audit getClientIP] Failed to parse request headers for IP:', error);
  }
  return 'unknown';
}

/**
 * 登录/认证相关事件类型
 */
export type LoginEventType =
  | 'LOGIN_SUCCESS'         // 登录成功
  | 'LOGIN_FAILED'          // 登录失败
  | 'LOGOUT'                // 登出
  | 'TOKEN_REFRESH'         // Token 刷新成功
  | 'TOKEN_REFRESH_FAILED'; // Token 刷新失败

/**
 * 核心业务操作审计类型
 */
export type AuditOperation =
  | 'USER_CREATE'              // 创建用户
  | 'USER_UPDATE'              // 更新用户
  | 'USER_DELETE'              // 删除用户
  | 'USER_ROLE_ASSIGN'         // 分配角色
  | 'ROLE_CREATE'              // 创建角色
  | 'ROLE_UPDATE'              // 更新角色
  | 'ROLE_DELETE'              // 删除角色
  | 'ROLE_PERMISSION_ASSIGN'   // 分配权限
  | 'PERMISSION_CREATE'        // 创建权限
  | 'PERMISSION_UPDATE'        // 更新权限
  | 'PERMISSION_DELETE'        // 删除权限
  | 'DEPARTMENT_CREATE'        // 创建部门
  | 'DEPARTMENT_UPDATE'        // 更新部门
  | 'DEPARTMENT_DELETE'        // 删除部门
  | 'CLIENT_CREATE'            // 创建 Client
  | 'CLIENT_UPDATE'            // 更新 Client
  | 'CLIENT_DELETE'            // 删除 Client
  | 'CLIENT_SECRET_REGENERATE' // 重新生成 Secret
  | 'TOKEN_REVOKE';            // 撤销 Token

/**
 * 登录日志载荷参数接口
 */
export interface LoginLogParams {
  /** 关联的用户唯一标识 ID，匿名失败时可为空 */
  userId?: string;
  /** 登录尝试所使用的用户名/邮箱 */
  username: string;
  /** 登录事件类型 */
  eventType: LoginEventType;
  /** 客户端 IP 地址 */
  ip?: string;
  /** 客户端 User-Agent */
  userAgent?: string;
  /** 地理位置信息 (可选) */
  location?: string;
  /** 登录失败原因阐述 (成功时为空) */
  failReason?: string;
}

/**
 * 审计日志载荷参数接口
 */
export interface AuditLogParams {
  /** 操作发起者用户 ID */
  userId?: string;
  /** 操作发起者用户名 */
  username?: string;
  /** 审计操作类型 */
  operation: AuditOperation;
  /** HTTP 请求方法 (如 GET, POST) */
  method?: string;
  /** 请求路径/URL */
  url?: string;
  /** 关键请求参数或载荷的 JSON 序列化字符串 */
  params?: string;
  /** 客户端 IP 地址 */
  ip?: string;
  /** 客户端 User-Agent */
  userAgent?: string;
  /** HTTP 响应状态码 */
  status?: number;
  /** 操作执行耗时 (毫秒) */
  duration?: number;
  /** 捕获到的异常或错误描述 */
  errorMsg?: string;
}

/**
 * 异步记录用户登录与认证事件日志
 * 本方法全量包裹 try-catch 防护，确保存储端发生任何阻塞或异常时，主登录验证业务绝不崩溃
 *
 * @param params 登录日志入参对象
 */
export async function logLoginEvent(params: LoginLogParams): Promise<void> {
  try {
    // 废止局部 generateId 函数，静态导入并复用全局统一的 crypto 工具，保障 DRY
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
    // 隔离性故障拦截：审计写操作失败不阻断核心主登录验证故事链路
    console.error('[Audit logLoginEvent] Failed to write login event log to database:', error);
  }
}

/**
 * 异步记录敏感操作审计日志
 * 本方法全量包裹 try-catch 防护，操作审计即便发生数据库死锁、连接池满等故障，业务请求也应安全返回
 *
 * @param params 审计日志入参对象
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    // 废止局部 generateId 函数，静态导入并复用全局统一的 crypto 工具，保障 DRY
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
    // 隔离性故障拦截：审计写操作失败不阻塞主业务操作故事链路
    console.error('[Audit logAuditEvent] Failed to write audit event log to database:', error);
  }
}

/**
 * 审计日志高阶异步函数包装器 (装饰器)
 * 用于自动包装执行函数，高精度捕获耗时、执行状态及异常详情并自动生成审计条目。
 *
 * @template T 目标函数的返回值类型
 * @param operation 预备捕获的审计操作类型
 * @param fn 核心执行的业务逻辑回调函数
 * @param getAuditContext 获取审计基础上下文 (如 IP, UserAgent) 的同步/异步函数
 * @returns 返回目标业务函数执行的结果
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
      } catch (innerError) {
        // 高可用的最后防线：若获取审计上下文或写入审计表本身抛出意外，坚决不吞没上层的核心业务 Exception，仅日志记录
        console.error('[Audit withAuditLog] Unexpected error during writing audit log post-execution:', innerError);
      }
    }
  })();
}