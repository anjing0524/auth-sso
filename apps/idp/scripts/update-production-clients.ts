import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function updateClients() {
  console.log('🔄 Updating production clients...');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const client = postgres(connectionString, { ssl: 'require' });
  const db = drizzle(client, { schema });

  try {
    const portalClientId = 'cl_portal_k8s2n1';
    const portalSecret = process.env.PORTAL_CLIENT_SECRET;
    const demoClientId = 'cl_demo_j9m3p5';
    const demoSecret = process.env.DEMO_APP_CLIENT_SECRET;

    if (portalSecret) {
      await db.update(schema.clients)
        .set({
          name: 'Portal 用户管理门户',
          clientId: portalClientId,
          clientSecret: portalSecret,
          redirectUrls: 'https://auth-sso-portal.vercel.app/api/auth/callback,http://localhost:4000/api/auth/callback'
        })
        .where(eq(schema.clients.clientId, 'portal')); // 第一次使用旧的查找，之后改为 ID 查找
      console.log(`✅ Portal client updated. ID: ${portalClientId}`);
    }

    if (demoSecret) {
      await db.update(schema.clients)
        .set({
          name: 'Demo App 示例应用',
          clientId: demoClientId,
          clientSecret: demoSecret,
          redirectUrls: 'https://auth-sso-demo-tau.vercel.app/auth/callback,http://localhost:4002/auth/callback'
        })
        .where(eq(schema.clients.clientId, 'demo-app'));
      console.log(`✅ Demo App client updated. ID: ${demoClientId}`);
    }

    console.log('✨ Update complete!');
  } finally {
    await client.end();
  }
}

updateClients().catch(console.error);