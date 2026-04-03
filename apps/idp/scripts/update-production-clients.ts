import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

async function update() {
  console.log('🚀 Updating production data in database...');

  // Update Portal Client
  const portalRedirectUris = [
    'https://auth-sso-portal.vercel.app/api/auth/callback',
    'http://localhost:4000/api/auth/callback'
  ];
  
  await db.update(schema.clients)
    .set({
      redirectUris: JSON.stringify(portalRedirectUris),
      homepageUrl: 'https://auth-sso-portal.vercel.app'
    })
    .where(eq(schema.clients.clientId, 'portal'));

  console.log('✅ Updated portal client redirect URIs');

  // Update Demo App Client
  const demoRedirectUris = [
    'https://auth-sso-demo-tau.vercel.app/auth/callback',
    'http://localhost:4002/auth/callback'
  ];
  
  await db.update(schema.clients)
    .set({
      redirectUris: JSON.stringify(demoRedirectUris),
      homepageUrl: 'https://auth-sso-demo-tau.vercel.app'
    })
    .where(eq(schema.clients.clientId, 'demo-app'));

  console.log('✅ Updated demo-app client redirect URIs');

  // Update Admin User Password
  const hashedPassword = await bcrypt.hash('test123456', 10);
  const adminUser = await db.query.users.findFirst({
    where: eq(schema.users.username, 'admin')
  });

  if (adminUser) {
    await db.update(schema.accounts)
      .set({ password: hashedPassword })
      .where(eq(schema.accounts.userId, adminUser.id));
    console.log('✅ Updated admin user password');
  } else {
    console.log('⚠️ Admin user not found, skipping password update');
  }

  console.log('✨ Update complete!');
  process.exit(0);
}

update().catch((err) => {
  console.error('❌ Update failed:', err);
  process.exit(1);
});
