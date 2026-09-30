import 'server-only';

/**
 * OAuth Client 凭证解析（RFC 6749 §2.3.1）
 *
 * 与 discovery 广告的 `TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED` 对齐，支持两条认证通道：
 * - client_secret_basic：`Authorization: Basic base64(client_id:client_secret)`——
 *   两个值按 application/x-www-form-urlencoded 编码后以冒号拼接，解析时须逐段解码
 * - client_secret_post：请求体 client_id / client_secret 字段
 *
 * Basic 与 body 凭证并存时以 Basic 为准；两者不一致视为凭证混淆，拒绝。
 * token / introspect / revoke 三个端点共用本解析，消除凭证来源漂移。
 *
 * @module lib/auth/client-credentials
 */
import { InvalidClientError } from '@/domain/shared/errors';

export interface ClientCredentials {
  clientId: string;
  clientSecret?: string;
}

/**
 * 从请求解析 OAuth Client 凭证：优先 Basic 头，回退请求体字段。
 *
 * @param request - 原始请求（读取 Authorization 头）
 * @param body - parseOAuthBody 输出的扁平键值对
 * @returns 凭证对；client_id 缺失时抛 InvalidClientError（映射为 401 invalid_client）
 */
export function resolveClientCredentials(request: Request, body: Record<string, string>): ClientCredentials {
  const basic = parseBasicAuth(request.headers.get('authorization'));
  if (!basic) {
    if (!body.client_id) {
      throw new InvalidClientError('缺少 client_id（Basic 头或请求体均未提供）');
    }
    return { clientId: body.client_id, clientSecret: body.client_secret || undefined };
  }

  // 双通道并存：以 Basic 为准，body 凭证若存在且不一致 → 凭证混淆，拒绝
  if (body.client_id && body.client_id !== basic.clientId) {
    throw new InvalidClientError('client_id 在 Basic 头与请求体中不一致');
  }
  if (body.client_secret && basic.clientSecret && body.client_secret !== basic.clientSecret) {
    throw new InvalidClientError('client_secret 在 Basic 头与请求体中不一致');
  }
  return basic;
}

/**
 * 解析 `Authorization: Basic` 头。
 *
 * RFC 6749 §2.3.1：client_id 与 client_secret 先各自做
 * application/x-www-form-urlencoded 编码，再以 `:` 拼接后 base64。
 * client_id 编码后不含 `:`，故按首个冒号切分。
 */
function parseBasicAuth(header: string | null): ClientCredentials | null {
  if (!header) return null;
  const match = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) return null;

  // Buffer.from 对非法 base64 宽松处理（返回垃圾/空串），产出的错误凭证
  // 会在 validateClientSecret 定时安全比较中失败，无需在此严格校验
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    throw new InvalidClientError('Basic 凭证缺少冒号分隔符');
  }
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    throw new InvalidClientError('Basic 凭证 urlencoded 解码失败');
  }
}
