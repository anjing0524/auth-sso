import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { nanoid } from 'nanoid';

async function main() {
  console.log('🚀 Setting up local OIDC clients...');

  // 1. Ensure Portal client exists
  const portalClient = await db.query.clients.findFirst({
    where: (clients, { eq }) => eq(clients.clientId, 'portal'),
  });

  if (!portalClient) {
    await db.insert(schema.clients).values({
      id: nanoid(),
      publicId: `cli_${nanoid(12)}`,
      clientId: 'portal',
      clientSecret: 'portal-secret',
      name: 'Auth-SSO Portal',
      redirectUrls: JSON.stringify(['http://localhost:4000/api/auth/callback']),
      homepageUrl: 'http://localhost:4000',
      skipConsent: true,
    });
    console.log('✅ Created portal client');
  } else {
    console.log('ℹ️ Portal client already exists');
  }

  // 2. Ensure Demo App client exists
  const demoClient = await db.query.clients.findFirst({
    where: (clients, { eq }) => eq(clients.clientId, 'demo-app'),
  });

  if (!demoClient) {
    await db.insert(schema.clients).values({
      id: nanoid(),
      publicId: `cli_${nanoid(12)}`,
      clientId: 'demo-app',
      clientSecret: 'demo-app-secret',
      name: 'Demo App',
      redirectUrls: JSON.stringify(['http://localhost:4002/auth/callback']),
      homepageUrl: 'http://localhost:4002',
      skipConsent: false,
    });
    console.log('✅ Created demo-app client');
  } else {
    console.log('ℹ️ Demo-app client already exists');
  }

  console.log('✨ Local clients setup complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
