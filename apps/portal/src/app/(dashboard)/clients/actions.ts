'use server';

/**
 * Client 管理 Server Actions (BFF 薄 Controller)
 *
 * @impl G-CLT-C — 注册新客户端
 * @impl G-CLT-U — 编辑客户端配置
 * @impl G-CLT-D — 注销客户端
 * @impl G-CLT-SEC — 轮换客户端密钥
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, and, inArray } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createClient,
  applyClientUpdate,
  clientFromPersistence,
  clientToInsertRow,
  clientToUpdateRow,
} from '@/domain/client/client';
import {
  CreateClientInputSchema,
  UpdateClientInputSchema,
  type CreateClientInput,
} from '@/domain/client/types';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { generateClientId, generateClientSecret, hashClientSecret } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { CLIENT_PERMISSIONS, type ApiResponse } from '@auth-sso/contracts';
import { appendSecurityAudit, getActionAuditContext } from '@/lib/audit';

/** 创建 Client */
export const createClientAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.CREATE] },
  async (ctx: AuthContext, input: CreateClientInput): Promise<ApiResponse<{ id: string; clientId: string; clientSecret: string | null }>> => {
    const v = validate(CreateClientInputSchema, input);
    if (!v.ok) return v.response;

    const rawSecret = generateClientSecret();
    const client = createClient(v.data, generateClientId, () => rawSecret);
    const secretHash = await hashClientSecret(rawSecret);
    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      await tx.insert(schema.clients).values({
        ...clientToInsertRow(client),
        clientSecret: secretHash,
      });
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'CLIENT_CREATE',
        targetType: 'client',
        targetId: client.clientId,
        targetName: client.name,
        changes: {
          redirectUris: { after: client.redirectUris },
          scopes: { after: client.scopes },
          status: { after: client.status },
        },
        ...auditContext,
      });
    });

    revalidatePath('/clients');
    updateTag('clients-list');
    return {
      success: true,
      data: { id: client.clientId, clientId: client.clientId, clientSecret: rawSecret },
      message: '应用注册成功。Secret 仅显示一次，请妥善保存。',
    };
  },
);

/** 更新 Client */
export const updateClientAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.UPDATE] },
  async (ctx: AuthContext, clientIdStr: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateClientInputSchema, input);
    if (!v.ok) return v.response;

    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      const row = await tx.query.clients.findFirst({
        where: eq(schema.clients.clientId, clientIdStr),
      });
      if (!row) throw new EntityNotFoundError('Client', clientIdStr);

      const updated = applyClientUpdate(clientFromPersistence(row), v.data);

      await tx.update(schema.clients).set(clientToUpdateRow(updated))
        .where(eq(schema.clients.clientId, row.clientId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'CLIENT_UPDATE',
        targetType: 'client',
        targetId: row.clientId,
        targetName: updated.name,
        changes: {
          name: { before: row.name, after: updated.name },
          redirectUris: { before: row.redirectUris, after: updated.redirectUris },
          scopes: { before: row.scopes, after: updated.scopes },
          status: { before: row.status, after: updated.status },
        },
        ...auditContext,
      });
      return updated;
    });

    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { id: clientIdStr }, message: '应用更新成功' };
  },
);

/** 删除 Client */
export const deleteClientAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.DELETE] },
  async (ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      const row = await tx.query.clients.findFirst({
        where: eq(schema.clients.clientId, clientIdStr),
      });
      if (!row) throw new EntityNotFoundError('Client', clientIdStr);

      await tx.delete(schema.clients).where(eq(schema.clients.clientId, row.clientId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'CLIENT_DELETE',
        targetType: 'client',
        targetId: row.clientId,
        targetName: row.name,
        ...auditContext,
      });
    });

    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { id: clientIdStr }, message: '应用已注销' };
  },
);

/** 重新生成 Client Secret */
export const rotateClientSecretAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.ROTATE_SECRET] },
  async (ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ clientSecret: string }>> => {
    const newSecret = generateClientSecret();
    const secretHash = await hashClientSecret(newSecret);
    const auditContext = await getActionAuditContext();
    const row = await db.transaction(async (tx) => {
      const target = await tx.query.clients.findFirst({
        where: eq(schema.clients.clientId, clientIdStr),
      });
      if (!target) throw new EntityNotFoundError('Client', clientIdStr);
      await tx.update(schema.clients)
        .set({ clientSecret: secretHash })
        .where(eq(schema.clients.clientId, target.clientId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'CLIENT_SECRET_REGENERATE',
        targetType: 'client',
        targetId: target.clientId,
        targetName: target.name,
        params: { secretExposedOnce: true },
        ...auditContext,
      });
      return target;
    });

    revalidatePath(`/clients/${row.clientId}`);
    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { clientSecret: newSecret }, message: '密钥重新生成成功' };
  },
);

/** 撤销 Client Token */
export const revokeClientTokensAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.UPDATE] },
  async (ctx: AuthContext, clientIdStr: string, tokenIds: string[], revokeAll: boolean): Promise<ApiResponse<{ revokedCount: number }>> => {
    const auditContext = await getActionAuditContext();
    const deletedCount = await db.transaction(async (tx) => {
      const row = await tx.query.clients.findFirst({
        where: eq(schema.clients.clientId, clientIdStr),
      });
      if (!row) throw new EntityNotFoundError('Client', clientIdStr);
      const result = revokeAll
        ? await tx.delete(schema.accessTokens)
            .where(eq(schema.accessTokens.clientId, row.clientId))
            .returning({ id: schema.accessTokens.id })
        : tokenIds.length > 0
          ? await tx.delete(schema.accessTokens)
              .where(and(
                eq(schema.accessTokens.clientId, row.clientId),
                inArray(schema.accessTokens.id, tokenIds),
              ))
              .returning({ id: schema.accessTokens.id })
          : [];
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'TOKEN_REVOKE',
        targetType: 'client',
        targetId: row.clientId,
        targetName: row.name,
        params: { revokeAll, revokedCount: result.length },
        ...auditContext,
      });
      return result.length;
    });

    revalidatePath(`/clients/${clientIdStr}`);
    return { success: true, data: { revokedCount: deletedCount }, message: `已成功撤销 ${deletedCount} 个 Token` };
  },
);
