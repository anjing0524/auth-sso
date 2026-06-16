/**
 * @req D-CLI-C, D-CLI-U, D-CLI-D
 */
import { describe, it, expect } from 'vitest';
import {
  createClient,
  applyClientUpdate,
  parseRedirectUris,
  toDomainClient,
} from '@/domain/client/client';
import { CreateClientInputSchema } from '@/domain/client/types';

const mockIdGen = () => 'cli_id_12345';
const mockClientIdGen = () => 'test_client_id';
const mockSecretGen = () => 'test_secret_hex';

describe('Client 领域核心规则', () => {
  it('应通过工厂函数创建状态为 ACTIVE 的 Client', () => {
    const input = CreateClientInputSchema.parse({
      name: '测试应用',
      redirectUris: ['https://example.com/callback'],
      scopes: 'openid',
    });
    const client = createClient(input, mockIdGen, mockClientIdGen, mockSecretGen);
    expect(client.status).toBe('ACTIVE');
    expect(client.disabled).toBe(false);
    expect(client.clientSecret).toBe('test_secret_hex');
    expect(client.redirectUris).toHaveLength(1);
  });

  it('parseRedirectUris 应正确解析 JSON 数组', () => {
    const uris = parseRedirectUris('["https://a.com/cb","https://b.com/cb"]');
    expect(uris).toEqual(['https://a.com/cb', 'https://b.com/cb']);
  });

  it('parseRedirectUris 应正确解析逗号分隔字符串', () => {
    const uris = parseRedirectUris('https://a.com,https://b.com');
    expect(uris).toEqual(['https://a.com', 'https://b.com']);
  });

  it('applyClientUpdate 应正确 merge 字段', () => {
    const input = CreateClientInputSchema.parse({
      name: '旧名称',
      redirectUris: ['https://old.com'],
    });
    const client = createClient(input, mockIdGen, mockClientIdGen, mockSecretGen);
    const updated = applyClientUpdate(client, { name: '新名称', skipConsent: true });
    expect(updated.name).toBe('新名称');
    expect(updated.skipConsent).toBe(true);
    expect(updated.logoUrl).toBeNull(); // 未修改保持原值
  });

  it('toDomainClient 应正确解析 redirectUrls', () => {
    const row = {
      id: 'id1', publicId: 'pub1', name: 'Test App', clientId: 'cli_1',
      clientSecret: 'secret', redirectUrls: '["https://cb.example.com"]',
      grantTypes: '["authorization_code"]', scopes: 'openid',
      homepageUrl: null, icon: null, accessTokenTtl: 3600, refreshTokenTtl: 604800,
      status: 'ACTIVE', disabled: false, skipConsent: false, userId: null,
      createdAt: new Date('2025-01-01'),
    };
    const client = toDomainClient(row);
    expect(client.redirectUris).toEqual(['https://cb.example.com']);
    expect(client.accessTokenTtl).toBe(3600);
  });
});
