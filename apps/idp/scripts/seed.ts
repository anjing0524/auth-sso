import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Seeding database...');

  // Create test user
  const userId = nanoid();
  const hashedPassword = await bcrypt.hash('test123456', 10);

  const [user] = await db.insert(schema.users).values({
    id: userId,
    publicId: `usr_${nanoid(12)}`,
    username: 'admin',
    email: 'admin@example.com',
    emailVerified: true,
    name: 'Admin User',
    status: 'ACTIVE',
  }).returning();

  console.log('✅ Created user:', user.username);

  // Create credential account for password authentication
  // Better Auth expects password in accounts table with providerId='credential'
  const accountId = nanoid();
  await db.insert(schema.accounts).values({
    id: accountId,
    userId: user.id,
    accountId: user.id, // For credential provider, accountId is same as userId
    providerId: 'credential',
    password: hashedPassword,
  });

  console.log('✅ Created credential account for user');

  // Create OAuth client for Portal
  const clientId = nanoid();
  const [client] = await db.insert(schema.clients).values({
    id: clientId,
    publicId: `cli_${nanoid(12)}`,
    name: 'Portal',
    clientId: 'portal',
    clientSecret: 'portal-secret', // In production, this should be hashed
    redirectUris: JSON.stringify(['http://localhost:4000/api/auth/callback']),
    grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
    scopes: 'openid profile email offline_access',
    homepageUrl: 'http://localhost:4000',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    status: 'ACTIVE',
    disabled: false,
    skipConsent: true, // Skip consent screen for trusted client
  }).returning();

  console.log('✅ Created OAuth client:', client.clientId);
  console.log('🌱 Seed complete!');

  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});