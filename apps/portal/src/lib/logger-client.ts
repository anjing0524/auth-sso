/**
 * 浏览器端日志工具 (Client Logger)
 *
 * 与 server 端 createLogger 保持相同 API（debug/info/warn/error），
 * 在浏览器中直接输出到 console，支持 devtools 格式化查看。
 *
 * @module lib/logger-client
 */

export interface ClientLogger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * 创建浏览器端日志记录器
 *
 * @param component - 日志来源组件名（如 'LoginForm', 'ClientsPage'）
 * @returns 拥有 debug/info/warn/error 方法的 ClientLogger 对象
 *
 * @example
 * const log = createClientLogger('LoginForm');
 * log.error('登录失败', { error: 'Invalid credentials' });
 */
export function createClientLogger(component: string): ClientLogger {
  const prefix = `[${component}]`;
  return {
    debug(message, context) {
      console.debug(prefix, message, context ?? '');
    },
    info(message, context) {
      console.info(prefix, message, context ?? '');
    },
    warn(message, context) {
      console.warn(prefix, message, context ?? '');
    },
    error(message, context) {
      console.error(prefix, message, context ?? '');
    },
  };
}
