import 'server-only';
import pino from 'pino';
import { getEnvConfig } from '@auth-sso/config';

/**
 * 结构化日志工具 (Structured Logger)
 *
 * 底层引擎：pino（17M+ 周下载，业界最快的 JSON logger）
 * API 保持与旧版 100% 兼容：createLogger(component) → { debug, info, warn, error }
 *
 * 输出格式：pino 原生 JSON（含 level/name/msg/time/...字段），
 * 可通过 pino-pretty 管道格式化（开发环境）或直接接入日志采集器（生产环境）。
 *
 * @module lib/logger
 */

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

/** 从 Zod 校验路径读取 LOG_LEVEL，fallback 到 'info' */
function getConfiguredLevel(): pino.LevelWithSilent {
  try {
    const config = getEnvConfig();
    // pino 支持的标准级别：trace/debug/info/warn/error/fatal/silent
    if (config.LOG_LEVEL) {
      const level = config.LOG_LEVEL as string;
      if (['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(level)) {
        return level as pino.LevelWithSilent;
      }
    }
  } catch {
    // config 包异常时 fallback
    const raw = process.env['LOG_LEVEL'];
    if (raw && ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(raw)) {
      return raw as pino.LevelWithSilent;
    }
  }
  return 'info';
}

/**
 * 创建带组件标签的 pino 日志记录器
 *
 * @param component - 日志来源组件名（如 'PermissionContext', 'Token', 'Audit'），设为 pino 的 name 字段
 * @returns 拥有 debug/info/warn/error 方法的 Logger 对象（API 与旧版完全兼容）
 *
 * @example
 * const log = createLogger('PermissionContext');
 * log.info('Cache refreshed', { userId: 'abc' });
 * // → {"level":30,"time":"...","name":"PermissionContext","msg":"Cache refreshed","userId":"abc"}
 */
export function createLogger(component: string): Logger {
  const p = pino({
    name: component,
    level: getConfiguredLevel(),
    // pino 默认输出到 stdout，格式为 JSON Lines（pino-pretty 可管道美化）
    // 生产环境可直接接入 Vector / Fluentd / Loki 等日志采集器
  });

  return {
    debug(message, context) {
      if (context) {
        p.debug(context, message);
      } else {
        p.debug(message);
      }
    },
    info(message, context) {
      if (context) {
        p.info(context, message);
      } else {
        p.info(message);
      }
    },
    warn(message, context) {
      if (context) {
        p.warn(context, message);
      } else {
        p.warn(message);
      }
    },
    error(message, context) {
      if (context) {
        p.error(context, message);
      } else {
        p.error(message);
      }
    },
  };
}
