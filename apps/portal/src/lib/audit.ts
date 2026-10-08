import 'server-only';

/**
 * 审计与日志工具模块 (Audit & Logging Utilities)
 *
 * ## 三档持久性等级（interface 的一部分，见 ADR-020）
 *
 * 本模块承载三种**语义不同**的记录，其中止策略也不同。调用方必须按档选择，
 * 不能把它们当同一回事：
 *
 * | 档 | 函数 | 与业务写入的关系 | 失败时 |
 * |---|---|---|---|
 * | **① 安全审计** | {@link appendSecurityAudit} | **同一事务**：业务写入与审计要么同提交、要么同回滚 | 抛出，业务一并回滚 |
 * | **② 控制面事件** | {@link recordActionAudit} / {@link recordApiAudit} | **业务已提交之后**的补记，无事务绑定 | **永不抛出**：自身吞掉并记日志，不影响响应 |
 * | **③ 运维观测** | `writeLoginLog` / `writeAccessLog` | 与业务无关的旁路记录 | 重试 3 次后放弃并记日志 |
 *
 * 之所以把②做成"永不抛出"：它发生在业务已提交之后，若让失败上抛，
 * 调用方会把一个**已成功**的写操作返回成失败——调用方据此重试可能造成重复写入。
 * 一个没有事务绑定的补记，没有资格推翻业务结果。
 *
 * @module lib/audit
 * @impl J-LOG-003 — 关键操作自动记录（登录/登出/权限变更等）
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
 * 将安全审计记录写入业务事务（档①）。
 *
 * 敏感写操作仅在业务写入与审计记录**同时提交**时才可向调用方返回成功。
 * 因此本函数**应当抛出**：失败时异常传播到事务边界，业务写入一并回滚。
 * 与档②的"永不抛出"是刻意相反的策略——两者的差别正是"是否与业务同事务"。
 */
export async function appendSecurityAudit(
  tx: DrizzleTransaction,
  params: WriteAuditLogParams,
): Promise<void> {
  await tx.insert(schema.auditLogs).values(toAuditLogRow(params));
}

async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  await db.insert(schema.auditLogs).values(toAuditLogRow(params));
}

/**
 * 控制面事件的尽力补记（档②）。
 *
 * **永不抛出**：业务写入此时已提交，审计失败不得推翻它（详见模块头）。
 * 失败仅记日志。
 */
async function recordControlPlaneAudit(
  userId: string,
  operation: AuditOperation,
  fallbackMethod: string,
): Promise<void> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    await writeAuditLog({
      userId,
      operation,
      method: h.get('x-action-method') || fallbackMethod,
      url: h.get('x-action-path') || null,
      ip: extractClientIP(h),
      userAgent: extractUserAgent(h),
      status: 200,
    });
  } catch (err) {
    log.error('控制面审计补记失败（不影响已提交的业务写入）', {
      userId,
      operation,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Server Action 的控制面审计补记。**永不抛出**（档②）。 */
export async function recordActionAudit(userId: string, operation: AuditOperation): Promise<void> {
  await recordControlPlaneAudit(userId, operation, 'ACTION');
}

/** API 路由的控制面审计补记。**永不抛出**（档②）。 */
export async function recordApiAudit(userId: string, operation: AuditOperation): Promise<void> {
  await recordControlPlaneAudit(userId, operation, 'API');
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
