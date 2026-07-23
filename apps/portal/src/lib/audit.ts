import 'server-only';

/**
 * 审计与日志工具模块 (Audit & Logging Utilities)
 *
 * 集中管理登录日志（login_logs）和操作审计日志（audit_logs）的写入。
 * 采用 fire-and-forget 模式：直接写入 DB，不缓冲、不阻塞主流程。
 *
 * @module lib/audit
 */
import { db, schema } from '@/infrastructure/db';
import type { AuditOperation, LoginEventType } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';

const log = createLogger('Audit');

async function fireAndForgetWithRetry(factory: () => Promise<unknown>, maxRetries: number = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await factory();
      return;
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        log.error('审计日志写入最终失败', {
          error: err instanceof Error ? err.message : String(err),
          attempts: maxRetries,
        });
      }
    }
  }
}

function fireAndForget(factory: () => Promise<unknown>): void {
  fireAndForgetWithRetry(factory).catch(() => {});
}

// ========================================
// 登录日志
// ========================================

export interface WriteLoginLogParams {
  userId?: string | null;
  username: string;
  eventType: LoginEventType;
  ip?: string | null;
  userAgent?: string | null;
  location?: string | null;
  failReason?: string | null;
}

export function writeLoginLog(params: WriteLoginLogParams): void {
  fireAndForget(() =>
    db.insert(schema.loginLogs).values({
      userId: params.userId || null,
      username: params.username,
      eventType: params.eventType,
      ip: params.ip || null,
      userAgent: params.userAgent || null,
      location: params.location || null,
      failReason: params.failReason || null,
    })
  );
}

// ========================================
// 操作审计日志
// ========================================

export interface WriteAuditLogParams {
  userId: string;
  username?: string | null;
  operation: AuditOperation;
  method?: string | null;
  url?: string | null;
  params?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  status?: number | null;
  duration?: number | null;
  errorMsg?: string | null;
}

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toAuditLogRow(params: WriteAuditLogParams) {
  return {
    userId: params.userId,
    username: params.username || null,
    operation: params.operation,
    method: params.method || null,
    url: params.url || null,
    params: params.params || null,
    ip: params.ip || null,
    userAgent: params.userAgent || null,
    status: params.status ?? null,
    duration: params.duration ?? null,
    errorMsg: params.errorMsg || null,
  };
}

/**
 * 将安全审计记录写入业务事务。
 *
 * 敏感写操作仅在业务写入与审计记录同时提交时才可向调用方返回成功。
 */
export async function appendSecurityAudit(
  tx: DrizzleTransaction,
  params: WriteAuditLogParams,
): Promise<void> {
  await tx.insert(schema.auditLogs).values(toAuditLogRow(params));
}

export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  await db.insert(schema.auditLogs).values(toAuditLogRow(params));
}

export async function recordActionAudit(userId: string, operation: AuditOperation): Promise<void> {
  const { headers } = await import('next/headers');
  const h = await headers();
  await writeAuditLog({
    userId,
    operation,
    method: h.get('x-action-method') || 'ACTION',
    url: h.get('x-action-path') || null,
    ip: extractClientIP(h),
    userAgent: extractUserAgent(h),
    status: 200,
  });
}

export async function recordApiAudit(userId: string, operation: AuditOperation): Promise<void> {
  const { headers } = await import('next/headers');
  const h = await headers();
  await writeAuditLog({
    userId,
    operation,
    method: h.get('x-action-method') || 'API',
    url: h.get('x-action-path') || null,
    ip: extractClientIP(h),
    userAgent: extractUserAgent(h),
    status: 200,
  });
}

// ========================================
// 访问日志
// ========================================

export interface WriteAccessLogParams {
  userId: string;
  username?: string | null;
  method: string;
  path: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  status?: number | null;
  duration?: number | null;
}

export function writeAccessLog(params: WriteAccessLogParams): void {
  fireAndForget(() =>
    db.insert(schema.accessLogs).values({
      userId: params.userId,
      username: params.username || null,
      method: params.method,
      path: params.path,
      resourceType: params.resourceType || null,
      resourceId: params.resourceId || null,
      ip: params.ip || null,
      userAgent: params.userAgent || null,
      status: params.status ?? null,
      duration: params.duration ?? null,
    })
  );
}

// ========================================
// HTTP 元数据提取
// ========================================

export function extractClientIP(headers: Headers): string | null {
  return (
    headers.get('X-Client-IP') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null
  );
}

export function extractUserAgent(headers: Headers): string | null {
  return (
    headers.get('X-Client-UA') ||
    headers.get('user-agent') ||
    null
  );
}
