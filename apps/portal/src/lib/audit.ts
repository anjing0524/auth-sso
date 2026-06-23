import 'server-only';

/**
 * 审计日志服务模块
 * 提供对用户登录日志 (LoginLogs) 和核心操作审计日志 (AuditLogs) 的统一入库与装饰器式包装记录。
 * 具备严密的 try-catch 故障隔离，确保存储介质异常时绝不阻塞或干扰核心业务链路。
 *
 * @module lib/audit
 */
import { db, schema } from '@/infrastructure/db';
import type { AuditParams } from '@/db/schema/logs';
import { NextRequest } from 'next/server';
import { generateUUID } from '@/lib/crypto';
import { type LoginEventType, type AuditOperation } from '@auth-sso/contracts';

/**
 * 将请求 IP 规整为可写入 inet 列的合法值。
 * 代理链取首个 IP；非法/空值返回 null，避免 PG inet 类型写入异常。
 */
export function sanitizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const candidate = ip.split(',')[0].trim();
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  if (ipv4.test(candidate) || (candidate.includes(':') && ipv6.test(candidate))) {
    return candidate;
  }
  return null;
}

/**
 * 获取 HTTP 请求的真实客户端 IP 地址
 * 按照常见代理头部的优先级依次解析 x-forwarded-for 与 x-real-ip
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

// AuditOperation 类型已迁移至 @auth-sso/contracts，此处直接从 contracts 导入使用

export interface LoginLogParams {
  userId?: string;
  username: string;
  eventType: LoginEventType;
  ip?: string;
  userAgent?: string;
  location?: string;
  failReason?: string;
}

export interface AuditLogParams {
  userId?: string;
  username?: string;
  operation: AuditOperation;
  method?: string;
  url?: string;
  /** 结构化请求参数，以 jsonb 入库（替代旧的 text 字符串） */
  params?: AuditParams;
  ip?: string;
  userAgent?: string;
  status?: number;
  duration?: number;
  errorMsg?: string;
}

/**
 * 异步记录用户登录与认证事件日志
 */
export async function logLoginEvent(params: LoginLogParams): Promise<void> {
  try {
    await db.insert(schema.loginLogs).values({
      id: generateUUID(),
      userId: params.userId ?? null,
      username: params.username,
      eventType: params.eventType,
      ip: sanitizeIp(params.ip),
      userAgent: params.userAgent ?? null,
      location: params.location ?? null,
      failReason: params.failReason ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('[Audit logLoginEvent] Failed to write login event log:', error);
  }
}

/**
 * 异步记录敏感操作审计日志
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      id: generateUUID(),
      userId: params.userId ?? null,
      username: params.username ?? null,
      operation: params.operation,
      method: params.method ?? null,
      url: params.url ?? null,
      params: params.params ?? null,
      ip: sanitizeIp(params.ip),
      userAgent: params.userAgent ?? null,
      status: params.status ?? null,
      duration: params.duration ?? null,
      errorMsg: params.errorMsg ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('[Audit logAuditEvent] Failed to write audit event log:', error);
  }
}

/**
 * 审计日志高阶异步函数包装器 (装饰器)
 */
export function withAuditLog<T>(
  operation: AuditOperation,
  fn: () => Promise<T>,
  getAuditContext: () => Promise<AuditLogParams> | AuditLogParams,
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
        console.error('[Audit withAuditLog] Unexpected error during audit logging:', innerError);
      }
    }
  })();
}
