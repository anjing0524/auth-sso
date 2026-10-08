/**
 * Refresh Token 撤销模块矩阵测试 (lib/auth/token/revocation) — 真实 DB
 *
 * RT 撤销原语此前散落为 12 份 SQL 拷贝（token.ts / logout / RFC 7009 revoke /
 * 管理端），收口为五个领域维度函数后在此按维度矩阵集中验证撤销语义：
 * - 家族级联隔离（RFC 9700 §4.14）：(userId, clientId) 级联不牵连其他 client /
 *   其他用户的会话（消除跨 client DoS 放大）
 * - client 归属限定（RFC 7009 §2.1）：tokenHash 撤销可被 client 限定拦截
 * - 管理端真实计数：仅统计 NULL → revoked 的真实翻转行，重复调用不虚增
 * - 事务感知：executor 可传入事务句柄，事务回滚时撤销一并回滚
 *
 * @req H-SSO-004, H-SESS-006, H-AUTH-011
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser, seedPortalClient } from '../helpers/seed-fixtures';
import { hashToken } from '@/lib/crypto';
import {
  revokeRefreshTokenById,
  revokeRefreshTokenByTokenHash,
  revokeRefreshTokenFamily,
  revokeUserRefreshTokens,
  revokeClientRefreshTokens,
} from '@/lib/auth/token/revocation';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

const td = createTestDbHandle();
tdHolder.current = td;

/** 每个用例重建的 4 行基线：A×(portal×2, demo×1) + B×(portal×1)，覆盖跨 client / 跨用户隔离断言 */
let baseline: Awaited<ReturnType<typeof seedBaseline>>;

const now = new Date();
const USER_A = '00000000-0000-4000-8000-000000000301';
const USER_B = '00000000-0000-4000-8000-000000000302';
const CLIENT_PORTAL = 'portal';
const CLIENT_DEMO = 'demo-rp';
const RT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface RtRow { id: string; tokenHash: string; }

/** 种一行 Refresh Token（tokenHash 唯一约束由 token 字符串区分保证） */
async function seedRt(
  userId: string,
  clientId: string,
  token: string,
  opts?: { revoked?: Date },
): Promise<RtRow> {
  const tokenHash = hashToken(token);
  const [row] = await td.db
    .insert(td.schema.refreshTokens)
    .values({
      tokenHash,
      userId,
      clientId,
      scopes: 'openid profile offline_access',
      expiresAt: new Date(now.getTime() + RT_TTL_MS),
      revoked: opts?.revoked ?? null,
    })
    .returning({ id: td.schema.refreshTokens.id, tokenHash: td.schema.refreshTokens.tokenHash });
  return row!;
}

/** 4 行基线：A×(portal×2, demo×1) + B×(portal×1)，覆盖跨 client / 跨用户隔离断言 */
async function seedBaseline(): Promise<{ aPortal1: RtRow; aPortal2: RtRow; aDemo: RtRow; bPortal: RtRow }> {  return {
    aPortal1: await seedRt(USER_A, CLIENT_PORTAL, 'rt-a-portal-1'),
    aPortal2: await seedRt(USER_A, CLIENT_PORTAL, 'rt-a-portal-2'),
    aDemo: await seedRt(USER_A, CLIENT_DEMO, 'rt-a-demo'),
    bPortal: await seedRt(USER_B, CLIENT_PORTAL, 'rt-b-portal'),
  };
}

async function getRevoked(tokenHash: string): Promise<Date | null> {
  const [row] = await td.db
    .select({ revoked: td.schema.refreshTokens.revoked })
    .from(td.schema.refreshTokens)
    .where(eq(td.schema.refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return row?.revoked ?? null;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  // refreshTokens 外键链 → users → departments / clients，按依赖顺序种齐
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [
      seedTestUser({ id: USER_A, username: 'rt-user-a' })[0]!,
      seedTestUser({ id: USER_B, username: 'rt-user-b', email: 'rt-user-b@example.com' })[0]!,
    ],
    clients: [seedPortalClient()[0]!, seedPortalClient({ clientId: CLIENT_DEMO, name: 'Demo RP' })[0]!],
  });
  baseline = await seedBaseline();
});

describe('revokeRefreshTokenById（轮换 / 补偿回收维度）', () => {
  it('仅撤销目标行，其他家族行不受影响', async () => {
    const { aPortal1, aPortal2 } = baseline;

    await revokeRefreshTokenById(td.db, aPortal1.id);

    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).toBeNull();
  });
});

describe('revokeRefreshTokenByTokenHash（登出 / RFC 7009 维度）', () => {
  it('无 client 限定时按 tokenHash 撤销（登出场景）', async () => {
    const { aPortal1 } = baseline;

    await revokeRefreshTokenByTokenHash(td.db, aPortal1.tokenHash);

    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
  });

  it('client 限定匹配时撤销（RFC 7009 归属校验通过）', async () => {
    const { aPortal1 } = baseline;

    await revokeRefreshTokenByTokenHash(td.db, aPortal1.tokenHash, { clientId: CLIENT_PORTAL });

    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
  });

  it('client 限定不匹配时不撤销（阻断跨 client 撤销 DoS）', async () => {
    const { aPortal1 } = baseline;

    await revokeRefreshTokenByTokenHash(td.db, aPortal1.tokenHash, { clientId: CLIENT_DEMO });

    expect(await getRevoked(aPortal1.tokenHash)).toBeNull();
  });
});

describe('revokeRefreshTokenFamily（RFC 9700 家族级联维度）', () => {
  it('级联 (userId, clientId) 家族，不牵连其他 client / 其他用户', async () => {
    const { aPortal1, aPortal2, aDemo, bPortal } = baseline;

    await revokeRefreshTokenFamily(td.db, USER_A, CLIENT_PORTAL);

    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).not.toBeNull();
    // 隔离语义：同用户其他 client、同 client 其他用户的会话不受牵连
    expect(await getRevoked(aDemo.tokenHash)).toBeNull();
    expect(await getRevoked(bPortal.tokenHash)).toBeNull();
  });
});

describe('revokeUserRefreshTokens（强制下线维度）', () => {
  it('撤销该用户跨全部 client 的 RT，其他用户不受影响', async () => {
    const { aPortal1, aPortal2, aDemo, bPortal } = baseline;

    await revokeUserRefreshTokens(td.db, USER_A);

    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).not.toBeNull();
    expect(await getRevoked(aDemo.tokenHash)).not.toBeNull();
    expect(await getRevoked(bPortal.tokenHash)).toBeNull();
  });
});

describe('revokeClientRefreshTokens（管理端真实计数维度）', () => {
  it('revokeAll 撤销该 client 名下全部未撤销 RT，并返回真实计数', async () => {
    const { aPortal1, aPortal2, bPortal, aDemo } = baseline;

    const count = await revokeClientRefreshTokens(td.db, CLIENT_PORTAL);

    expect(count).toBe(3);
    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).not.toBeNull();
    expect(await getRevoked(bPortal.tokenHash)).not.toBeNull();
    expect(await getRevoked(aDemo.tokenHash)).toBeNull();
  });

  it('重复撤销同一批不虚增计数（仅统计 NULL → revoked 翻转）', async () => {
    await revokeClientRefreshTokens(td.db, CLIENT_PORTAL);

    const second = await revokeClientRefreshTokens(td.db, CLIENT_PORTAL);

    expect(second).toBe(0);
  });

  it('指定 tokenIds 时仅撤销对应行并计数', async () => {
    const { aPortal1, aPortal2 } = baseline;

    const count = await revokeClientRefreshTokens(td.db, CLIENT_PORTAL, { tokenIds: [aPortal1.id] });

    expect(count).toBe(1);
    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).toBeNull();
  });
});

describe('事务感知（executor 可传入 tx 句柄）', () => {
  it('事务提交时家族撤销生效', async () => {
    const { aPortal1, aPortal2 } = baseline;

    await td.db.transaction(async (tx) => {
      await revokeRefreshTokenFamily(tx, USER_A, CLIENT_PORTAL);
    });

    expect(await getRevoked(aPortal1.tokenHash)).not.toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).not.toBeNull();
  });

  it('事务回滚时撤销一并回滚（原子性）', async () => {
    const { aPortal1, aPortal2 } = baseline;

    await expect(
      td.db.transaction(async (tx) => {
        await revokeRefreshTokenFamily(tx, USER_A, CLIENT_PORTAL);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await getRevoked(aPortal1.tokenHash)).toBeNull();
    expect(await getRevoked(aPortal2.tokenHash)).toBeNull();
  });
});
