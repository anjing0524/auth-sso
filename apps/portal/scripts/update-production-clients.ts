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

    if (portalSecret) {
      await db.update(schema.clients)
        .set({
          name: 'Portal 用户管理门户',
          clientId: portalClientId,
          clientSecret: portalSecret,
          redirectUrls: process.env.PORTAL_REDIRECT_URL || 'http://localhost:4100/api/auth/callback'
        })
        .where(eq(schema.clients.clientId, 'portal'));
      console.log(`✅ Portal client updated. ID: ${portalClientId}`);
    }

    console.log('✨ Update complete!');
  } finally {
    await client.end();
  }
}

updateClients().catch(console.error);