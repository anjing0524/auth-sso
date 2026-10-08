/**
 * 测试夹具自检 —— `seedJwks()` 必须产出**真正可用**的 ES256 密钥对
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
 * @req H-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from 'jose';
import { seedJwks } from '../helpers/seed-fixtures';

describe('seedJwks() —— 夹具自检', () => {
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
