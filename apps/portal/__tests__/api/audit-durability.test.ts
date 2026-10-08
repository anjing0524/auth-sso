/**
 * 审计写入持久性等级测试
 *
 * 锁住 ADR-020 的核心：审计**不是一个东西**，三档的失败语义刻意相反——
 *
 * - 档① `appendSecurityAudit`：与业务**同事务** → 失败必须抛出（业务一并回滚）
 * - 档② `recordActionAudit` / `recordApiAudit`：业务**已提交之后**的补记 →
 *   **永不抛出**，否则会把一个已成功的写操作返回成失败
 *
 * 档②原先用裸 `await writeAuditLog(...)`，DB 错误沿调用栈上抛到
 * `withAuth` 的内层 catch，把一个已提交的写操作报成失败——调用方据此重试
 * 可能造成重复写入。
 *
 * @req J-LOG-003, DC-AUDIT-IMMUTABLE
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    insert: vi.fn(),
    lastRow: {} as Record<string, unknown>,
  },
}));

vi.mock('@/infrastructure/db', () => ({
  db: { insert: mocks.insert },
  schema: { auditLogs: {}, loginLogs: {}, accessLogs: {} },
}));

const { headerStore } = vi.hoisted(() => ({
  headerStore: {} as Record<string, string>,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(headerStore),
}));

import { appendSecurityAudit, recordActionAudit, recordApiAudit } from '@/lib/audit';

/** 让 db.insert(...).values(...) 抛错 */
function makeInsertFail(message = 'audit storage down') {
  mocks.insert.mockImplementation(() => ({
    values: () => Promise.reject(new Error(message)),
  }));
}

function makeInsertSucceed() {
  mocks.insert.mockImplementation(() => ({
    values: (row: Record<string, unknown>) => {
      mocks.lastRow = row;
      return Promise.resolve(undefined);
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(headerStore)) delete headerStore[k];
});

/** 取出最近一次写入 audit_logs 的行 */
function lastAuditRow(): Record<string, unknown> {
  return mocks.lastRow;
}

describe('档② 控制面审计 —— 永不抛出', () => {
  it('recordActionAudit 在 DB 写入失败时不抛出', async () => {
    makeInsertFail();

    await expect(recordActionAudit('u1', 'USER_UPDATE')).resolves.toBeUndefined();
  });

  it('recordApiAudit 在 DB 写入失败时不抛出', async () => {
    makeInsertFail();

    await expect(recordApiAudit('u1', 'USER_UPDATE')).resolves.toBeUndefined();
  });

  it('写入成功时正常完成', async () => {
    makeInsertSucceed();

    await expect(recordActionAudit('u1', 'USER_UPDATE')).resolves.toBeUndefined();
    expect(mocks.insert).toHaveBeenCalled();
  });
});

describe('档① 安全审计 —— 必须抛出（与业务同事务）', () => {
  it('appendSecurityAudit 在写入失败时抛出，使业务事务一并回滚', async () => {
    const tx = {
      insert: () => ({ values: () => Promise.reject(new Error('audit storage down')) }),
    };

    await expect(
      appendSecurityAudit(tx as never, { userId: 'u1', operation: 'USER_UPDATE' }),
    ).rejects.toThrow('audit storage down');
  });

  it('两档的失败语义刻意相反（同一故障，行为不同）', async () => {
    const tx = {
      insert: () => ({ values: () => Promise.reject(new Error('down')) }),
    };
    makeInsertFail('down');

    // 档②吞掉，档①上抛 —— 这一对照是本模块 interface 的核心
    await expect(recordActionAudit('u1', 'USER_UPDATE')).resolves.toBeUndefined();
    await expect(
      appendSecurityAudit(tx as never, { userId: 'u1', operation: 'USER_UPDATE' }),
    ).rejects.toThrow();
  });
});

// ── 真实请求数据的采集（替代幽灵头）──────────────────────
//
// 原先 `method`/`url` 取自 `x-action-method` / `x-action-path` 两个头，
// 而这两个头在整个仓库中**没有任何注入点**——是"只被读取、从未被写入"的幽灵
// 契约，导致 `audit_logs.url` 恒为 null、`method` 恒为兜底值。
// 改用真实存在的数据：Next.js 的 `next-action` 头（Server Action 标识）
// 与 `referer`（发起页面）。

describe('档② 采集真实请求数据', () => {
  it('method 取自 Next.js 的 next-action 头（Server Action 标识）', async () => {
    makeInsertSucceed();
    headerStore['next-action'] = 'a1b2c3d4e5';

    await recordActionAudit('u1', 'USER_UPDATE');

    expect(lastAuditRow().method).toBe('a1b2c3d4e5');
  });

  it('无 next-action 头时回退到兜底方法名', async () => {
    makeInsertSucceed();

    await recordActionAudit('u1', 'USER_UPDATE');

    expect(lastAuditRow().method).toBe('ACTION');
  });

  it('url 取自 referer 的 pathname（不再恒为 null）', async () => {
    makeInsertSucceed();
    headerStore['referer'] = 'http://localhost:4100/users?page=2';

    await recordActionAudit('u1', 'USER_UPDATE');

    expect(lastAuditRow().url).toBe('/users');
  });

  it('referer 缺失 → url 为 null（不写入假数据）', async () => {
    makeInsertSucceed();

    await recordActionAudit('u1', 'USER_UPDATE');

    expect(lastAuditRow().url).toBeNull();
  });

  it('referer 非法（非绝对 URL）→ url 为 null 而非抛出', async () => {
    makeInsertSucceed();
    headerStore['referer'] = 'not-a-url';

    await recordActionAudit('u1', 'USER_UPDATE');

    expect(lastAuditRow().url).toBeNull();
  });

  it('recordApiAudit 回退方法名为 API', async () => {
    makeInsertSucceed();

    await recordApiAudit('u1', 'USER_UPDATE');

    expect(lastAuditRow().method).toBe('API');
  });
});
