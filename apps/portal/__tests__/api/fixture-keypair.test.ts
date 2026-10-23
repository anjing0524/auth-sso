/**
 * 测试夹具自检 —— `seedJwks()` / `seedSigningKeys()` 必须产出**真正可用**的 ES256 密钥对
 *
 * ## 为什么需要这条守卫
 *
 * 该夹具此前硬编码了一组 JWK，其中私钥**无法被 jose 导入**（`Invalid keyData`），
 * 于是 `seedJwks()` 从来没有支持过真正的签名——只是把两个字符串塞进数据库。
 *
 * 这个缺陷长期未被发现，原因是**夹具失效与 mock 互相掩盖**：所有需要签发的
 * 测试都 `vi.mock('@/lib/auth/token')` 把签发整个替换掉了，因此没人碰到
 * 那组密钥。这正是"mock 边界划在被测行为上"的典型后果。
 *
 * 本文件不 mock `@/lib/auth/token`，直接断言夹具能力，使夹具退化立刻可见。
 *
 * 前半段只验证**夹具材料**（不碰 DB）；后半段验证**真实路径**：
 * `seedSigningKeys()` 种入 DB → 生产签发/验签函数（内部走
 * `decryptPrivateKey` + `importJWK` + 缓存）→ 闭环成立，且私钥加密落库时同样成立。
 * 二者缺一不可：材料可用不代表经过加密列、缓存与生产函数的那条路可用。
 *
 * @req H-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { decodeProtectedHeader, exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { JWT_TYP } from '@auth-sso/contracts';
import { seedJwks } from '../helpers/seed-fixtures';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import { createTestDbHandle } from '../helpers/test-db';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

// 只把基础设施边界指向真实测试库（ADR-022 §1 的豁免项，也是在用先例）；
// 生产业务模块（@/lib/auth/token）保持真实，不 mock。
vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import {
  getActiveSigningKey,
  getSigningKeyByKid,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/auth/token';
// 缓存重置只在深 module 上导出（不在 token.ts 的公开面里）
import { resetSigningKeyCache } from '@/lib/auth/token/signing-keys';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_ID = 'portal';

describe('seedJwks() —— 夹具材料自检', () => {
  const [row] = seedJwks();

  it('私钥可被 jose 导入（此前为 Invalid keyData）', async () => {
    await expect(importJWK(JSON.parse(row!.privateKey), 'ES256')).resolves.toBeDefined();
  });

  it('公钥可被 jose 导入', async () => {
    await expect(importJWK(JSON.parse(row!.publicKey), 'ES256')).resolves.toBeDefined();
  });

  it('**公钥与私钥是同一密钥对**——本夹具签发的 token 可用本夹具公钥验签', async () => {
    const priv = await importJWK(JSON.parse(row!.privateKey), 'ES256');
    const pub = await importJWK(JSON.parse(row!.publicKey), 'ES256');

    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'ES256', kid: row!.kid })
      .setExpirationTime('1h')
      .sign(priv);

    const { payload } = await jwtVerify(token, pub);
    expect(payload.sub).toBe('u1');
  });

  it('公钥不含私钥材料（d 不得写入 publicKey 列）', () => {
    const pub = JSON.parse(row!.publicKey) as Record<string, unknown>;
    expect(pub).not.toHaveProperty('d');
    expect(Object.keys(pub).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });

  it('多次调用返回同一密钥对（同一测试内签发+验签必须一致）', async () => {
    const [a] = seedJwks();
    const [b] = seedJwks();

    expect(a!.privateKey).toBe(b!.privateKey);
    expect(a!.publicKey).toBe(b!.publicKey);
  });

  it('与另一独立生成的密钥对**不可互验**（证明上一条不是空断言）', async () => {
    const priv = await importJWK(JSON.parse(row!.privateKey), 'ES256');
    const { publicKey: otherPub } = await generateKeyPair('ES256', { extractable: true });

    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setExpirationTime('1h')
      .sign(priv);

    // 用无关公钥验签必须失败——否则"公钥私钥同对"的断言毫无意义
    await expect(
      jwtVerify(token, await importJWK(await exportJWK(otherPub), 'ES256')),
    ).rejects.toThrow();
  });
});

// @req H-SESS-001
describe('seedSigningKeys() —— 真实路径自检（DB → 缓存 → 生产签发/验签）', () => {
  beforeAll(async () => { await td.connect(); });
  afterAll(async () => { await td.close(); });

  beforeEach(async () => {
    await td.cleanup();
    resetSigningKeyCache();
  });

  it('种入后，活跃密钥就是夹具的 kid（不是运行时自动生成的那对）', async () => {
    await seedSigningKeys(td, { kid: 'fixture-active' });

    const active = await getActiveSigningKey();
    expect(active.keyId).toBe('fixture-active');
  });

  it('先有运行时自动生成的密钥、再种入夹具 ⇒ 活跃密钥仍是夹具的（不依赖执行顺序）', async () => {
    const generated = await getActiveSigningKey();
    expect(generated.keyId).not.toBe('fixture-wins');

    await seedSigningKeys(td, { kid: 'fixture-wins' });

    const active = await getActiveSigningKey();
    expect(active.keyId).toBe('fixture-wins');
  });

  it('用**生产函数**完成签发 → 验签闭环，且签名用的就是夹具这对密钥', async () => {
    const row = await seedSigningKeys(td, { kid: 'production-path' });

    const { token } = await signAccessToken(USER_ID, CLIENT_ID, 'openid');
    const claims = await verifyAccessToken(token, CLIENT_ID, JWT_TYP.ACCESS_TOKEN);

    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe(USER_ID);
    // kid 必须命中夹具：否则说明签发读到的不是夹具这对（例如缓存里是别的密钥）
    expect(decodeProtectedHeader(token).kid).toBe(row.kid);
  });

  it('两条读路径（活跃密钥 / 按 kid）取回的公钥都能验同一枚 token', async () => {
    await seedSigningKeys(td, { kid: 'fixture-roundtrip' });

    const active = await getActiveSigningKey();
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'ES256', kid: active.keyId })
      .setExpirationTime('1h')
      .sign(active.privateKey);

    await expect(jwtVerify(token, active.publicKey)).resolves.toBeDefined();

    const byKid = await getSigningKeyByKid('fixture-roundtrip');
    expect(byKid).not.toBeNull();
    await expect(jwtVerify(token, byKid!.publicKey)).resolves.toBeDefined();
  });

  it('种入夹具会清空密钥缓存：已从 DB 删除的 kid 不得由缓存复活', async () => {
    await seedSigningKeys(td, { kid: 'to-be-deleted' });
    // 读一次以填充缓存
    expect(await getSigningKeyByKid('to-be-deleted')).not.toBeNull();

    await td.db.delete(td.schema.jwks).where(eq(td.schema.jwks.kid, 'to-be-deleted'));

    // 夹具的固定动作之一：种入时清空缓存（此处借种入另一个 kid 触发）
    await seedSigningKeys(td, { kid: 'cache-reset-trigger' });

    // 缓存未清空的话，这里会返回已删除行的陈旧材料而不是 null
    await expect(getSigningKeyByKid('to-be-deleted')).resolves.toBeNull();
  });

  it('私钥加密落库（JWKS_ENCRYPTION_KEY）时闭环仍成立——走真实 AES 分支', async () => {
    // 生产配置下私钥是加密落库的；未设该变量时 encryptPrivateKey 直通，
    // 因此这条覆盖了"加密列"这条此前零执行的路径。
    vi.stubEnv('JWKS_ENCRYPTION_KEY', 'a'.repeat(64));

    try {
      await seedSigningKeys(td, { kid: 'encrypted-at-rest' });

      const [stored] = await td.db
        .select()
        .from(td.schema.jwks)
        .where(eq(td.schema.jwks.kid, 'encrypted-at-rest'));
      // 落库的是密文，不是明文 JWK。
      // 断言 JSON 字段标记 `"kty"` 而不是裸 `kty`：后者会以 ~1/26000 的概率出现在
      // base64 随机密文中（2026-10-23 实测偶发假红），属概率性断言缺陷。
      expect(stored!.privateKey).not.toContain('"kty"');

      const { token } = await signAccessToken(USER_ID, CLIENT_ID, 'openid');
      await expect(
        verifyAccessToken(token, CLIENT_ID, JWT_TYP.ACCESS_TOKEN),
      ).resolves.toMatchObject({ sub: USER_ID });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
