/**
 * 真实基础设施种子 —— 签名密钥
 *
 * 与 `seed-fixtures`（纯数据模板）分开的理由：本模块要写 DB 并清空生产模块
 * （`@/lib/auth/token/signing-keys`）的进程级缓存，因而在**模块加载期**就会请求
 * `@/infrastructure/db`。若把它并进 `seed-fixtures`，那三十余个导入纯数据模板的
 * 测试文件都会继承这条加载期依赖，提前触发那些把顶层 import 捕进 `vi.mock` 工厂
 * 的文件的工厂，撞上 ESM 绑定的 TDZ（实现本夹具时 `user-api.test.ts` 就是这样
 * 整体跑不起来的）。
 *
 * 因此：需要真实签发/验签的测试**直接**导入本模块，而不是走 helpers barrel。
 */
import type { SeedData } from './test-db';
import { seedTestData, type TestDbHandle } from './test-db';
import { seedJwks } from './seed-fixtures';
import { encryptPrivateKey } from '@/lib/crypto';
import { resetSigningKeyCache } from '@/lib/auth/token/signing-keys';

/**
 * 把一组**真实可用**的 ES256 密钥种进 `jwks` 表，并清空签名密钥缓存。
 *
 * 这是"用真实签发/验签跑测试"的入口：调一次即可让
 * `getActiveSigningKey()` / `getSigningKeyByKid()` 取到本夹具的密钥对，
 * 从而真正走 jose 与生产签发路径，而不是 mock 掉 `@/lib/auth/token`。
 *
 * ## 三个刻意的设计
 *
 * 1. **私钥列与生产同路**：写入前过一遍 `encryptPrivateKey()`——生产
 *    `generateAndPersistKeyPair()` 就是这么写的。未配置 `JWKS_ENCRYPTION_KEY`
 *    时它是直通，配置后才是真密文；于是"生产配置（私钥加密落库）下夹具仍可用"
 *    这件事可以被断言，而不是留在覆盖盲区里。
 * 2. **清空缓存放在写入之后**：本函数返回时缓存保证为空，下一次读取必然看到
 *    刚种入的行（缓存 TTL 5 分钟且按 kid 索引，不重置会让断言跨用例串味）。
 * 3. **有意不挂进全局 setup**：全局重置会把"缓存是否跨用例泄漏"变成不可见，
 *    而这一点正是测试真实性治理要能被观察到的东西。重置属于夹具动作。
 *
 * 活跃密钥的确定性由 `seedJwks()` 的时间戳保证：它的 `createdAt` 取自**调用
 * 时刻**，而 `getActiveSigningKey()` 按 `createdAt DESC` 取最新一行，因此种入
 * 之后活跃密钥就是这一对——不依赖此前是否已有自动生成的密钥。
 *
 * 约定：调用方按既有模式在每个用例前 `td.cleanup()`（TRUNCATE），
 * 本函数不做隐式清理，避免把副作用藏进夹具。
 *
 * @returns **实际落库**的那一行（`privateKey` 为加密后的值，便于断言落库形态）
 */
export async function seedSigningKeys(
  td: TestDbHandle,
  overrides: Partial<NonNullable<SeedData['jwks']>[0]> = {},
): Promise<NonNullable<SeedData['jwks']>[0]> {
  const [seeded] = seedJwks(overrides);
  const stored = { ...seeded!, privateKey: encryptPrivateKey(seeded!.privateKey) };

  await seedTestData(td.db, { jwks: [stored] });
  resetSigningKeyCache();

  return stored;
}
