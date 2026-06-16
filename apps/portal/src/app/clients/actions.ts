'use server';

/**
 * Client 管理 Server Actions (BFF 薄 Controller)
 */
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
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
import { generateId, generateClientId, generateClientSecret } from '@/lib/crypto';
import type { ApiResponse } from '@auth-sso/contracts';

/** 创建 Client */
export const createClientAction = withAuth(
  { permissions: ['client:create'] },
  async (_ctx: AuthContext, input: CreateClientInput): Promise<ApiResponse<{ id: string; clientId: string; clientSecret: string | null }>> => {
    const parsed = CreateClientInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const client = createClient(parsed.data, generateId, generateClientId, generateClientSecret);
    await db.insert(schema.clients).values(clientToInsertRow(client));

    revalidatePath('/clients');
    return {
      success: true,
      data: { id: client.publicId, clientId: client.clientId, clientSecret: client.clientSecret },
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
      where: or(eq(schema.clients.id, clientIdStr), eq(schema.clients.publicId, clientIdStr)),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    const client = toDomainClient(row);
    const updated = applyClientUpdate(client, parsed.data);

    await db.update(schema.clients).set(clientToUpdateRow(updated))
      .where(eq(schema.clients.id, client.id));

    revalidatePath('/clients');
    return { success: true, data: { id: clientIdStr }, message: '应用更新成功' };
  },
);

/** 删除 Client */
export const deleteClientAction = withAuth(
  { permissions: ['client:delete'] },
  async (_ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.clients.findFirst({
      where: or(eq(schema.clients.id, clientIdStr), eq(schema.clients.publicId, clientIdStr)),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    await db.delete(schema.clients).where(eq(schema.clients.id, row.id));

    revalidatePath('/clients');
    return { success: true, data: { id: clientIdStr }, message: '应用已注销' };
  },
);
