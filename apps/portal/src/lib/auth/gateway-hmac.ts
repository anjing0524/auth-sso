import 'server-only';
import { timingSafeEqual } from 'crypto';

/**
 * Gateway ↔ Portal HMAC-SHA256 签名会话原语（复用 Web Crypto API）。
 *
 * 统一供身份校验（verify-jwt.ts）与内部端点调用方校验（refresh route 等）引用，
 * 消除跨文件重复的 HMAC 实现，保持 payload 构造与窗口校验的一致语义。
 */

/** HMAC 签名时间戳容忍窗口（秒），可通过 SIGNATURE_TIMESTAMP_WINDOW_SEC 环境变量覆盖 */
export const SIGNATURE_TIMESTAMP_WINDOW_SEC = (() => {
  const raw = process.env['SIGNATURE_TIMESTAMP_WINDOW_SEC'];
  const parsed = raw ? parseInt(raw, 10) : 60;
  if (isNaN(parsed) || parsed < 1 || parsed > 300) return 60;
  return parsed;
})();

/**
 * 使用 Web Crypto API 计算 HMAC-SHA256 并以 hex 字符串返回。
 */
export async function computeHmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 对一对 (timestamp, signature) 头做时间窗口 + HMAC 校验。
 *
 * @param secret  共享密钥（未配置时直接返回 false）
 * @param payload 纯文本载荷（如 `refresh:{ts}` 或 `ts:userId:jti`）
 * @param ts      来自 `X-Gateway-Timestamp` 头的原始字符串
 * @param sigHex  来自 `X-Gateway-Signature` 头的 hex 签名
 * @param windowSec 容忍的时钟偏差秒数
 */
export async function verifySignature(
  secret: string | null | undefined,
  payload: string,
  ts: string | null | undefined,
  sigHex: string | null | undefined,
  windowSec: number,
): Promise<boolean> {
  if (!secret || !ts || !sigHex) return false;
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > windowSec) return false;

  const expected = await computeHmacHex(secret, payload);
  const sigBuf = Buffer.from(sigHex, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;

  return true;
}
