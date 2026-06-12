import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function checkDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const client = postgres(connectionString, { ssl: 'require' });
  const db = drizzle(client, { schema });

  try {
    const allClients = await db.select().from(schema.clients);
    console.log('Clients count:', allClients.length);
    allClients.forEach(c => {
      console.log(`- ID: ${c.id}, ClientID: ${c.clientId}, Redirects: ${c.redirectUrls}`);
    });

    const allUsers = await db.select().from(schema.users).limit(5);
    console.log('Users (first 5):', allUsers.map(u => u.username));

  } finally {
    await client.end();
  }
}

checkDb().catch(console.error);
