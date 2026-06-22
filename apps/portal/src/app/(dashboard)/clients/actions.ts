'use server';

/**
 * Client 管理 Server Actions (BFF 薄 Controller)
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, and, inArray } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createClient,
  clientToInsertRow,
  clientToUpdateRow,
  applyClientUpdate,
  toDomainClient,
} from '@/domain/client/client';
import {
  CreateClientInputSchema,
  UpdateClientInputSchema,
  type CreateClientInput,
} from '@/domain/client/types';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { generateClientId, generateClientSecret } from '@/lib/crypto';
import type { ApiResponse } from '@auth-sso/contracts';

/** 创建 Client */
export const createClientAction = withAuth(
  { permissions: ['client:create'] },
  async (_ctx: AuthContext, input: CreateClientInput): Promise<ApiResponse<{ id: string; clientId: string; clientSecret: string | null }>> => {
    const parsed = CreateClientInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const client = createClient(parsed.data, generateClientId, generateClientSecret);
    await db.insert(schema.clients).values(clientToInsertRow(client));

    revalidatePath('/clients');
    updateTag('clients-list');
    return {
      success: true,
      data: { id: client.clientId, clientId: client.clientId, clientSecret: client.clientSecret },
      message: '应用注册成功',
    };
  },
);

/** 更新 Client */
export const updateClientAction = withAuth(
  { permissions: ['client:update'] },
  async (_ctx: AuthContext, clientIdStr: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateClientInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const row = await db.query.clients.findFirst({
      where: eq(schema.clients.clientId, clientIdStr),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    const client = toDomainClient(row);
    const updated = applyClientUpdate(client, parsed.data);

    await db.update(schema.clients).set(clientToUpdateRow(updated))
      .where(eq(schema.clients.clientId, client.clientId));

    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { id: clientIdStr }, message: '应用更新成功' };
  },
);

/** 删除 Client */
export const deleteClientAction = withAuth(
  { permissions: ['client:delete'] },
  async (_ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.clients.findFirst({
      where: eq(schema.clients.clientId, clientIdStr),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    await db.delete(schema.clients).where(eq(schema.clients.clientId, row.clientId));

    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { id: clientIdStr }, message: '应用已注销' };
  },
);

/** 重新生成 Client Secret */
export const rotateClientSecretAction = withAuth(
  { permissions: ['client:update'] },
  async (_ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ clientSecret: string }>> => {
    const row = await db.query.clients.findFirst({
      where: eq(schema.clients.clientId, clientIdStr),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    const newSecret = generateClientSecret();
    await db.update(schema.clients)
      .set({ clientSecret: newSecret })
      .where(eq(schema.clients.clientId, row.clientId));

    revalidatePath(`/clients/${row.clientId}`);
    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { clientSecret: newSecret }, message: '密钥重新生成成功' };
  },
);

/** 撤销 Client Token */
export const revokeClientTokensAction = withAuth(
  { permissions: ['client:update'] },
  async (_ctx: AuthContext, clientIdStr: string, tokenIds: string[], revokeAll: boolean): Promise<ApiResponse<{ revokedCount: number }>> => {
    const row = await db.query.clients.findFirst({
      where: eq(schema.clients.clientId, clientIdStr),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    let deletedCount = 0;
    if (revokeAll) {
      const result = await db.delete(schema.accessTokens)
        .where(eq(schema.accessTokens.clientId, row.clientId))
        .returning({ id: schema.accessTokens.id });
      deletedCount = result.length;
    } else if (tokenIds && tokenIds.length > 0) {
      const result = await db.delete(schema.accessTokens)
        .where(and(
          eq(schema.accessTokens.clientId, row.clientId),
          inArray(schema.accessTokens.id, tokenIds)
        ))
        .returning({ id: schema.accessTokens.id });
      deletedCount = result.length;
    }

    revalidatePath(`/clients/${row.clientId}`);
    return { success: true, data: { revokedCount: deletedCount }, message: `已成功撤销 ${deletedCount} 个 Token` };
  },
);
