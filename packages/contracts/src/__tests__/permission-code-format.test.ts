import { describe, expect, it } from 'vitest';
import * as permissionGroups from '../permissions';

/**
 * 权限码命名空间守卫（ADR-008：`{clientId}:{resource}:{action}`）
 *
 * ## 为什么需要它
 *
 * ADR-008 定下权限码格式，2026-10-15 核实实测：契约里 **78 条码 100% 合规**，
 * 但**没有任何代码校验这个格式** —— 契约靠 78 条取值本身维持，而不是靠机制。
 * 这正是本仓反复治理的"声明没有阻断点"：加第 79 条时写错（少一段、多个冒号、
 * 空段）不会有任何东西变红。
 *
 * 本文件把格式变成可执行的断言（与 `error-code-usage` 同形，跑在 `pnpm test` 里）。
 */

/** 与 ADR-008 一致的格式：三段、每段非空、以冒号分隔 */
const PERMISSION_CODE = /^[^:\s]+:[^:\s]+:[^:\s]+$/;

/** 契约里所有导出名以 `_PERMISSIONS` 结尾的常量组 */
function allPermissionCodes(): Array<{ group: string; key: string; code: string }> {
  const out: Array<{ group: string; key: string; code: string }> = [];
  for (const [groupName, group] of Object.entries(permissionGroups)) {
    if (!groupName.endsWith('_PERMISSIONS') || typeof group !== 'object' || group === null) continue;
    for (const [key, code] of Object.entries(group as Record<string, string>)) {
      out.push({ group: groupName, key, code });
    }
  }
  return out;
}

describe('权限码命名空间（ADR-008）', () => {
  it('每个 *(_PERMISSIONS) 的值都符合 {clientId}:{resource}:{action}', () => {
    const codes = allPermissionCodes();
    // 非空下限：守卫不得因"没扫到东西"而假绿（实测契约里有 78 条）
    expect(codes.length, `实测 ${codes.length} 条`).toBeGreaterThanOrEqual(50);

    const bad = codes.filter((c) => !PERMISSION_CODE.test(c.code));
    expect(bad.map((c) => `${c.group}.${c.key} = ${c.code}`).join('\n'), '以下权限码不符合三段式').toBe('');
  });

  it('夹具：格式判定真的会红（缺段 / 多段 / 空段 / 空格）', () => {
    expect(PERMISSION_CODE.test('portal:user:list')).toBe(true);
    expect(PERMISSION_CODE.test('portal:user')).toBe(false);          // 缺 action
    expect(PERMISSION_CODE.test('portal:user:list:extra')).toBe(false); // 多一段
    expect(PERMISSION_CODE.test(':user:list')).toBe(false);            // 空 clientId
    expect(PERMISSION_CODE.test('portal::list')).toBe(false);          // 空 resource
    expect(PERMISSION_CODE.test('portal:user:list ')).toBe(false);     // 尾随空格
  });
});
