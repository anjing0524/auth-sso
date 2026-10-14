/**
 * `error-fields` 直测：错误码 → 表单字段的映射必须**完整且自维护**（#92）
 *
 * 关键那条不是"几个码映射对了"，而是**最后一条**：契约里每个 `*_ALREADY_EXISTS` 码
 * 都必须有映射。否则 #82 新接通一个冲突码，前端又悄悄退回"解析中文文案"。
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_ERRORS,
  DEPARTMENT_ERRORS,
  PERMISSION_ERRORS,
  ROLE_ERRORS,
  USER_ERRORS,
} from '@auth-sso/contracts';
import { ERROR_CODE_FIELDS, fieldForErrorCode } from '@/domain/shared/error-fields';

describe('fieldForErrorCode', () => {
  it('用户域：冲突与弱密码各自落到对应输入框', () => {
    expect(fieldForErrorCode(USER_ERRORS.USERNAME_ALREADY_EXISTS)).toBe('username');
    expect(fieldForErrorCode(USER_ERRORS.EMAIL_ALREADY_EXISTS)).toBe('email');
    expect(fieldForErrorCode(USER_ERRORS.MOBILE_ALREADY_EXISTS)).toBe('mobile');
    expect(fieldForErrorCode(USER_ERRORS.PASSWORD_TOO_WEAK)).toBe('password');
  });

  it('复合唯一约束的实体级回落归到登录名（无从判断是哪一列）', () => {
    expect(fieldForErrorCode(USER_ERRORS.USER_ALREADY_EXISTS)).toBe('username');
  });

  it('非字段级原因返回 null（由调用方回落到消息提示）', () => {
    for (const code of [undefined, null, '', 'AUTH_SSO_1004', 'AUTH_SSO_1006', 'NOT_A_CODE']) {
      expect(fieldForErrorCode(code), `不应把 ${String(code)} 归到某个字段`).toBeNull();
    }
  });

  it('映射的值都是已知字段标识（防止拼错字段名）', () => {
    const known = new Set(['username', 'email', 'mobile', 'password', 'code', 'clientId']);
    for (const [code, field] of Object.entries(ERROR_CODE_FIELDS)) {
      expect(known.has(field), `${code} 映射到了未知字段 ${field}`).toBe(true);
    }
  });

  // ── 自维护断言（本文件的核心价值）──────────────────────────────────
  it('契约里**每个** `*_ALREADY_EXISTS` 码都有字段映射', () => {
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

    const unmapped = conflictCodes.filter((c) => fieldForErrorCode(c) === null);
    expect(
      unmapped,
      '契约新增了冲突码但前端没有映射 ⇒ 该错误会退回"解析中文文案"（#92）。'
        + '请在 src/domain/shared/error-fields.ts 里补上它落到哪个字段',
    ).toEqual([]);
  });
});
