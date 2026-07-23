import 'server-only';

/**
 * 签名密钥管理 — JWKS 表 + 内存缓存 + 自动轮换
 *
 * 密钥对存储在 jwks 表的一行中：
 *   id         — 20 位行 ID（PK）
 *   kid        — 16 位密钥标识，写入 JWT header.kid
 *   publicKey  — JWK 格式公钥 JSON 字符串
 *   privateKey — JWK 格式私钥 JSON 字符串
 *   expiresAt  — 90 天后过期，过期自动生成新对
 *
 * 进程内存缓存 5 分钟，避免每次签发/验签都查 DB。
 *
 * @module lib/auth/token/signing-keys
 */
import { importJWK, generateKeyPair, exportJWK } from 'jose';
import { db, schema } from '@/infrastructure/db';
import { eq, desc } from 'drizzle-orm';
import { generateId, generateUUID, encryptPrivateKey, decryptPrivateKey } from '@/lib/crypto';

// ============================================================================
// 常量与缓存
// ============================================================================

const KEY_CACHE_TTL_MS = 300_000;

/** 进程级互斥锁：防止冷启动时多个并发请求各自生成重复密钥对 */
let keyGenLock: Promise<void> = Promise.resolve();

export interface CachedSigningKey {
  keyId: string;        // JWT kid header 的值
  privateKey: CryptoKey; // jose.CryptoKey，内存中可直接签名
  publicKey: CryptoKey;  // jose.CryptoKey（importJWK 后），验签热路径零重复导入
  publicJwk: JsonWebKey; // JWK 公钥（JWKS 端点返回用）
  fetchedAt: number;
}

/** 缓存按 kid 索引，支持多 key 共存（密钥轮换后旧 token 仍可验签） */
const keyCache = new Map<string, CachedSigningKey>();

export function getCachedKey(kid: string): CachedSigningKey | undefined {
  const entry = keyCache.get(kid);
  if (entry && Date.now() - entry.fetchedAt < KEY_CACHE_TTL_MS) {
    return entry;
  }
  if (entry) keyCache.delete(kid); // 过期清理
  return undefined;
}

/** 从数据库 JSON 字符串反序列化并导入为 CryptoKey（消除 3 处 JSON.parse + importJWK 重复） */
export async function importKeyFromJwk(jwkStr: string, alg: string = 'ES256'): Promise<CryptoKey> {
  const decrypted = decryptPrivateKey(jwkStr);
  return await importJWK(JSON.parse(decrypted) as JsonWebKey, alg) as CryptoKey;
}

function createAndCacheEntry(kid: string, privateKey: CryptoKey, publicKey: CryptoKey, publicJwk: JsonWebKey): CachedSigningKey {
  const entry: CachedSigningKey = { keyId: kid, privateKey, publicKey, publicJwk, fetchedAt: Date.now() };
  keyCache.set(kid, entry);
  return entry;
}

// ============================================================================
// 密钥查询
// ============================================================================

/**
 * 按 kid 查找签名密钥对 — 缓存命中零 DB，miss 时查 jwks 表
 */
export async function getSigningKeyByKid(kid: string): Promise<{
  keyId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
} | null> {
  const cached = getCachedKey(kid);
  if (cached) return cached;

  const row = await db
    .select()
    .from(schema.jwks)
    .where(eq(schema.jwks.kid, kid))
    .limit(1)
    .then(rows => rows[0] ?? null);

  if (!row) return null;

  const privateKey = await importKeyFromJwk(row.privateKey);
  const publicKey = await importKeyFromJwk(row.publicKey);
  const publicJwk = JSON.parse(row.publicKey) as JsonWebKey;

  return createAndCacheEntry(row.kid ?? row.id, privateKey, publicKey, publicJwk);
}

/**
 * 获取当前活跃的签名密钥对（用于签发新 token）
 *
 * 优先级：取 jwks 表最新未过期的一行 → 缓存 miss 查 DB → 无可用密钥自动生成
 */
export async function getActiveSigningKey(): Promise<{
  keyId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}> {
  // DESC 排序取最新密钥（修复：ASC 导致永远选中旧密钥，密钥轮换形同虚设）
  const rows = await db
    .select()
    .from(schema.jwks)
    .orderBy(desc(schema.jwks.createdAt))
    .limit(1);

  const needsGen = rows.length === 0 || (rows[0]!.expiresAt && new Date(rows[0]!.expiresAt) < new Date());

  if (needsGen) {
    // 串行化密钥生成，防止冷启动时多个并发请求各自生成重复密钥对
    const previousLock = keyGenLock;
    let release: () => void;
    keyGenLock = new Promise<void>(r => { release = r; });
    try {
      await previousLock;
      // 双重检查：等待锁期间可能有其他请求已生成密钥
      const recheck = await db
        .select()
        .from(schema.jwks)
        .orderBy(desc(schema.jwks.createdAt))
        .limit(1);
      if (recheck.length > 0) {
        const rjwk = recheck[0]!;
        if (!rjwk.expiresAt || new Date(rjwk.expiresAt) >= new Date()) {
          // 已有有效密钥（由并发请求生成），直接使用
          const rkid = rjwk.kid ?? rjwk.id;
          const rcached = getCachedKey(rkid);
          if (rcached) return rcached;
          const rprivateKey = await importKeyFromJwk(rjwk.privateKey);
          const rpublicKey = await importKeyFromJwk(rjwk.publicKey);
          const rpublicJwk = JSON.parse(rjwk.publicKey) as JsonWebKey;
          const rentry = createAndCacheEntry(rkid, rprivateKey, rpublicKey, rpublicJwk);
          return rentry;
        }
      }
      return generateAndPersistKeyPair();
    } finally {
      release!();
    }
  }

  const jwk = rows[0]!;

  const kid = jwk.kid ?? jwk.id;
  const cached = getCachedKey(kid);
  if (cached) return cached;

  const privateKey = await importKeyFromJwk(jwk.privateKey);
  const publicKey = await importKeyFromJwk(jwk.publicKey);
  const publicJwk = JSON.parse(jwk.publicKey) as JsonWebKey;

  return createAndCacheEntry(kid, privateKey, publicKey, publicJwk);
}

// ============================================================================
// 密钥生成
// ============================================================================

/** 生成新的 ES256 密钥对，写入 jwks 表，加入缓存 */
async function generateAndPersistKeyPair(): Promise<{
  keyId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  const kid = generateId(16);
  const id = generateUUID();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await db.insert(schema.jwks).values({
    id,
    kid,
    publicKey: JSON.stringify(publicJwk),
    privateKey: encryptPrivateKey(JSON.stringify(privateJwk)),
    createdAt: new Date(),
    expiresAt,
  });

  // importJWK 得到可缓存的 CryptoKey（exportJWK 返回的是 JWK 不是 CryptoKey）
  const importedPublicKey = await importJWK(publicJwk, 'ES256') as CryptoKey;
  return createAndCacheEntry(kid, privateKey, importedPublicKey, publicJwk);
}
