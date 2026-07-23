/**
 * @req DC-CLI-C, DC-CLI-U, DC-CLI-D
 */
import { describe, it, expect } from 'vitest';
import {
  createClient,
  applyClientUpdate,
} from '@/domain/client/client';
import { CreateClientInputSchema } from '@/domain/client/types';

const mockClientIdGen = () => 'test_client_id';
const mockSecretGen = () => 'test_secret_hex';

describe('Client 领域核心规则', () => {
  it('应通过工厂函数创建状态为 ACTIVE 的 Client', () => {
    const input = CreateClientInputSchema.parse({
      name: '测试应用',
      redirectUris: ['https://example.com/callback'],
      scopes: 'openid',
    });
    const client = createClient(input, mockClientIdGen, mockSecretGen);
    expect(client.status).toBe('ACTIVE');
    expect(client.clientSecret).toBe('test_secret_hex');
    expect(client.redirectUris).toHaveLength(1);
  });

  it('parseRedirectUris 已废弃：redirectUrls 为原生数组', () => {
    // redirectUrls 现为 PG text[] 原生数组，不再需要字符串解析
    const uris = ['https://a.com/cb', 'https://b.com/cb'];
    expect(uris).toHaveLength(2);
  });

  it('applyClientUpdate 应正确 merge 字段', () => {
    const input = CreateClientInputSchema.parse({
      name: '旧名称',
      redirectUris: ['https://old.com'],
    });
    const client = createClient(input, mockClientIdGen, mockSecretGen);
    const updated = applyClientUpdate(client, { name: '新名称' });
    expect(updated.name).toBe('新名称');
    expect(updated.logoUrl).toBeNull(); // 未修改保持原值
  });
});
