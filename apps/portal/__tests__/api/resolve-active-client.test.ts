/**
 * 取得活跃 OAuth Client：**查询 + 激活校验一处完成**（真实 DB）
 *
 * ## 为什么需要它（架构评审 R2 次级候选）
 *
 * 原先只有 `authenticateOAuthClient`（查询 + 激活 + 密钥），它的注释自称覆盖
 * "introspect / revoke / token 端点中重复的 5 行 boilerplate" —— **恰恰漏掉 authorize**
 * （PKCE 路径不需要密钥）。于是 authorize 两处、permissions/register 一处各自裸写
 * `查询 + validateClientActive`。**同一 risk 面：任何一处漏掉激活校验就接受停用 client。**
 *
 * 现在查询与校验收进 `resolveActiveClient`，且数据层的 `getClientByClientId`
 * （"未校验的行"的唯一出口）已随之删除。本文件钉住三态与密钥层。
 *
 * @req H-AUTH-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedPortalClient } from '../helpers/seed-fixtures';
import { AUTH_ERRORS } from '@auth-sso/contracts';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

import { authenticateOAuthClient, resolveActiveClient } from '@/lib/auth/oauth-helpers';
import { DomainError } from '@/domain/shared/errors';

const ACTIVE_CLIENT_ID = 'active-app';
const DISABLED_CLIENT_ID = 'disabled-app';
/** `seedPortalClient` 的 clientSecret 是 sha256('portal-secret') 的 hex（走 SHA-256 比较路径） */
const CORRECT_SECRET = 'portal-secret';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    clients: [
      seedPortalClient({ clientId: ACTIVE_CLIENT_ID })[0]!,
      seedPortalClient({ clientId: DISABLED_CLIENT_ID, status: 'DISABLED' as const })[0]!,
    ],
  });
});

/** 断言 reject 且是词汇表内的 InvalidClientError（错误码也一并钉住） */
async function expectInvalidClient(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code: AUTH_ERRORS.INVALID_CLIENT });
}

describe('resolveActiveClient（查询 + 激活校验一处完成）', () => {
  it('ACTIVE client → 返回真实行', async () => {
    const client = await resolveActiveClient(ACTIVE_CLIENT_ID);
    expect(client.clientId).toBe(ACTIVE_CLIENT_ID);
    expect(client.status).toBe('ACTIVE');
    // 下一层（密钥校验）需要的字段确实在
    expect(client.clientSecret).toBeTruthy();
  });

  it('**DISABLED client → 拒绝**（本候选的核心 risk 面：漏校验即接受停用 client）', async () => {
    await expectInvalidClient(resolveActiveClient(DISABLED_CLIENT_ID));
  });

  it('未知 client → 拒绝（与停用同判据，避免探测存在性）', async () => {
    await expectInvalidClient(resolveActiveClient('no-such-client'));
  });
});

describe('authenticateOAuthClient（在同一入口上加密钥层）', () => {
  it('ACTIVE + 正确密钥 → 返回真实行', async () => {
    const client = await authenticateOAuthClient(ACTIVE_CLIENT_ID, CORRECT_SECRET);
    expect(client.clientId).toBe(ACTIVE_CLIENT_ID);
  });

  it('ACTIVE + 错误密钥 → 拒绝', async () => {
    await expectInvalidClient(authenticateOAuthClient(ACTIVE_CLIENT_ID, 'wrong-secret'));
  });

  it('**DISABLED + 正确密钥 → 仍拒绝**（密钥对也不能救活停用 client）', async () => {
    await expectInvalidClient(authenticateOAuthClient(DISABLED_CLIENT_ID, CORRECT_SECRET));
  });
});
