import 'server-only';

/**
 * 审计与日志工具模块 (Audit & Logging Utilities)
 *
 * 集中管理登录日志（login_logs）和操作审计日志（audit_logs）的写入。
 * 所有写入采用 fire-and-forget 模式，不阻塞认证主流程。
 *
 * @module lib/audit
 */
import { db, schema } from '@/infrastructure/db';
import type { LoginEventType } from '@auth-sso/contracts';

/**
 * 登录日志写入参数
 */
export interface WriteLoginLogParams {
  /** 用户 ID（登录失败时可能为 null，因为用户可能不存在） */
  userId?: string | null;
  /** 用户名（冗余存储，确保用户删除后日志仍可读） */
  username: string;
  /** 登录事件类型 */
  eventType: LoginEventType;
  /** 客户端 IP 地址 */
  ip?: string | null;
  /** 客户端 User-Agent */
  userAgent?: string | null;
  /** 地理位置（暂不实现，预留字段） */
  location?: string | null;
  /** 失败原因（仅 LOGIN_FAILED / TOKEN_REFRESH_FAILED 时填写） */
  failReason?: string | null;
}

/**
 * 写登录日志（fire-and-forget，不阻塞主流程）
 *
 * 写入失败仅记录 console.error，不影响认证结果。
 * 用于满足 I-LOG-003「关键操作自动记录」需求。
 *
 * @param params 登录日志参数
 */
export function writeLoginLog(params: WriteLoginLogParams): void {
  db.insert(schema.loginLogs)
    .values({
      userId: params.userId || null,
      username: params.username,
      eventType: params.eventType,
      ip: params.ip || null,
      userAgent: params.userAgent || null,
      location: params.location || null,
      failReason: params.failReason || null,
    })
    .catch((err) => console.error('[Audit] 写登录日志失败:', err));
}

/**
 * 从请求 Headers 中提取客户端 IP
 */
export function extractClientIP(headers: Headers): string | null {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    null
  );
}

/**
 * 从请求 Headers 中提取 User-Agent
 */
export function extractUserAgent(headers: Headers): string | null {
  return headers.get('user-agent') || null;
}
