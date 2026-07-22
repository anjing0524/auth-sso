import { type NextRequest } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, sql, inArray, ne, isNull, or, and } from 'drizzle-orm';
import { generateUUID } from '@/lib/crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';
import { flattenPermissions, getHashCode, findDuplicateCode } from '@/domain/permission/permission-sync';
import type { IncomingPermission } from '@/domain/permission/permission-sync';
import { restSuccess, restError } from '@/lib/response';
import { createLogger } from '@/lib/logger';

const log = createLogger('PermissionsRegister');

function extractBasicAuth(request: NextRequest): { clientId: string; clientSecret: string } | null {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Basic ')) return null;
  const credentials = Buffer.from(auth.split(' ')[1]!, 'base64').toString('utf-8');
  const [id, secret] = credentials.split(':');
  return (id && secret) ? { clientId: id, clientSecret: secret } : null;
}

async function checkCodeConflicts(incomingCodes: string[], clientId: string): Promise<string | null> {
  if (incomingCodes.length === 0) return null;
  const rows = await db.select({ code: schema.permissions.code, clientId: schema.permissions.clientId })
    .from(schema.permissions)
    .where(and(
      inArray(schema.permissions.code, incomingCodes),
      or(ne(schema.permissions.clientId, clientId), isNull(schema.permissions.clientId)),
    ))
    .limit(1);
  return rows[0]?.code ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = extractBasicAuth(request);
    if (!auth) return restError(COMMON_ERRORS.UNAUTHORIZED, '缺少或格式错误的 Basic Auth 凭证', 401);

    const clientRecord = await db.select().from(schema.clients).where(eq(schema.clients.clientId, auth.clientId)).limit(1);
    try { validateClientActive(clientRecord[0]); } catch { return restError(COMMON_ERRORS.FORBIDDEN, '该应用系统已停用或不存在', 403); }
    try { await validateClientSecret(clientRecord[0]!, auth.clientSecret); } catch { return restError(COMMON_ERRORS.FORBIDDEN, 'Client ID 或 Secret 错误', 403); }

    const body = await request.json();
    const tree: IncomingPermission[] = body.permissions;
    if (!tree || !Array.isArray(tree)) return restError(COMMON_ERRORS.VALIDATION_ERROR, '权限数据须为 permissions 数组', 400);

    const flatIncoming = flattenPermissions(tree);
    const codes = flatIncoming.map(p => p.code);
    const dup = findDuplicateCode(codes);
    if (dup) return restError(COMMON_ERRORS.VALIDATION_ERROR, `上报权限树中存在重复 code: ${dup}`, 400);

    const conflictCode = await checkCodeConflicts(codes, auth.clientId);
    if (conflictCode) return restError('conflict', `权限 code「${conflictCode}」全局已被占用，建议使用「${auth.clientId}:${conflictCode}」前缀`, 409);

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${getHashCode(auth.clientId)})`);
      const dbPermissions = await tx.select().from(schema.permissions).where(eq(schema.permissions.clientId, auth.clientId));
      const dbMap = new Map(dbPermissions.map(p => [p.code, p]));
      const codeToIdMap = new Map<string, string>();
      for (const p of dbPermissions) codeToIdMap.set(p.code, p.id);
      for (const p of flatIncoming) { if (!codeToIdMap.has(p.code)) codeToIdMap.set(p.code, generateUUID()); }

      const syncedCounts = { inserted: 0, updated: 0, deprecated: 0 };
      for (const p of flatIncoming) {
        const parentId = p.parentId ? (codeToIdMap.get(p.parentId) ?? null) : null;
        const existing = dbMap.get(p.code);
        if (!existing) {
          await tx.insert(schema.permissions).values({
            id: codeToIdMap.get(p.code)!, name: p.name, code: p.code, type: p.type,
            path: p.path ?? null, icon: p.icon ?? null, visible: p.visible ?? null,
            clientId: auth.clientId, parentId, sort: p.sort, status: 'ACTIVE', createdAt: new Date(),
          });
          syncedCounts.inserted++;
        } else {
          const changed = existing.parentId !== parentId || existing.name !== p.name || existing.type !== p.type ||
            existing.path !== (p.path ?? null) || existing.icon !== (p.icon ?? null) ||
            existing.visible !== (p.visible ?? null) || existing.sort !== p.sort || existing.status !== 'ACTIVE';
          if (changed) {
            await tx.update(schema.permissions).set({
              name: p.name, type: p.type,
              path: p.path ?? null, icon: p.icon ?? null, visible: p.visible ?? null,
              sort: p.sort, status: 'ACTIVE', ...(existing.parentId !== parentId ? { parentId } : {}),
            }).where(eq(schema.permissions.id, existing.id));
            syncedCounts.updated++;
          }
        }
      }
      const incomingSet = new Set(codes);
      for (const p of dbPermissions) {
        if (!incomingSet.has(p.code) && p.status === 'ACTIVE') {
          await tx.update(schema.permissions).set({ status: 'DISABLED' }).where(eq(schema.permissions.id, p.id));
          syncedCounts.deprecated++;
        }
      }
      return syncedCounts;
    });
    return restSuccess(result);
  } catch (error) {
    const mapped = mapDomainError(error);
    log.error('同步失败', { error: mapped.error, message: mapped.message });
    return restError(mapped.error, mapped.message, mapped.status);
  }
}
