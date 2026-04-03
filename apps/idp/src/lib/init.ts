/**
 * IdP 初始化脚本
 * 创建测试用户和 OAuth Client
 */
import { db } from '../db';
import { users, clients } from '../db/schema';
import { nanoid } from 'nanoid';
import * as bcrypt from 'bcrypt';

/**
 * 初始化测试数据
 */
export async function initializeTestData(): Promise<void> {
  console.log('[Init] 开始初始化测试数据...');

  // 检查是否已有数据
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) {
    console.log('[Init] 测试数据已存在，跳过初始化');
    return;
  }

  // 创建测试用户
  const passwordHash = await bcrypt.hash('test123456', 10);

  const testUser = await db.insert(users).values({
    id: nanoid(),
    publicId: `usr_${nanoid(12)}`,
    username: 'admin',
    email: 'admin@example.com',
    emailVerified: true,
    passwordHash,
    name: '系统管理员',
    status: 'ACTIVE',
  }).returning();

  console.log('[Init] 创建测试用户:', testUser[0]?.username);

  // 创建 Portal OAuth Client
  const portalClient = await db.insert(clients).values({
    id: nanoid(),
    publicId: `cli_${nanoid(12)}`,
    name: 'Portal',
    clientId: 'portal',
    clientSecret: 'portal-secret',
    redirectUrls: JSON.stringify(['http://localhost:4000/api/auth/callback']),
    grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
    scopes: 'openid profile email offline_access',
    homepageUrl: 'http://localhost:4000',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    status: 'ACTIVE',
    disabled: false,
    skipConsent: true,
  }).returning();

  console.log('[Init] 创建 Portal Client:', portalClient[0]?.clientId);

  console.log('[Init] 测试数据初始化完成');
}

/**
 * 获取测试用户凭据
 */
export function getTestCredentials(): { username: string; password: string } {
  return {
    username: 'admin',
    password: 'test123456',
  };
}

/**
 * 获取 Portal OAuth 配置
 */
export function getPortalOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  return {
    clientId: 'portal',
    clientSecret: 'portal-secret',
    redirectUri: 'http://localhost:4000/api/auth/callback',
  };
}