import { z } from 'zod';
import { type EntityStatus } from '@auth-sso/contracts';
import { entityStatusEnum } from '@/domain/shared/zod-schemas';

/**
 * OAuth Client 领域实体接口 (纯 TS interface)
 */
export interface Client {
  /** 内部 ID */
  id: string;
  /** 对外公开展示 ID */
  publicId: string;
  /** 应用名称 */
  name: string;
  /** OAuth Client ID */
  clientId: string;
  /** OAuth Client Secret（仅创建时可见） */
  clientSecret: string | null;
  /** 回调地址列表 */
  redirectUris: string[];
  /** 授权类型 JSON 字符串 */
  grantTypes: string;
  /** 授权范围 */
  scopes: string;
  /** 主页 URL */
  homepageUrl: string | null;
  /** Logo URL */
  logoUrl: string | null;
  /** Access Token TTL (秒) */
  accessTokenTtl: number;
  /** Refresh Token TTL (秒) */
  refreshTokenTtl: number;
  /** 状态 */
  status: EntityStatus;
  /** 是否禁用 */
  disabled: boolean;
  /** 是否跳过授权确认 */
  skipConsent: boolean;
  /** 所属用户 ID */
  userId: string | null;
  /** 创建时间 */
  createdAt: Temporal.Instant;
}

/** 创建 Client 入参校验 Schema */
export const CreateClientInputSchema = z.object({
  name: z.string().min(1, '应用名称不能为空'),
  redirectUris: z.array(z.string().url('回调地址格式不合法')).min(1, '至少需要一个回调地址'),
  scopes: z.string().default('openid profile email'),
  homepageUrl: z.string().url().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  accessTokenTtl: z.number().int().positive().default(3600),
  refreshTokenTtl: z.number().int().positive().default(604800),
  skipConsent: z.boolean().default(false),
});

/** 更新 Client 入参校验 Schema */
export const UpdateClientInputSchema = z.object({
  name: z.string().min(1).optional(),
  redirectUris: z.array(z.string().url()).min(1).optional(),
  scopes: z.string().optional(),
  homepageUrl: z.string().url().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  accessTokenTtl: z.number().int().positive().optional(),
  refreshTokenTtl: z.number().int().positive().optional(),
  skipConsent: z.boolean().optional(),
  status: entityStatusEnum.optional(),
  disabled: z.boolean().optional(),
});

export type CreateClientInput = z.infer<typeof CreateClientInputSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientInputSchema>;
