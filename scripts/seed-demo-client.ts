/**
 * Demo App OAuth Client 注册脚本 — Gateway 代理模式
 *
 * 该脚本直接在 Portal DB 中注册 demo_app 这个 OAuth Client。
 * 在 Gateway 代理模式下，子应用不自己做 OIDC——但 Portal 仍需要一个
 * Client 注册来走 OAuth 2.1 授权码流程。
 *
 * 使用方式：
 *   DATABASE_URL=postgresql://... npx tsx scripts/seed-demo-client.ts
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../apps/portal/src/db/schema';
import crypto from 'crypto';

const DEMO_CLIENT_ID = 'demo_app';
const DEMO_CLIENT_NAME = 'Demo App (Gateway 代理模式)';
const DEMO_REDIRECT_URIS = ['http://localhost:3100/api/callback'];

function hashClientSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is missing');

  const client = postgres(url);
  const db = drizzle(client, { schema });

  const existing = await db.query.clients.findFirst({
    where: (clients, { eq }) => eq(clients.clientId, DEMO_CLIENT_ID),
  });

  if (existing) {
    console.log(`Client "${DEMO_CLIENT_ID}" 已存在，跳过。`);
    await client.end();
    return;
  }

  const rawSecret = crypto.randomBytes(32).toString('hex');
  await db.insert(schema.clients).values({
    id: crypto.randomUUID(),
    clientId: DEMO_CLIENT_ID,
    clientName: DEMO_CLIENT_NAME,
    clientSecret: hashClientSecret(rawSecret),
    redirectUris: DEMO_REDIRECT_URIS,
    grantTypes: ['authorization_code', 'refresh_token'],
    scopes: ['openid', 'profile'],
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`✅ Demo App Client 已注册`);
  console.log(`   Client ID:     ${DEMO_CLIENT_ID}`);
  console.log(`   Client Secret: ${rawSecret}`);
  console.log(`   Redirect URI:  ${DEMO_REDIRECT_URIS[0]}`);

  await client.end();
}

main().catch(console.error);
