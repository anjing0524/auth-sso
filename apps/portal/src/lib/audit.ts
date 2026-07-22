import 'server-only';

/**
 * 审计与日志工具模块 (Audit & Logging Utilities)
 *
 * 集中管理登录日志（login_logs）和操作审计日志（audit_logs）的写入。
 * 内存环形缓冲区 + 定时批量刷写，确保 DB 暂不可用时审计不丢。
 *
 * @module lib/audit
 */
import { db, schema } from '@/infrastructure/db';
import type { AuditOperation, LoginEventType } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';

const log = createLogger('Audit');

/** 内存缓冲区最大条目数（防止内存泄漏） */
const MAX_BUFFER_SIZE = 1000;
/** 批量刷写间隔（毫秒） */
const FLUSH_INTERVAL_MS = 5000;

/** 缓冲条目 */
interface LogEntry {
  tableName: 'loginLogs' | 'auditLogs' | 'accessLogs';
  values: Record<string, unknown>;
}

/** 内存环形缓冲区 */
const logBuffer: LogEntry[] = [];

/** 定时批量刷写缓冲区到 DB */
async function flushBuffer(): Promise<void> {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.splice(0);
  for (const entry of batch) {
    try {
      const table = schema[entry.tableName];
      // Drizzle insert 需要列类型匹配；使用类型断言保持编译通过（值已在 buildValues 中校验）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.insert(table) as any).values(entry.values);
    } catch (err) {
      log.error(`审计日志批量写入失败 (${entry.tableName})`, { error: (err as Error).message });
    }
  }
}

// 启动定时刷写（Node.js 环境中 setInterval 不影响事件循环退出）
// globalThis 防 Next.js 热重载（HMR）重复创建 timer
const AUDIT_TIMER_KEY = Symbol.for('auth-sso.audit.flushTimer');
if (!(globalThis as Record<symbol, unknown>)[AUDIT_TIMER_KEY]) {
  const flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) {
    flushTimer.unref();
  }
  (globalThis as Record<symbol, unknown>)[AUDIT_TIMER_KEY] = flushTimer;
}

// 进程退出前最后一次 flush，减少优雅关闭时缓冲数据丢失

function gracefulShutdown(signal: string) {
  log.info(`收到 ${signal} 信号，刷写审计缓冲区后退出`);
  const timeout = setTimeout(() => {
    log.warn('审计缓冲区刷写超时（8s），强制退出');
    process.exit(1);
  }, 8000);
  flushBuffer().finally(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}

// beforeExit：事件循环自然清空时触发（正常退出兜底）
process.on('beforeExit', async () => {
  await flushBuffer();
});

// SIGTERM（Docker stop）/ SIGINT（Ctrl+C）：显式信号触发时刷写后退出
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
// 进程崩溃（OOM/SIGKILL）无法覆盖 — 极限情况下最多丢失 5s 缓冲窗口的数据

/**
 * 通用日志写入工厂
 *
 * @param tableName  - Drizzle 表名（keyof schema）
 * @param buildValues - 将参数映射为表字段的值工厂
 */
function createLogWriter<TParams>(
  tableName: 'loginLogs' | 'auditLogs' | 'accessLogs',
  buildValues: (params: TParams) => Record<string, unknown>,
): (params: TParams) => void {
  return (params: TParams) => {
    const values = buildValues(params);
    // 写入内存缓冲区（防止 DB 暂不可用造成丢失）
    logBuffer.push({ tableName, values });
    // 缓冲区保护：超过上限时同步刷写一批
    if (logBuffer.length > MAX_BUFFER_SIZE) {
      void flushBuffer();
    }
  };
}

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
 * 写入失败仅记录结构化日志，不影响认证结果。
 * 用于满足 I-LOG-003「关键操作自动记录」需求。
 */
export const writeLoginLog = createLogWriter<WriteLoginLogParams>(
  'loginLogs',
  (params) => ({
    userId: params.userId || null,
    username: params.username,
    eventType: params.eventType,
    ip: params.ip || null,
    userAgent: params.userAgent || null,
    location: params.location || null,
    failReason: params.failReason || null,
  }),
);

/**
 * 操作审计日志写入参数
 */
export interface WriteAuditLogParams {
  /** 操作者用户 ID */
  userId: string;
  /** 操作者用户名（冗余存储，确保用户删除后日志仍可读） */
  username?: string | null;
  /** 审计操作类型 */
  operation: AuditOperation;
  /** HTTP 方法 */
  method?: string | null;
  /** 请求 URL */
  url?: string | null;
  /** 业务参数（jsonb，统一拦截层无法感知，需调用方自行传入） */
  params?: Record<string, unknown> | null;
  /** 客户端 IP 地址 */
  ip?: string | null;
  /** 客户端 User-Agent */
  userAgent?: string | null;
  /** 操作结果状态码（成功记 200） */
  status?: number | null;
  /** 耗时（毫秒） */
  duration?: number | null;
  /** 错误信息（失败时填写） */
  errorMsg?: string | null;
}

/**
 * 写操作审计日志（fire-and-forget，不阻塞主流程）
 *
 * 用于满足 DC-AUDIT-IMMUTABLE / FR-LOG-01~03 / NFR-SEC-07。
 */
export const writeAuditLog = createLogWriter<WriteAuditLogParams>(
  'auditLogs',
  (params) => ({
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
  }),
);

/**
 * 从请求 Headers 中提取客户端 IP
 *
 * 优先读取 Gateway 注入的受信 X-Client-IP；
 * 无 Gateway（本地开发）时回退到 X-Forwarded-For。
 */
export function extractClientIP(headers: Headers): string | null {
  return (
    headers.get('X-Client-IP') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null
  );
}

/**
 * 从请求 Headers 中提取 User-Agent
 *
 * 优先读取 Gateway 注入的 X-Client-UA；
 * 无 Gateway 时回退到原始 User-Agent。
 */
export function extractUserAgent(headers: Headers): string | null {
  return (
    headers.get('X-Client-UA') ||
    headers.get('user-agent') ||
    null
  );
}

// ========================================
// 访问日志（access_logs — 读操作合规追溯）
// ========================================

/**
 * 访问日志写入参数
 */
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

/**
 * 写访问日志（fire-and-forget）
 *
 * 记录所有 GET 敏感数据访问，用于合规追溯"谁查看了哪条数据"。
 */
export const writeAccessLog = createLogWriter<WriteAccessLogParams>(
  'accessLogs',
  (params) => ({
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
  }),
);


