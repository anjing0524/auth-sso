/**
 * `error-fields` 直测：错误码 → 表单字段的映射必须**完整且自维护**（#92）
 *
 * 关键那条不是"几个码映射对了"，而是**完整性**：契约里每个 `*_ALREADY_EXISTS` 码都必须
 * **要么有字段映射、要么在 `CONFLICT_CODES_WITHOUT_FIELD` 里写明理由**（#92 原先写"一律要有映射"，
 * 实测 `MOBILE_ALREADY_EXISTS`/`CLIENT_ALREADY_EXISTS` 在当前 UI 没有可编辑输入框 ⇒ 改为**二分类**，
 * 但分类必须完整：漏一个就变红）。
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_ERRORS,
  DEPARTMENT_ERRORS,
  PERMISSION_ERRORS,
  ROLE_ERRORS,
  USER_ERRORS,
} from '@auth-sso/contracts';
import {
  CONFLICT_CODES_WITHOUT_FIELD,
  ERROR_CODE_FIELDS,
  ERROR_FIELDS,
  fieldForErrorCode,
} from '@/domain/shared/error-fields';

describe('fieldForErrorCode', () => {
  it('用户域：冲突与弱密码各自落到对应输入框', () => {
    expect(fieldForErrorCode(USER_ERRORS.USERNAME_ALREADY_EXISTS)).toBe('username');
    expect(fieldForErrorCode(USER_ERRORS.EMAIL_ALREADY_EXISTS)).toBe('email');
    // mobile 在 UI 里没有输入框 ⇒ 明确归类为「无对应字段」（见 CONFLICT_CODES_WITHOUT_FIELD）
    expect(fieldForErrorCode(USER_ERRORS.MOBILE_ALREADY_EXISTS)).toBeNull();
    expect(fieldForErrorCode(USER_ERRORS.PASSWORD_TOO_WEAK)).toBe('password');
  });

  it('复合唯一约束的实体级回落：**不**归到某个字段（无从判断是哪一列，标红任一框都是猜测）', () => {
    expect(fieldForErrorCode(USER_ERRORS.USER_ALREADY_EXISTS)).toBeNull();
    expect(CONFLICT_CODES_WITHOUT_FIELD).toHaveProperty(USER_ERRORS.USER_ALREADY_EXISTS);
  });

  it('非字段级原因返回 null（由调用方回落到消息提示）', () => {
    for (const code of [undefined, null, '', 'AUTH_SSO_1004', 'AUTH_SSO_1006', 'NOT_A_CODE']) {
      expect(fieldForErrorCode(code), `不应把 ${String(code)} 归到某个字段`).toBeNull();
    }
  });

  it('映射的值 ⊆ 已知字段清单（防止拼错字段名）', () => {
    const known = new Set<string>(ERROR_FIELDS);
    for (const [code, field] of Object.entries(ERROR_CODE_FIELDS)) {
      expect(known.has(field), `${code} 映射到了未知字段 ${field}`).toBe(true);
    }
  });

  it('反向：字段清单里**每一项**都至少被一个码用到（无死成员）', () => {
    const used = new Set<string>(Object.values(ERROR_CODE_FIELDS));
    const dead = ERROR_FIELDS.filter((f) => !used.has(f));
    expect(dead, 'ERROR_FIELDS 里有没人映射的字段标识 ⇒ 类型比现实宽').toEqual([]);
  });

  // ── 自维护断言（本文件的核心价值）──────────────────────────────────
  it('契约里**每个** `*_ALREADY_EXISTS` 码都被分类：有字段映射，或写明「无对应字段」的理由', () => {
    // 注意：必须按错误组的**键名**筛（`ERROR_CODE_VALUES` 里装的是线值 `AUTH_SSO_xxxx`，
    // 不是键名）——这条测试第一版就是栽在这里，才改成从组里取键。
    const groups = {
      USERS: USER_ERRORS,
      ROLES: ROLE_ERRORS,
      DEPARTMENTS: DEPARTMENT_ERRORS,
      PERMISSIONS: PERMISSION_ERRORS,
      CLIENTS: CLIENT_ERRORS,
    } as const;
    const conflictCodes = Object.values(groups).flatMap((group) =>
      Object.entries(group)
        .filter(([key]) => key.endsWith('_ALREADY_EXISTS'))
        .map(([, value]) => value),
    );
    // 扫描范围非空（否则这条断言是假绿）
    expect(conflictCodes.length).toBeGreaterThanOrEqual(8);

    const unclassified = conflictCodes.filter(
      (c) => fieldForErrorCode(c) === null && !(c in CONFLICT_CODES_WITHOUT_FIELD),
    );
    expect(
      unclassified,
      '契约新增了冲突码但既没有字段映射、也没有写明「无对应字段」的理由 ⇒ 该错误会退回"解析中文文案"（#92）。'
        + '请在 src/domain/shared/error-fields.ts 里二选一',
    ).toEqual([]);

    // 反向：分类表里的理由不能是空话
    for (const [code, reason] of Object.entries(CONFLICT_CODES_WITHOUT_FIELD)) {
      expect(reason.length, `${code} 的「无对应字段」理由太短`).toBeGreaterThan(10);
    }
  });
});
