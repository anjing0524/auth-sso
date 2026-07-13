import 'server-only';
import { getEnvConfig } from '@auth-sso/config';

/**
 * 结构化日志工具 (Structured Logger)
 *
 * 统一日志输出格式：{level, component, message, timestamp, ...context}
 * 受 LOG_LEVEL 环境变量控制（debug < info < warn < error）。
 * 零外部依赖，纯 console + JSON.stringify 实现。
 *
 * @module lib/logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  // 从 @auth-sso/config 统一校验路径读取 LOG_LEVEL
  try {
    const config = getEnvConfig();
    if (config.LOG_LEVEL && config.LOG_LEVEL in LEVEL_ORDER) return config.LOG_LEVEL;
  } catch {
    // 降级：config 包异常时 fallback 到 process.env 直接读取
    const raw = process.env['LOG_LEVEL'];
    if (raw && raw in LEVEL_ORDER) return raw as LogLevel;
  }
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getConfiguredLevel()];
}

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

function formatLog(level: LogLevel, component: string, message: string, context?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    component,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  });
}

/**
 * 创建带组件标签的结构化日志记录器
 *
 * @param component - 日志来源组件名（如 'PermissionContext', 'Token', 'Audit'）
 * @returns 拥有 debug/info/warn/error 方法的 Logger 对象
 *
 * @example
 * const log = createLogger('PermissionContext');
 * log.info('Cache refreshed', { userId: 'abc' });
 * // → {"level":"info","component":"PermissionContext","message":"Cache refreshed","timestamp":"...","userId":"abc"}
 */
export function createLogger(component: string): Logger {
  return {
    debug(message, context) {
      if (shouldLog('debug')) {
        console.debug(formatLog('debug', component, message, context));
      }
    },
    info(message, context) {
      if (shouldLog('info')) {
        console.info(formatLog('info', component, message, context));
      }
    },
    warn(message, context) {
      if (shouldLog('warn')) {
        console.warn(formatLog('warn', component, message, context));
      }
    },
    error(message, context) {
      if (shouldLog('error')) {
        console.error(formatLog('error', component, message, context));
      }
    },
  };
}
