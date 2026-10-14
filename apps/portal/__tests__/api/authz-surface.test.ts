/**
 * 数据范围授权公开面契约测试
 *
 * 钉住 ADR-014 的核心约束：**数据范围原语只能经 `@/lib/authz` 门面使用**。
 *
 * 背景：范围过滤与越界守卫曾以两种形状散落在 28 个调用点，
 * `getUserRoleDeptIds` + `canAccessDept` 直接暴露给调用方，使"事务外取快照、
 * 事务内复用"这一形状可被写出来（REST 侧 13 处里 8 处中招）。
 *
 * 本测试是**静态契约检查**，不是行为测试：它断言这两个原语不再出现在
 * `@/lib/auth` 的公开面上。这样即便将来有人"顺手"把它们加回 barrel，
 * CI 也会失败——比 lint 规则更持久（lint 规则可被 eslint-disable 绕过）。
 *
 * @req H-ACL-002
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// next/headers 等平台 API 在受测模块的传递依赖里被引用，做最小 mock 以避免副作用
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/infrastructure/redis', () => ({ getRedis: vi.fn() }));
vi.mock('@/infrastructure/db', () => ({ db: {}, schema: {} }));

describe('@/lib/auth 公开面', () => {
  it('不再导出 getUserRoleDeptIds / canAccessDept（范围快照必须经 lib/authz）', async () => {
    const auth = await import('@/lib/auth');

    expect(auth).not.toHaveProperty('getUserRoleDeptIds');
    expect(auth).not.toHaveProperty('canAccessDept');
  });

  it('requireDeptAccess 亦已撤下（调用点全部迁移到 withScoped*，实测 0 处调用）', async () => {
    const auth = await import('@/lib/auth');

    expect(auth).not.toHaveProperty('requireDeptAccess');
  });

  it('保留 withPermission / withAuth / resolveIdentity', async () => {
    const auth = await import('@/lib/auth');

    expect(typeof auth.withPermission).toBe('function');
    expect(typeof auth.withAuth).toBe('function');
    expect(typeof auth.resolveIdentity).toBe('function');
  });
});

describe('@/lib/authz 门面公开面', () => {
  it('提供写路径唯一入口与读路径原语', async () => {
    const authz = await import('@/lib/authz');

    // 写路径
    expect(typeof authz.withScopedWrite).toBe('function');
    // 读路径
    expect(typeof authz.resolveScope).toBe('function');
    expect(typeof authz.scopeFilter).toBe('function');
    expect(typeof authz.isScopeDenied).toBe('function');
    // 纯判定
    expect(typeof authz.isWithinScope).toBe('function');
    expect(typeof authz.assertWithinScope).toBe('function');
  });

  it('不导出原始范围获取函数（门面只给 Scope 抽象，不给裸 deptIds 数组）', async () => {
    const authz = await import('@/lib/authz');

    expect(authz).not.toHaveProperty('getUserRoleDeptIds');
    expect(authz).not.toHaveProperty('canAccessDept');
  });
});

/**
 * 模块级封闭 —— 门面曾经"只关了一半"。
 *
 * 上面两个用例断言的是 **barrel**（`@/lib/auth*`）。但 2026-10-13 复核发现：
 * barrel 侧为真、**模块侧为假** —— `lib/auth/data-scope.ts` 仍然导出
 * `getUserRoleDeptIds` / `canAccessDept`，任何调用方 `import '@/lib/auth/data-scope'`
 * 即可绕开门面（正是 ADR-014 要消灭的"两种形状"）。原测试没抓到，因为它只查 barrel。
 *
 * 现在：子树展开是 `@/lib/authz` 的**私有 implementation**，原模块已删除。
 */
describe('范围原语的模块级封闭', () => {
  it('@/lib/authz 的内部模块也不导出裸原语', async () => {
    const dataScope = await import('@/lib/authz/data-scope');
    expect(dataScope).not.toHaveProperty('getUserRoleDeptIds');
    expect(dataScope).not.toHaveProperty('canAccessDept');
    // 子树展开是私有 implementation：连名字都不该出现在导出面上
    expect(dataScope).not.toHaveProperty('expandRoleDeptSubtrees');

    const query = await import('@/lib/authz/query');
    expect(query).not.toHaveProperty('getUserRoleDeptIds');
    expect(query).not.toHaveProperty('canAccessDept');
  });

  it('原模块 src/lib/auth/data-scope.ts 已删除（门面不可被绕开）', () => {
    const legacy = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/lib/auth/data-scope.ts',
    );
    // 用文件系统断言而非 `import()`：后者是构建期解析，失败形态不可控
    expect(existsSync(legacy), `${legacy} 不应存在——范围原语必须只经 @/lib/authz`).toBe(false);
  });
});

/**
 * #71 结构那一半：实体范围守卫配置集中一处
 *
 * 每个实体的 `load/deptOf/notFound/message` 组合**只应出现一次**（作为该文件的守卫工厂）。
 * 散落时改一处而漏改另一处就是越权——这类"安全配置散落"缺陷与
 * `withScopedWrite` 空转同类：**正常路径看不出差别**，故用静态检查钉住。
 */
describe('实体范围守卫配置集中一处', () => {
  it.each([
    ['app/(dashboard)/users/actions.ts', '无权操作该部门的用户'],
    ['app/(dashboard)/roles/actions.ts', '无权操作该部门的角色'],
    ['app/(dashboard)/departments/actions.ts', '无权操作该部门'],
  ])('%s：守卫文案在代码中只出现一次（改则全改）', (relPath, message) => {
    const raw = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src', relPath), 'utf-8');
    // 去注释后再数：**注释里提到这个文案不算缺陷**（否则修复记录本身会让守卫变红，R11 的教训）
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.split(message).length - 1).toBe(1);
  });
});
