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
import { eq } from 'drizzle-orm';
import { revokeClientRefreshTokens } from '@/lib/auth/token/revocation';
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

/** 创建 Client */
export const createClientAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.CREATE], audit: 'CLIENT_CREATE' },
  async (_ctx: AuthContext, input: CreateClientInput): Promise<ApiResponse<{ id: string; clientId: string; clientSecret: string | null }>> => {
    const v = validate(CreateClientInputSchema, input);
    if (!v.ok) return v.response;

    const rawSecret = generateClientSecret();
    const client = createClient(v.data, generateClientId, () => rawSecret);
    await db.insert(schema.clients).values({
      ...clientToInsertRow(client),
      clientSecret: await hashClientSecret(rawSecret),
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
  { permissions: [CLIENT_PERMISSIONS.UPDATE], audit: 'CLIENT_UPDATE' },
  async (_ctx: AuthContext, clientIdStr: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateClientInputSchema, input);
    if (!v.ok) return v.response;

    await db.transaction(async (tx) => {
      const row = await tx.query.clients.findFirst({
        where: eq(schema.clients.clientId, clientIdStr),
      });
      if (!row) throw new EntityNotFoundError('Client', clientIdStr);

      const updated = applyClientUpdate(clientFromPersistence(row), v.data);

      await tx.update(schema.clients).set(clientToUpdateRow(updated))
        .where(eq(schema.clients.clientId, row.clientId));
      return updated;
    });

    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { id: clientIdStr }, message: '应用更新成功' };
  },
);

/** 删除 Client */
export const deleteClientAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.DELETE], audit: 'CLIENT_DELETE' },
  async (_ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    await db.transaction(async (tx) => {
      const row = await tx.query.clients.findFirst({
        where: eq(schema.clients.clientId, clientIdStr),
      });
      if (!row) throw new EntityNotFoundError('Client', clientIdStr);

      await tx.delete(schema.clients).where(eq(schema.clients.clientId, row.clientId));
    });

    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { id: clientIdStr }, message: '应用已注销' };
  },
);

/** 重新生成 Client Secret */
export const rotateClientSecretAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.ROTATE_SECRET], audit: 'CLIENT_SECRET_REGENERATE' },
  async (_ctx: AuthContext, clientIdStr: string): Promise<ApiResponse<{ clientSecret: string }>> => {
    const row = await db.query.clients.findFirst({
      where: eq(schema.clients.clientId, clientIdStr),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    const newSecret = generateClientSecret();
    await db.update(schema.clients)
      .set({ clientSecret: await hashClientSecret(newSecret) })
      .where(eq(schema.clients.clientId, row.clientId));

    revalidatePath(`/clients/${row.clientId}`);
    revalidatePath('/clients');
    updateTag('clients-list');
    return { success: true, data: { clientSecret: newSecret }, message: '密钥重新生成成功' };
  },
);

/** 撤销 Client 的 Refresh Token（RFC 9700：按 client 撤销授权家族） */
export const revokeClientTokensAction = withAuth(
  { permissions: [CLIENT_PERMISSIONS.UPDATE], audit: 'TOKEN_REVOKE' },
  async (_ctx: AuthContext, clientIdStr: string, tokenIds: string[], revokeAll: boolean): Promise<ApiResponse<{ revokedCount: number }>> => {
    const row = await db.query.clients.findFirst({
      where: eq(schema.clients.clientId, clientIdStr),
    });
    if (!row) throw new EntityNotFoundError('Client', clientIdStr);

    // AT 无 client 语义（ADR-006 最小化），不可按 client 定点撤销；
    // 撤 RT 即终止该 client 的续期能力，已发 AT 在 ≤1h TTL 内自然失效，
    // 急迫场景走 jti 黑名单强制下线。历史上本动作 DELETE 幽灵表 access_tokens
    // 恒为 0 行却返回成功（audit 2026-09-28 H-2），此处修复为真实撤销。
    let revokedCount = 0;
    if (revokeAll) {
      revokedCount = await revokeClientRefreshTokens(db, row.clientId);
    } else if (tokenIds && tokenIds.length > 0) {
      revokedCount = await revokeClientRefreshTokens(db, row.clientId, { tokenIds });
    }

    revalidatePath(`/clients/${row.clientId}`);
    updateTag('clients-list');
    return { success: true, data: { revokedCount }, message: `已成功撤销 ${revokedCount} 个 Token` };
  },
);
