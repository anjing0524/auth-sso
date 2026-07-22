import { describe, it, expect } from 'vitest';
import {
  COMMON_ERRORS,
  AUTH_ERRORS,
  USER_ERRORS,
  DEPARTMENT_ERRORS,
  ROLE_ERRORS,
  PERMISSION_ERRORS,
  CLIENT_ERRORS,
} from '../errors';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  USER_PERMISSIONS,
  DEPARTMENT_PERMISSIONS,
  ROLE_PERMISSIONS,
  PERMISSION_PERMISSIONS,
  CLIENT_PERMISSIONS,
  AUDIT_PERMISSIONS,
  LOGIN_LOG_PERMISSIONS,
  SYSTEM_PERMISSIONS,
} from '../permissions';
import {
  TOKEN_TTL,
  REDIS_KEY_PREFIX,
} from '../oidc';
import {
  USER_STATUS_VALUES,
  ENTITY_STATUS_VALUES,
  PERMISSION_TYPE_VALUES,
  LOGIN_EVENT_VALUES,
  AUDIT_OPERATION_VALUES,
  USER_ACTIVE,
  ENTITY_ACTIVE,
  PERMISSION_API,
  MAX_PAGE_SIZE,
  ADMIN_ROLE_CODES,
  COOKIE_NAMES,
} from '../index';

function extractValues<T extends Record<string, string>>(obj: T): string[] {
  return Object.values(obj);
}

describe('错误码常量', () => {
  const errorGroups = [
    ['COMMON_ERRORS', COMMON_ERRORS],
    ['AUTH_ERRORS', AUTH_ERRORS],
    ['USER_ERRORS', USER_ERRORS],
    ['DEPARTMENT_ERRORS', DEPARTMENT_ERRORS],
    ['ROLE_ERRORS', ROLE_ERRORS],
    ['PERMISSION_ERRORS', PERMISSION_ERRORS],
    ['CLIENT_ERRORS', CLIENT_ERRORS],
  ] as const;

  it('所有错误码均以 AUTH_SSO_ 为前缀', () => {
    for (const [, group] of errorGroups) {
      for (const value of extractValues(group)) {
        expect(value).toMatch(/^AUTH_SSO_\d{4}$/);
      }
    }
  });

  it('同组内无重复', () => {
    for (const [name, group] of errorGroups) {
      const values = extractValues(group);
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  it('跨组无重复', () => {
    const all: string[] = [];
    for (const [, group] of errorGroups) {
      all.push(...extractValues(group));
    }
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('权限码常量', () => {
  const permGroups = [
    USER_PERMISSIONS,
    DEPARTMENT_PERMISSIONS,
    ROLE_PERMISSIONS,
    PERMISSION_PERMISSIONS,
    CLIENT_PERMISSIONS,
    AUDIT_PERMISSIONS,
    LOGIN_LOG_PERMISSIONS,
    SYSTEM_PERMISSIONS,
  ];

  it('ALL_PERMISSIONS 长度 = 各组拼接总长度', () => {
    const merged = permGroups.flatMap(g => extractValues(g));
    expect(ALL_PERMISSIONS).toEqual(merged);
  });

  it('ALL_PERMISSIONS 无重复', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('所有权限码格式为 portal:{资源}:{操作}', () => {
    for (const perm of ALL_PERMISSIONS) {
      expect(perm).toMatch(/^portal:\w+:\w+$/);
    }
  });

  it('PERMISSION_GROUPS 覆盖全部权限组', () => {
    const groupKeys = Object.keys(PERMISSION_GROUPS);
    expect(groupKeys).toContain('USER');
    expect(groupKeys).toContain('DEPARTMENT');
    expect(groupKeys).toContain('ROLE');
    expect(groupKeys).toContain('PERMISSION');
    expect(groupKeys).toContain('CLIENT');
    expect(groupKeys).toContain('AUDIT');
    expect(groupKeys).toContain('LOGIN_LOG');
    expect(groupKeys).toContain('SYSTEM');
  });
});

describe('Token TTL', () => {
  it('ACCESS_TOKEN → 1 小时', () => {
    expect(TOKEN_TTL.ACCESS_TOKEN).toBe(3600);
  });

  it('REFRESH_TOKEN → 7 天', () => {
    expect(TOKEN_TTL.REFRESH_TOKEN).toBe(7 * 24 * 3600);
  });

  it('LOGIN_SESSION → 5 分钟', () => {
    expect(TOKEN_TTL.LOGIN_SESSION).toBe(300);
  });

  it('层级关系正确：LOGIN_SESSION < ACCESS_TOKEN < REFRESH_TOKEN', () => {
    expect(TOKEN_TTL.LOGIN_SESSION).toBeLessThan(TOKEN_TTL.ACCESS_TOKEN);
    expect(TOKEN_TTL.ACCESS_TOKEN).toBeLessThan(TOKEN_TTL.REFRESH_TOKEN);
  });

  it('所有 TTL 为正数', () => {
    expect(TOKEN_TTL.LOGIN_SESSION).toBeGreaterThan(0);
    expect(TOKEN_TTL.ACCESS_TOKEN).toBeGreaterThan(0);
    expect(TOKEN_TTL.REFRESH_TOKEN).toBeGreaterThan(0);
  });
});

describe('枚举值数组', () => {
  it('USER_STATUS_VALUES 无重复', () => {
    expect(new Set(USER_STATUS_VALUES).size).toBe(USER_STATUS_VALUES.length);
  });

  it('ENTITY_STATUS_VALUES 无重复', () => {
    expect(new Set(ENTITY_STATUS_VALUES).size).toBe(ENTITY_STATUS_VALUES.length);
  });

  it('PERMISSION_TYPE_VALUES 无重复', () => {
    expect(new Set(PERMISSION_TYPE_VALUES).size).toBe(PERMISSION_TYPE_VALUES.length);
  });

  it('默认常量在对应数组中', () => {
    expect(USER_STATUS_VALUES).toContain(USER_ACTIVE);
    expect(ENTITY_STATUS_VALUES).toContain(ENTITY_ACTIVE);
    expect(PERMISSION_TYPE_VALUES).toContain(PERMISSION_API);
  });
});

describe('基础设施常量', () => {
  it('COOKIE_NAMES 所有值非空', () => {
    for (const v of Object.values(COOKIE_NAMES)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('REDIS_KEY_PREFIX 所有值非空且以 portal: 开头', () => {
    for (const v of Object.values(REDIS_KEY_PREFIX)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
      expect(v).toMatch(/^portal:/);
    }
  });

  it('MAX_PAGE_SIZE 为正整数', () => {
    expect(Number.isInteger(MAX_PAGE_SIZE)).toBe(true);
    expect(MAX_PAGE_SIZE).toBeGreaterThan(0);
  });

  it('ADMIN_ROLE_CODES 非空', () => {
    expect(ADMIN_ROLE_CODES.length).toBeGreaterThan(0);
  });
});

describe('审计/日志枚举值', () => {
  it('LOGIN_EVENT_VALUES 无重复', () => {
    expect(new Set(LOGIN_EVENT_VALUES).size).toBe(LOGIN_EVENT_VALUES.length);
  });

  it('AUDIT_OPERATION_VALUES 无重复', () => {
    expect(new Set(AUDIT_OPERATION_VALUES).size).toBe(AUDIT_OPERATION_VALUES.length);
  });
});
