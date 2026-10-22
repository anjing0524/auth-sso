import type {
  EntityStatus,
  UserStatus,
  PermissionType,
} from '@auth-sso/contracts';
import {
  ENTITY_STATUS_VALUES,
  USER_STATUS_VALUES,
  PERMISSION_TYPE_VALUES,
} from '@auth-sso/contracts';

const ENTITY_STATUS_SET: ReadonlySet<string> = new Set(ENTITY_STATUS_VALUES);
const USER_STATUS_SET: ReadonlySet<string> = new Set(USER_STATUS_VALUES);
const PERMISSION_TYPE_SET: ReadonlySet<string> = new Set(PERMISSION_TYPE_VALUES);

function guard<T>(set: ReadonlySet<string>, label: string, v: string): T {
  if (!set.has(v)) {
    const msg = `Invalid ${label}: "${v}" (expected one of ${[...set].join(', ')})`;
    if (process.env['NODE_ENV'] === 'production') {
      console.warn(`[type-guard] ${msg}`);
    } else {
      throw new Error(msg);
    }
  }
  return v as unknown as T;
}

export function asEntityStatus(v: string): EntityStatus { return guard(ENTITY_STATUS_SET, 'EntityStatus', v); }
export function asUserStatus(v: string): UserStatus { return guard(USER_STATUS_SET, 'UserStatus', v); }
export function asPermissionType(v: string): PermissionType { return guard(PERMISSION_TYPE_SET, 'PermissionType', v); }
