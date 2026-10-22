/**
 * 签名密钥缓存与 kid 替换的行为契约 — 真实 DB（jwks 表）
 *
 * ## 为什么需要它
 *
 * `signing-keys.ts` 的 `keyCache` 是**模块级** Map（TTL 5 分钟），跨测试共享、
 * 也跨同一进程内的请求共享。此前**没有任何测试**覆盖"同一 kid 的行被替换后，
 * 取到的密钥是否随之更新"——而验签走的是 `getSigningKeyByKid` 这条路。
 *
 * 已覆盖的是 `jwks-rotation.test.ts` 的**生成/宽限窗口**逻辑，与本文件互补：
 * 那里测"何时生成新密钥对"，这里测"缓存如何响应既有行的替换"。
 *
 * @req H-SESS-001~006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData, seedJwks } from '../helpers';
import { generateKeyPair, exportJWK } from 'jose';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import { getSigningKeyByKid, getActiveSigningKey, resetSigningKeyCache } from '@/lib/auth/token/signing-keys';
import { encryptPrivateKey } from '@/lib/crypto';
import { eq } from 'drizzle-orm';

const td = createTestDbHandle();
tdHolder.current = td;

/** 生成一对 ES256 密钥并导出为可入库的 JWK 字符串 */
async function makeKeyMaterial(): Promise<{ publicKey: string; privateKey: string }> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  return {
    publicKey: JSON.stringify(await exportJWK(publicKey)),
    privateKey: encryptPrivateKey(JSON.stringify(await exportJWK(privateKey))),
  };
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  // 模块级缓存必须显式重置：否则上一个用例缓存的 kid 会跨用例残留 5 分钟，
  // 使"该 kid 的密钥材料"这类断言取决于执行顺序。
  resetSigningKeyCache();
});

describe('getSigningKeyByKid 的缓存行为', () => {
  it('缓存以 kid 为键：同一 kid 重复取用得到同一份密钥材料', async () => {
    const material = await makeKeyMaterial();
    await seedTestData(td.db, { jwks: seedJwks({ kid: 'cache-hit', ...material }) });

    const first = await getSigningKeyByKid('cache-hit');
    const second = await getSigningKeyByKid('cache-hit');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // 第二次应为缓存命中，返回同一对象（而非重新 import）
    expect(second).toBe(first);
    expect(second!.publicJwk).toEqual(first!.publicJwk);
  });

  it('不同 kid 各自独立缓存，互不串用', async () => {
    const a = await makeKeyMaterial();
    const b = await makeKeyMaterial();
    await seedTestData(td.db, {
      jwks: [
        seedJwks({ kid: 'key-a', ...a })[0]!,
        seedJwks({ kid: 'key-b', ...b })[0]!,
      ],
    });

    const keyA = await getSigningKeyByKid('key-a');
    const keyB = await getSigningKeyByKid('key-b');

    expect(keyA!.publicJwk).not.toEqual(keyB!.publicJwk);
  });

  it('未知 kid 返回 null（不得回退到其他密钥）', async () => {
    const material = await makeKeyMaterial();
    await seedTestData(td.db, { jwks: seedJwks({ kid: 'known', ...material }) });

    await expect(getSigningKeyByKid('unknown')).resolves.toBeNull();
  });
});

describe('getActiveSigningKey 的缓存行为', () => {
  it('新生成的活跃密钥立即可取，且与 kid 查询结果一致', async () => {
    const active = await getActiveSigningKey();
    expect(active.keyId).toBeTruthy();

    // 签发路径写入缓存后，按 kid 查询应命中同一份材料——两条路径不得分裂
    const byKid = await getSigningKeyByKid(active.keyId);
    expect(byKid).not.toBeNull();
    expect(byKid!.publicJwk).toEqual(active.publicJwk);
  });

  it('已存在未进入续期窗口的密钥时复用之，不重复生成', async () => {
    const active = await getActiveSigningKey();
    const again = await getActiveSigningKey();

    expect(again.keyId).toBe(active.keyId);
    expect(again.publicJwk).toEqual(active.publicJwk);
  });
});

describe('密钥轮换与缓存失效', () => {
  it('签发新密钥对后，旧 kid 仍可取证（宽限窗口内旧 token 可验签）', async () => {
    // 已过期 ⇒ 落入续期窗口（到期前 24h）⇒ getActiveSigningKey 生成新对
    const stale = await makeKeyMaterial();
    await seedTestData(td.db, {
      jwks: seedJwks({
        kid: 'expired-key',
        ...stale,
        expiresAt: new Date(Date.now() - 60_000),
      }),
    });

    const rotated = await getActiveSigningKey();
    expect(rotated.keyId).not.toBe('expired-key');

    // 旧行仍在 DB ⇒ 按 kid 仍可取到（轮换不得让存量 token 无法验签）
    const old = await getSigningKeyByKid('expired-key');
    expect(old).not.toBeNull();
    expect(old!.publicJwk).toEqual(JSON.parse(stale.publicKey));
  });

  it('轮换时清空缓存：已删除的旧 kid 不再由缓存"复活"', async () => {
    const stale = await makeKeyMaterial();
    await seedTestData(td.db, {
      jwks: seedJwks({
        kid: 'to-be-deleted',
        ...stale,
        expiresAt: new Date(Date.now() - 60_000),
      }),
    });

    // 先填充缓存
    expect(await getSigningKeyByKid('to-be-deleted')).not.toBeNull();

    // 该行被删除（模拟管理员清理 / 密钥淘汰）
    await td.db.delete(td.schema.jwks).where(eq(td.schema.jwks.kid, 'to-be-deleted'));

    // 触发轮换：新活跃密钥的生成路径会清空缓存
    const rotated = await getActiveSigningKey();
    expect(rotated.keyId).toBeTruthy();

    // 若轮换未失效缓存，这里会返回早已删除的密钥材料（陈旧读取）
    await expect(getSigningKeyByKid('to-be-deleted')).resolves.toBeNull();
  });
});

describe('resetSigningKeyCache —— 测试隔离出口', () => {
  it('重置后同一 kid 重新从 DB 读取（证明缓存确被清空）', async () => {
    const material = await makeKeyMaterial();
    await seedTestData(td.db, { jwks: seedJwks({ kid: 'resettable', ...material }) });

    const before = await getSigningKeyByKid('resettable');
    expect(before).not.toBeNull();

    resetSigningKeyCache();

    const after = await getSigningKeyByKid('resettable');
    expect(after).not.toBeNull();
    // 清空后重建 → 不同对象（若未清空则会是同一对象）
    expect(after).not.toBe(before);
    // 但密钥材料必须一致（同一 DB 行）
    expect(after!.publicJwk).toEqual(before!.publicJwk);
  });
});
